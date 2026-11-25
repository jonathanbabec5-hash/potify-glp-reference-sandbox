const STEP_ORDER = ['counter', 'partner', 'wallet', 'verify', 'receipt'];
const TERMINAL_STATUSES = new Set(['RECONCILED', 'DECLINED', 'CANCELLED', 'EXPIRED']);

const state = {
  dashboard: null,
  partners: [],
  merchants: [],
  intents: [],
  audit: [],
  activeIntent: null,
  resumeCandidate: null,
  checkout: null,
  stage: 'counter',
  busy: false,
  pollTimer: null,
  pollBusy: false,
  pendingIdempotencyKey: null,
  celebratedIntentId: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
}

function compactMoney(cents) {
  return money(cents).replace('.00', '');
}

function shortDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(new Date(value));
}

function formatAction(value) {
  return String(value || '').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-GLP-Actor': options.actor || 'playable-sandbox',
      ...(options.headers || {})
    }
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The sandbox returned an unreadable response. No success was recorded.');
  }
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'The sandbox request failed.');
    error.code = payload.error?.code || 'REQUEST_FAILED';
    error.details = payload.error?.details;
    throw error;
  }
  return payload;
}

let toastTimer;
function toast(message, isError = false) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.toggle('error', isError);
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3900);
}

function friendlyError(error) {
  const messages = {
    MERCHANT_PAUSED: 'This merchant paused new requests. Open the developer console to restore the counter.',
    TRANSACTION_LIMIT_EXCEEDED: 'That total is above this counter’s per-transaction limit.',
    DAILY_LIMIT_EXCEEDED: 'This sandbox merchant reached its daily request limit.',
    POS_AUTHORIZATION_REQUIRED: 'The POS must finish its own sale checks before Green Light Pay can begin.',
    PAYMENT_INTENT_EXPIRED: 'The one-time handoff expired. Restart the run to create a fresh request.',
    CHECKOUT_NOT_READY: 'The customer handoff is not ready yet.',
    CHECKOUT_NOT_FOUND: 'The one-time handoff is invalid or no longer available.',
    INVALID_STATE: 'That move is not allowed from the current payment state.',
    DATA_MINIMIZATION_VIOLATION: 'Green Light Pay rejected customer, medical, or product data at the boundary.'
  };
  return messages[error.code] || error.message || 'The action could not be completed. No success was recorded.';
}

function saveSession() {
  try {
    sessionStorage.setItem('glp-v011-run', JSON.stringify({
      intentId: state.activeIntent?.id || null,
      checkout: state.checkout
    }));
  } catch {
    // The run still works if private browsing blocks session storage.
  }
}

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem('glp-v011-run') || 'null');
  } catch {
    return null;
  }
}

function clearSession() {
  try { sessionStorage.removeItem('glp-v011-run'); } catch { /* no-op */ }
}

function activeMerchant() {
  return state.merchants.find((merchant) => merchant.status === 'ACTIVE') || state.merchants[0];
}

function assignedPartner() {
  const merchant = activeMerchant();
  return state.partners.find((partner) => partner.id === merchant?.partner_id) || state.partners[0];
}

function stageForStatus(status) {
  if (status === 'SCREENING_REQUIRED' || status === 'REVIEW_REQUIRED') return 'partner';
  if (status === 'READY_FOR_PAYMENT') return 'wallet';
  if (status === 'SUBMITTED' || status === 'VERIFIED' || status === 'EXCEPTION') return 'verify';
  if (status === 'RECONCILED') return 'receipt';
  return 'counter';
}

function setStageFromIntent() {
  state.stage = state.activeIntent ? stageForStatus(state.activeIntent.status) : 'counter';
}

async function bootstrap() {
  const [dashboard, partners, merchants, intents, audit] = await Promise.all([
    api('/api/dashboard'),
    api('/api/partners'),
    api('/api/merchants'),
    api('/api/payment-intents?limit=100'),
    api('/api/audit?limit=80')
  ]);
  state.dashboard = dashboard;
  state.partners = partners.partners;
  state.merchants = merchants.merchants;
  state.intents = intents.payment_intents;
  state.audit = audit.events;

  const saved = readSession();
  if (saved?.intentId) {
    state.activeIntent = state.intents.find((intent) => intent.id === saved.intentId) || null;
    state.checkout = saved.checkout || null;
  }
  if (!state.activeIntent) {
    state.resumeCandidate = state.intents.find((intent) => !TERMINAL_STATUSES.has(intent.status)) || null;
  }
  setStageFromIntent();
  render();
}

