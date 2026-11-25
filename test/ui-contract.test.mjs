import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const paths = {
  sandboxHtml: new URL('../public/index.html', import.meta.url),
  sandboxCss: new URL('../public/styles.css', import.meta.url),
  sandboxJs: new URL('../public/app.js', import.meta.url),
  checkoutHtml: new URL('../public/checkout.html', import.meta.url),
  checkoutCss: new URL('../public/checkout.css', import.meta.url),
  developerHtml: new URL('../public/developer.html', import.meta.url),
  developerJs: new URL('../public/developer.js', import.meta.url),
  server: new URL('../src/server.mjs', import.meta.url),
  packageJson: new URL('../package.json', import.meta.url)
};

async function sources() {
  return Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await readFile(path, 'utf8')])));
}

test('v0.1.1 keeps playable, customer, and developer surfaces distinct', async () => {
  const source = await sources();
  const packageJson = JSON.parse(source.packageJson);
  assert.equal(packageJson.version, '0.1.1');
  assert.match(`${source.sandboxHtml}\n${source.sandboxJs}`, /Initiate Green Light Pay/);
  assert.match(source.sandboxHtml, /id="journey-list"/);
  assert.match(source.checkoutHtml, /ONE-TIME HANDOFF/);
  assert.match(source.developerHtml, /id="terminal-input"/);
  assert.match(source.server, /'\/developer': 'developer\.html'/);
  assert.match(source.server, /'\/checkout\/': 'checkout\.html'/);
});

test('strict CSP-compatible pages avoid inline scripts, handlers, and style attributes', async () => {
  const source = await sources();
  for (const html of [source.sandboxHtml, source.checkoutHtml, source.developerHtml]) {
    assert.doesNotMatch(html, /\son\w+=/i);
    assert.doesNotMatch(html, /\sstyle=/i);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i);
  }
  assert.match(source.server, /style-src 'self'/);
  assert.doesNotMatch(source.server, /style-src[^;]*unsafe-inline/);
  assert.doesNotMatch(source.sandboxJs, /style="/);
});

test('phone contract retains target breakpoints and minimum primary actions', async () => {
  const source = await sources();
  assert.match(source.sandboxCss, /@media \(max-width: 760px\)/);
  assert.match(source.sandboxCss, /@media \(max-width: 430px\)/);
  assert.match(source.sandboxCss, /min-height: 54px/);
  assert.match(source.checkoutCss, /min-height: 56px/);
  assert.match(source.sandboxCss, /prefers-reduced-motion/);
  assert.match(source.sandboxHtml, /aria-live="polite"/);
  assert.match(source.sandboxJs, /Connection lost[\s\S]*will not show success/);
});
