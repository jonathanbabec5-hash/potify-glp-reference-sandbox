import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GreenLightPayCore, DomainError } from './core.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicRoot = join(root, 'public');
const databasePath = process.env.GLP_DATABASE || join(root, 'data', 'greenlight-pay.sqlite');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';
const core = new GreenLightPayCore(databasePath, { seed: true });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

function secureHeaders(contentType = 'application/json; charset=utf-8') {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  };
}

function json(response, status, body) {
  response.writeHead(status, { ...secureHeaders(), 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body, null, 2));
}

async function bodyJson(request) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 1_000_000) throw new DomainError('PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DomainError('INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function actor(request, fallback) {
  const value = request.headers['x-glp-actor'];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : fallback;
}

async function api(request, response, url) {
  const method = request.method || 'GET';
  const path = url.pathname;

  if (method === 'GET' && path === '/api/health') return json(response, 200, { status: 'ok', ...core.dashboard() });
  if (method === 'GET' && path === '/api/dashboard') return json(response, 200, core.dashboard());
  if (method === 'GET' && path === '/api/partners') return json(response, 200, { partners: core.listPartners() });
  if (method === 'GET' && path === '/api/merchants') return json(response, 200, { merchants: core.listMerchants() });
  if (method === 'GET' && path === '/api/payment-intents') return json(response, 200, { payment_intents: core.listPaymentIntents(url.searchParams.get('limit')) });
  if (method === 'GET' && path === '/api/audit') return json(response, 200, { events: core.listAudit(url.searchParams.get('limit')) });
  if (method === 'GET' && path === '/api/audit/verify') return json(response, 200, core.verifyAuditChain());

  if (method === 'POST' && path === '/api/partners') {
    const result = core.createPartner(await bodyJson(request), actor(request, 'partner-operator'));
    return json(response, 201, result);
  }
  let match = path.match(/^\/api\/partners\/([^/]+)\/status$/);
  if (method === 'POST' && match) {
    const input = await bodyJson(request);
    return json(response, 200, core.setPartnerStatus(match[1], input.status, actor(request, 'partner-operator')));
  }

  if (method === 'POST' && path === '/api/merchants') {
    const result = core.createMerchant(await bodyJson(request), actor(request, 'merchant-underwriting'));
    return json(response, 201, result);
  }
  match = path.match(/^\/api\/merchants\/([^/]+)\/status$/);
  if (method === 'POST' && match) {
    const input = await bodyJson(request);
    return json(response, 200, core.setMerchantStatus(match[1], input.status, actor(request, 'merchant-underwriting')));
  }
  match = path.match(/^\/api\/merchants\/([^/]+)\/controls$/);
  if (method === 'PATCH' && match) {
    return json(response, 200, core.updateMerchantControls(match[1], await bodyJson(request), actor(request, 'merchant-operator')));
  }

  if (method === 'POST' && path === '/api/payment-intents') {
    const result = core.createPaymentIntent(await bodyJson(request), actor(request, 'pos-emulator'));
    return json(response, result.idempotent_replay ? 200 : 201, result);
  }
  match = path.match(/^\/api\/payment-intents\/([^/]+)\/screen$/);
  if (method === 'POST' && match) {
    return json(response, 200, core.screenPaymentIntent(match[1], await bodyJson(request), actor(request, 'partner-sandbox')));
  }
  match = path.match(/^\/api\/payment-intents\/([^/]+)\/submit$/);
  if (method === 'POST' && match) {
    return json(response, 200, core.submitPaymentSignature(match[1], await bodyJson(request), actor(request, 'checkout-sandbox')));
  }
  match = path.match(/^\/api\/payment-intents\/([^/]+)\/verify$/);
  if (method === 'POST' && match) {
    return json(response, 200, core.verifyPaymentIntent(match[1], await bodyJson(request), actor(request, 'verification-service')));
  }
  match = path.match(/^\/api\/payment-intents\/([^/]+)\/reconcile$/);
  if (method === 'POST' && match) {
    return json(response, 200, core.reconcilePaymentIntent(match[1], await bodyJson(request), actor(request, 'reconciliation-service')));
  }
  match = path.match(/^\/api\/payment-intents\/([^/]+)\/cancel$/);
  if (method === 'POST' && match) {
    const input = await bodyJson(request);
    return json(response, 200, core.cancelPaymentIntent(match[1], input.reason, actor(request, 'merchant-operator')));
  }

  throw new DomainError('NOT_FOUND', 'API route not found.', 404);
}

async function staticFile(response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = resolve(publicRoot, relative);
  if (!filePath.startsWith(`${publicRoot}/`) && filePath !== join(publicRoot, 'index.html')) {
    throw new DomainError('NOT_FOUND', 'File not found.', 404);
  }
  try {
    const bytes = await readFile(filePath);
    response.writeHead(200, {
      ...secureHeaders(MIME_TYPES[extname(filePath)] || 'application/octet-stream'),
      'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=300'
    });
    response.end(bytes);
  } catch (error) {
    if (error.code === 'ENOENT') throw new DomainError('NOT_FOUND', 'File not found.', 404);
    throw error;
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await api(request, response, url);
    else await staticFile(response, url.pathname);
  } catch (error) {
    if (error instanceof DomainError) {
      return json(response, error.status, { error: { code: error.code, message: error.message, details: error.details } });
    }
    console.error(error);
    return json(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'An unexpected sandbox error occurred.' } });
  }
});

server.listen(port, host, () => {
  console.log(`Green Light Pay sandbox running at http://${host}:${port}`);
  console.log('SANDBOX ONLY — no live money movement and no production provider approval.');
});

function shutdown() {
  server.close(() => {
    core.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