async function refreshData({ includeSystem = true } = {}) {
  const requests = [api('/api/payment-intents?limit=100'), api('/api/audit?limit=80')];
  if (includeSystem) requests.push(api('/api/dashboard'));
  const [intents, audit, dashboard] = await Promise.all(requests);
  state.intents = intents.payment_intents;
  state.audit = audit.events;
  if (dashboard) state.dashboard = dashboard;
  if (state.activeIntent) {
    state.activeIntent = state.intents.find((intent) => intent.id === state.activeIntent.id) || state.activeIntent;
  }
  setStageFromIntent();
}

function render() {
  clearPolling();
  renderHud();
  renderJourney();
  renderStageHeader();
  renderStage();
  renderRunFooter();
  renderTrace();
  $('#stage-content').setAttribute('aria-busy', String(state.busy));
  if (state.stage === 'wallet' && state.activeIntent?.status === 'READY_FOR_PAYMENT') startPolling();
}

function renderHud() {
  const merchant = activeMerchant();
  const partner = assignedPartner();
  $('#hud-merchant').textContent = merchant?.status === 'ACTIVE' ? 'Ready' : merchant?.status || 'Unavailable';
  $('#hud-partner').textContent = partner?.status === 'APPROVED' ? 'Qualified' : partner?.status || 'Unavailable';
}

function renderJourney() {
  const currentIndex = STEP_ORDER.indexOf(state.stage);
  $$('#journey-list li').forEach((item, index) => {
    item.classList.toggle('current', index === currentIndex);
    item.classList.toggle('complete', index < currentIndex || (state.stage === 'receipt' && index === currentIndex));
  });
  const completed = state.stage === 'receipt' ? 5 : Math.max(0, currentIndex);
  $('#run-progress').textContent = `${completed} / 5`;
}

function setStageStatus(label, tone = '') {
  const status = $('#stage-status');
  status.className = `stage-status ${tone}`.trim();
  $('span', status).textContent = label;
}

function renderStageHeader() {
  const config = {
    counter: ['Level 01 · Counter', 'Initiate Green Light Pay', 'Ready', 'success'],
    partner: ['Level 02 · Green Gate', 'Open only for a qualified path', 'Partner check', 'review'],
    wallet: ['Level 03 · Customer handoff', 'Pass one exact request—not customer data', 'Awaiting signature', 'review'],
    verify: ['Level 04 · Independent watchers', 'Trust evidence, not a browser message', state.activeIntent?.status === 'VERIFIED' ? 'Verified' : 'Observing', state.activeIntent?.status === 'VERIFIED' ? 'success' : 'review'],
    receipt: ['Level 05 · Clear records', 'The run closes only when every record agrees', 'Reconciled', 'success']
  }[state.stage];
  $('#stage-kicker').textContent = config[0];
  $('#stage-title').textContent = config[1];
  setStageStatus(config[2], config[3]);
}

function renderStage() {
  const container = $('#stage-content');
  if (state.stage === 'counter') container.innerHTML = renderCounter();
  if (state.stage === 'partner') container.innerHTML = renderPartner();
  if (state.stage === 'wallet') container.innerHTML = renderHandoff();
  if (state.stage === 'verify') container.innerHTML = renderVerify();
  if (state.stage === 'receipt') {
    container.innerHTML = renderReceipt();
    celebrate();
  }
}

function renderCounter() {
  if (state.resumeCandidate) {
    return `<div class="resume-card">
      <p class="stage-micro">Open run detected</p>
      <h3>Pick up where the counter stopped.</h3>
      <p>The prior run is still in a controlled, nonterminal state. Resume it or cancel it and begin cleanly.</p>
      <div class="resume-meta">
        <span>${escapeHtml(state.resumeCandidate.public_reference)}</span>
        <span>${money(state.resumeCandidate.amount_usd_cents)}</span>
        <span>${escapeHtml(formatAction(state.resumeCandidate.status))}</span>
      </div>
      <div class="resume-actions">
        <button class="primary-action" type="button" data-action="resume-run">Resume the run <span class="button-arrow">→</span></button>
        <button class="danger-action" type="button" data-action="cancel-resume">Cancel and start fresh</button>
      </div>
    </div>`;
  }

  const merchant = activeMerchant();
  const partner = assignedPartner();
  if (!merchant?.controls || !partner) {
    return renderFatal('The counter is not configured.', 'A merchant, controls record, and qualified partner are required before a run can begin.');
  }
  const controls = merchant.controls;
  return `<div class="counter-stage">
    <div class="stage-copy">
      <p class="micro">COUNTER ONE · ${escapeHtml(merchant.state)} ${escapeHtml(merchant.license_category.replace('_', ' '))} DEMO</p>
      <h3>The sale is ready. Start the payment.</h3>
      <p>The dispensary POS has already handled eligibility, purchase limits, products, tax, inventory, and state tracking. Green Light Pay receives only the final amount and counter authorization.</p>
      <div class="readiness-stack">
        <div class="readiness-row"><i>✓</i><strong>POS authorization</strong><span>Complete</span></div>
        <div class="readiness-row"><i>✓</i><strong>Merchant controls</strong><span>${controls.paused ? 'Paused' : 'Enforced'}</span></div>
        <div class="readiness-row"><i>✓</i><strong>Qualified partner record</strong><span>${escapeHtml(partner.status)}</span></div>
      </div>
    </div>
    <form class="counter-console" id="counter-form">
      <div class="console-top"><span>${escapeHtml(merchant.dba)}</span><span>REGISTER 01 · ONLINE</span></div>
      <div class="amount-panel">
        <label for="amount-usd">Final authorized total</label>
        <div class="amount-input-wrap"><span>$</span><input id="amount-usd" name="amountUsd" type="number" min="0.01" max="${(controls.per_transaction_limit_cents / 100).toFixed(2)}" step="0.01" value="42.50" inputmode="decimal" required aria-describedby="amount-note"></div>
        <div class="quick-amounts" aria-label="Demo totals">
          <button type="button" data-amount="18.50">$18.50</button>
          <button type="button" data-amount="42.50" class="selected">$42.50</button>
          <button type="button" data-amount="86.00">$86.00</button>
        </div>
        <p class="action-note" id="amount-note">Demo limit ${money(controls.per_transaction_limit_cents)} · ${escapeHtml(controls.allowed_asset_code)}</p>
        <button class="primary-action full" type="submit">Initiate Green Light Pay <span class="button-arrow">→</span></button>
      </div>
      <div class="counter-meta"><div><span>Store</span><strong>${escapeHtml(controls.store_ids[0])}</strong></div><div><span>Finality</span><strong>${escapeHtml(controls.required_commitment)}</strong></div></div>
    </form>
  </div>`;
}

function renderPartner() {
  const partner = assignedPartner();
  const intent = state.activeIntent;
  if (!intent || !partner) return renderFatal('No payment request is active.', 'Return to the counter and initiate a new run.');
  const review = intent.status === 'REVIEW_REQUIRED';
  return `<div class="gate-stage">
    <div class="gate-visual" id="gate-visual" aria-label="Closed qualification gate">
      <div class="gate-door left"></div><div class="gate-door right"></div>
      <div class="gate-core">${review ? 'RE-CHECK' : 'GLP'}<br>GATE</div>
    </div>
    <div class="stage-copy">
      <p class="micro">${review ? 'CONTROLLED REVIEW PATH' : 'QUALIFIED BEFORE CONNECTED'}</p>
      <h3>${review ? 'Evidence asked for another look.' : 'No partner, no green light.'}</h3>
      <p>The sandbox now asks the assigned partner fixture to screen the request. In a live program, this decision and every regulated function would require specific written authority.</p>
      <div class="gate-checks">
        <div class="gate-check"><i>✓</i><div><strong>Written scope recorded</strong><span>Sandbox evidence only</span></div></div>
        <div class="gate-check"><i>✓</i><div><strong>Screening authority</strong><span>Recorded in partner gate</span></div></div>
        <div class="gate-check"><i>✓</i><div><strong>Merchant assigned</strong><span>${escapeHtml(activeMerchant()?.state || '—')} counter bound</span></div></div>
        <div class="gate-check"><i>✓</i><div><strong>Amount frozen</strong><span>${money(intent.amount_usd_cents)}</span></div></div>
      </div>
      <button class="primary-action full" type="button" data-action="open-gate">${review ? 'Approve the reviewed path' : 'Run partner check and open the gate'} <span class="button-arrow">→</span></button>
      <p class="action-note">This records a simulated partner approval. It does not represent a real provider decision.</p>
    </div>
  </div>`;
}

function renderHandoff() {
  const intent = state.activeIntent;
  if (!intent) return renderFatal('No handoff is available.', 'Return to the counter and initiate a new run.');
  const qr = state.checkout?.checkout_qr_path;
  const path = state.checkout?.checkout_path;
  return `<div class="handoff-stage">
    <div class="stage-copy">
      <p class="micro">ONE REQUEST · ONE CUSTOMER HANDOFF</p>
      <h3>The counter has done its part.</h3>
      <p>The customer now receives an opaque, short-lived checkout. It carries the exact amount and destination—not their name, medical information, or basket.</p>
      <div class="handoff-actions">
        ${path ? `<a class="secondary-action" href="${escapeHtml(path)}" target="_blank" rel="noopener">Open customer handoff</a>` : '<button class="secondary-action" type="button" disabled>Handoff link unavailable after resume</button>'}
        <button class="primary-action" type="button" data-action="open-wallet">Play wallet step here</button>
      </div>
      <p class="handoff-safety">The simulated wallet owns the signing step. Green Light Pay never requests a seed phrase or private key.</p>
    </div>
    <div class="handoff-card">
      <div class="handoff-card-top"><span>GREEN LIGHT HANDOFF</span><span>10 MINUTE TOKEN</span></div>
      <div class="handoff-card-body">
        <div class="qr-frame">${qr ? `<img src="${escapeHtml(qr)}" alt="QR code that opens this one-time sandbox customer handoff">` : '<div class="qr-placeholder">RESUMED RUN<br>USE ONE-SCREEN DEMO</div>'}</div>
        <div class="handoff-amount"><span>Customer sees</span><strong>${money(intent.amount_usd_cents)}</strong><small>${escapeHtml(intent.asset_code)} · ${escapeHtml(activeMerchant()?.dba || '')}</small></div>
      </div>
      <div class="handoff-expiry"><span>${escapeHtml(intent.public_reference)}</span><strong>Expires ${shortDate(intent.checkout_expires_at)}</strong></div>
    </div>
  </div>`;
}

function renderVerify() {
  const intent = state.activeIntent;
  if (!intent) return renderFatal('No submitted transaction is active.', 'Return to the counter and initiate a new run.');
  const verified = intent.status === 'VERIFIED' || intent.status === 'EXCEPTION';
  return `<div class="watcher-stage">
    <div class="watcher-layout">
      <div class="watcher-map" aria-label="Two independent sandbox observers comparing one transaction">
        <div class="watcher-beam"></div>
        <div class="watcher-node"><div class="node-orb">RPC A</div><strong>Primary watcher</strong><small>INDEPENDENT FIXTURE</small></div>
        <div class="transaction-core">${verified ? 'MATCH' : 'GLP'}<br>${verified ? '✓' : 'TX'}</div>
        <div class="watcher-node"><div class="node-orb">RPC B</div><strong>Second watcher</strong><small>INDEPENDENT FIXTURE</small></div>
      </div>
      <div class="stage-copy">
        <p class="micro">${verified ? 'EVIDENCE MATCHED' : 'SERVER-SIDE VERIFICATION'}</p>
        <h3>${verified ? 'Both watchers saw the same truth.' : 'A wallet message is not proof.'}</h3>
        <p>${verified ? 'The frozen expectation and both observations agree. The balanced operational record is posted, but the run still needs four-way reconciliation.' : 'The server will compare two independent observations against the exact request the counter created.'}</p>
        <div class="evidence-grid">
          <div><i>✓</i> Exact signature</div><div><i>✓</i> Exact amount</div>
          <div><i>✓</i> Allowlisted asset</div><div><i>✓</i> Merchant destination</div>
          <div><i>✓</i> Required finality</div><div><i>✓</i> Matching slot</div>
        </div>
        ${verified ? '<div class="verified-banner"><i>✓</i><span>Dual-observer verification passed and the ledger entry balances.</span></div><button class="primary-action full" type="button" data-action="reconcile">Reconcile POS, chain, partner, and ledger <span class="button-arrow">→</span></button>' : '<button class="primary-action full" type="button" data-action="verify">Run independent verification <span class="button-arrow">→</span></button>'}
      </div>
    </div>
  </div>`;
}

function renderReceipt() {
  const intent = state.activeIntent;
  if (!intent) return renderFatal('No receipt is available.', 'Complete a Green Light Pay run first.');
  const developerUrl = `/developer?intent=${encodeURIComponent(intent.id)}`;
  return `<div class="receipt-stage">
    <div class="win-heading">
      <div class="win-mark">✓</div>
      <p class="stage-micro">GREEN LIGHT · RUN COMPLETE</p>
      <h3>Every record agrees.</h3>
      <p>The sandbox did not declare success until verification and four-way reconciliation both passed.</p>
    </div>
    <div class="digital-receipt">
      <div class="receipt-top"><span>${escapeHtml(intent.public_reference)}</span><strong>RECONCILED</strong></div>
      <div class="receipt-main">
        <div class="receipt-total"><span>Authorized total</span><strong>${money(intent.amount_usd_cents)}</strong><small>${escapeHtml(intent.asset_code)} · Sandbox only</small></div>
        <div class="receipt-proof"><span>Partner qualified</span><span>Merchant controls passed</span><span>Two observers matched</span><span>Ledger balanced</span><span>POS amount matched</span><span>Audit event linked</span></div>
      </div>
    </div>
    <div class="receipt-actions">
      <button class="primary-action" type="button" data-action="new-run">Play another run</button>
      <a class="secondary-action" href="${developerUrl}">Inspect the technical proof</a>
    </div>
  </div>`;
}

function renderFatal(title, message) {
  return `<div class="error-panel"><p class="stage-micro">RUN BLOCKED</p><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p><button class="quiet-action" type="button" data-action="new-run">Return to the counter</button></div>`;
}

function renderRunFooter() {
  $('#run-reference').textContent = state.activeIntent?.public_reference || 'NOT STARTED';
  const restart = $('#restart-run');
  const status = state.activeIntent?.status;
  restart.hidden = !state.activeIntent || status === 'VERIFIED' || status === 'EXCEPTION';
  restart.textContent = status === 'RECONCILED' ? 'Play another run' : 'Restart run';
}

function renderTrace() {
  const events = state.activeIntent
    ? state.audit.filter((event) => event.aggregate_id === state.activeIntent.id).slice(0, 8)
    : state.audit.slice(0, 6);
  $('#trace-events').innerHTML = events.length
    ? events.map((event) => `<li><span>#${String(event.sequence).padStart(3, '0')}</span><span>${escapeHtml(formatAction(event.action))}</span><time datetime="${escapeHtml(event.created_at)}">${shortDate(event.created_at)}</time></li>`).join('')
    : '<li><span>#000</span><span>The trace begins when the counter initiates a run.</span><time>Ready</time></li>';
}

async function runBusy(work) {
  if (state.busy) return;
  state.busy = true;
  $('#stage-content').setAttribute('aria-busy', 'true');
  $$('button', $('#stage-content')).forEach((button) => { button.disabled = true; });
  try {
    await work();
  } catch (error) {
    toast(friendlyError(error), true);
  } finally {
    state.busy = false;
    $('#stage-content').setAttribute('aria-busy', 'false');
    $$('button', $('#stage-content')).forEach((button) => { button.disabled = false; });
  }
}

async function initiateRun(form) {
  const merchant = activeMerchant();
  const controls = merchant?.controls;
  const amount = Number(new FormData(form).get('amountUsd'));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid final total.');
  state.pendingIdempotencyKey ||= `counter-${crypto.randomUUID()}`;
  const result = await api('/api/payment-intents', {
    method: 'POST',
    actor: 'counter-one-pos-sandbox',
    body: JSON.stringify({
      merchantId: merchant.id,
      amountUsdCents: Math.round(amount * 100),
      assetCode: controls.allowed_asset_code,
      storeId: controls.store_ids[0],
      registerId: controls.register_ids[0],
      posAuthorized: true,
      idempotencyKey: state.pendingIdempotencyKey
    })
  });
  state.pendingIdempotencyKey = null;
  state.activeIntent = result;
  state.checkout = result.checkout_path ? {
    checkout_path: result.checkout_path,
    checkout_url: result.checkout_url,
    checkout_qr_path: result.checkout_qr_path
  } : null;
  state.resumeCandidate = null;
  saveSession();
  await refreshData();
  render();
  toast(`${result.public_reference} initiated. The qualified-partner gate is next.`);
}

async function openGate() {
  const intent = state.activeIntent;
  await api(`/api/payment-intents/${encodeURIComponent(intent.id)}/screen`, {
    method: 'POST',
    actor: 'qualified-partner-fixture',
    body: JSON.stringify({ decision: 'APPROVE', partnerReference: `sandbox-screen-${crypto.randomUUID()}` })
  });
  $('#gate-visual')?.classList.add('open');
  setStageStatus('Gate open', 'success');
  await sleep(780);
  await refreshData();
  saveSession();
  render();
  toast('The simulated qualified-partner gate opened.');
}

function checkoutToken() {
  if (!state.checkout?.checkout_path) return null;
  return new URL(state.checkout.checkout_path, location.origin).searchParams.get('token');
}

function renderWalletDialog() {
  const intent = state.activeIntent;
  $('#wallet-dialog-body').innerHTML = `<div class="wallet-shell">
    <div class="wallet-brand"><i>W</i><div><strong>Customer-owned sandbox wallet</strong><small>Partner fixture · no private keys requested</small></div></div>
    <div class="wallet-payment"><span>AUTHORIZE FICTIONAL PAYMENT</span><strong>${money(intent.amount_usd_cents)}</strong><small>${escapeHtml(activeMerchant()?.dba || '')}</small></div>
    <div class="wallet-facts"><div><span>Asset</span><strong>${escapeHtml(intent.asset_code)}</strong></div><div><span>Request</span><strong>${escapeHtml(intent.public_reference)}</strong></div><div><span>Network</span><strong>Deterministic sandbox</strong></div></div>
    <button class="primary-action full" type="button" data-wallet-action="authorize">Approve sandbox payment</button>
    <p class="wallet-warning">This creates a fictional signature only. It does not connect a wallet, debit a balance, move an asset, or release cannabis product.</p>
  </div>`;
  $('#wallet-dialog').showModal();
}

async function authorizeWallet() {
  const intent = state.activeIntent;
  const token = checkoutToken();
  const endpoint = token
    ? `/api/checkout/${encodeURIComponent(intent.id)}/authorize?token=${encodeURIComponent(token)}`
    : `/api/payment-intents/${encodeURIComponent(intent.id)}/submit`;
  const result = await api(endpoint, {
    method: 'POST',
    actor: 'customer-owned-wallet-fixture',
    body: JSON.stringify({
      signature: `sandboxSig-${crypto.randomUUID().replaceAll('-', '')}`,
      sourceWallet: 'GLPDemoCustomerWallet111111111111111111111111'
    })
  });
  state.activeIntent = result;
  await refreshData();
  saveSession();
  $('#wallet-dialog-body').innerHTML = '<div class="wallet-success"><i>✓</i><h3>Fictional signature sent.</h3><p>The counter can now ask two independent watchers to verify the exact transaction evidence.</p><button class="secondary-action full" type="button" data-close-dialog>Return to the counter</button></div>';
  await sleep(700);
  $('#wallet-dialog').close();
  render();
  toast('The sandbox wallet signed. Verification is now available.');
}

async function verifyIntent() {
  const intent = state.activeIntent;
  const merchant = state.merchants.find((item) => item.id === intent.merchant_id);
  const slot = 311_000_000 + Math.floor(Math.random() * 800_000);
  const evidence = {
    signature: intent.signature,
    commitment: merchant.controls.required_commitment,
    tokenProgram: intent.expected_token_program,
    mint: intent.expected_mint,
    sourceWallet: intent.source_wallet,
    destinationWallet: intent.expected_destination,
    rawAmount: intent.expected_raw_amount,
    slot,
    transactionError: false
  };
  const result = await api(`/api/payment-intents/${encodeURIComponent(intent.id)}/verify`, {
    method: 'POST',
    actor: 'dual-observer-verification-service',
    body: JSON.stringify({
      primary: { ...evidence, rpcProvider: 'sandbox-watcher-a' },
      secondary: { ...evidence, rpcProvider: 'sandbox-watcher-b' }
    })
  });
  state.activeIntent = result.intent;
  await refreshData();
  saveSession();
  render();
  toast('Both independent watchers matched the frozen payment request.');
}

async function reconcileIntent() {
  const intent = state.activeIntent;
  const result = await api(`/api/payment-intents/${encodeURIComponent(intent.id)}/reconcile`, {
    method: 'POST',
    actor: 'four-way-reconciliation-service',
    body: JSON.stringify({
      posAmountCents: intent.amount_usd_cents,
      chainRawAmount: intent.expected_raw_amount,
      partnerAmountCents: intent.amount_usd_cents
    })
  });
  state.activeIntent = result.intent;
  await refreshData();
  saveSession();
  render();
  toast('POS, chain, partner, and ledger records all agree.');
}

async function cancelIntent(intent) {
  if (!intent || TERMINAL_STATUSES.has(intent.status)) return;
  await api(`/api/payment-intents/${encodeURIComponent(intent.id)}/cancel`, {
    method: 'POST',
    actor: 'counter-one-operator',
    body: JSON.stringify({ reason: 'Sandbox run restarted by the operator.' })
  });
}

async function newRun({ cancelCurrent = false } = {}) {
  if (cancelCurrent && state.activeIntent) await cancelIntent(state.activeIntent);
  state.activeIntent = null;
  state.resumeCandidate = null;
  state.checkout = null;
  state.stage = 'counter';
  state.pendingIdempotencyKey = null;
  clearSession();
  await refreshData();
  render();
  $('#play-stage').focus();
}

async function resumeRun() {
  state.activeIntent = state.resumeCandidate;
  state.resumeCandidate = null;
  state.checkout = null;
  setStageFromIntent();
  saveSession();
  render();
  toast(`Resumed ${state.activeIntent.public_reference}.`);
}

async function cancelResume() {
  await cancelIntent(state.resumeCandidate);
  state.resumeCandidate = null;
  await refreshData();
  render();
  toast('The prior fictional run was cancelled.');
}

function startPolling() {
  clearPolling();
  state.pollTimer = setInterval(async () => {
    if (state.pollBusy || !state.activeIntent || document.hidden || !navigator.onLine) return;
    state.pollBusy = true;
    try {
      const before = state.activeIntent.status;
      await refreshData({ includeSystem: false });
      if (state.activeIntent.status !== before) {
        saveSession();
        render();
        toast('The customer handoff returned a sandbox signature.');
      }
    } catch {
      // Polling never changes the display to success on an unknown response.
    } finally {
      state.pollBusy = false;
    }
  }, 1600);
}

function clearPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function celebrate() {
  if (state.celebratedIntentId === state.activeIntent?.id || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  state.celebratedIntentId = state.activeIntent.id;
  const container = $('#confetti');
  container.innerHTML = '<i></i>'.repeat(24);
  setTimeout(() => { container.innerHTML = ''; }, 3200);
}

$('#stage-content').addEventListener('submit', (event) => {
  if (event.target.id !== 'counter-form') return;
  event.preventDefault();
  runBusy(() => initiateRun(event.target));
});

$('#stage-content').addEventListener('click', (event) => {
  const amountButton = event.target.closest('[data-amount]');
  if (amountButton) {
    $('#amount-usd').value = amountButton.dataset.amount;
    $$('[data-amount]', $('#stage-content')).forEach((button) => button.classList.toggle('selected', button === amountButton));
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'open-gate') runBusy(openGate);
  if (action === 'open-wallet') renderWalletDialog();
  if (action === 'verify') runBusy(verifyIntent);
  if (action === 'reconcile') runBusy(reconcileIntent);
  if (action === 'new-run') runBusy(() => newRun());
  if (action === 'resume-run') runBusy(resumeRun);
  if (action === 'cancel-resume') runBusy(cancelResume);
});

$('#wallet-dialog').addEventListener('click', (event) => {
  if (event.target.closest('[data-wallet-action="authorize"]')) runBusy(authorizeWallet);
});

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close-dialog]');
  if (close) close.closest('dialog')?.close();
});

$('#open-boundary').addEventListener('click', () => $('#boundary-dialog').showModal());

$('#restart-run').addEventListener('click', () => {
  const shouldCancel = state.activeIntent && !TERMINAL_STATUSES.has(state.activeIntent.status);
  runBusy(() => newRun({ cancelCurrent: shouldCancel }));
});

window.addEventListener('offline', () => {
  setStageStatus('Connection lost', 'error');
  toast('Connection lost. The sandbox will not show success until the server answers again.', true);
});

window.addEventListener('online', () => {
  toast('Connection restored. Refreshing the controlled state.');
  refreshData().then(render).catch(() => toast('The server is still unavailable.', true));
});

bootstrap().catch((error) => {
  $('#stage-content').innerHTML = renderFatal('The sandbox could not start.', friendlyError(error));
  $('#stage-content').setAttribute('aria-busy', 'false');
  setStageStatus('Unavailable', 'error');
  toast(friendlyError(error), true);
});
