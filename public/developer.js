const state = { dashboard: null, partners: [], merchants: [], intents: [], audit: [], selectedMerchantId: null };
const $ = (selector, root = document) => root.querySelector(selector);
const terminal = $('#terminal-output');
const commandHistory = [];
let historyIndex = 0;

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'X-GLP-Actor': options.actor || 'glp-developer-console' } });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Request failed.');
    error.code = payload.error?.code;
    throw error;
  }
  return payload;
}

function money(cents) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100); }
function shortDate(value) { return value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '—'; }
function formatAction(value) { return String(value || '').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function status(value) { return `<span class="status ${escapeHtml(value)}">${escapeHtml(value)}</span>`; }
function selectedMerchant() { return state.merchants.find((merchant) => merchant.id === state.selectedMerchantId) || state.merchants[0]; }

let toastTimer;
function toast(message, isError = false) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.toggle('error', isError);
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3600);
}

function print(value, tone = '') {
  const line = document.createElement('div');
  line.className = `terminal-line ${tone}`.trim();
  line.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  terminal.append(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function printCommand(command) {
  const line = document.createElement('div');
  line.className = 'terminal-line command';
  line.innerHTML = `<span class="prompt">glp@sandbox:~$</span>${escapeHtml(command)}`;
  terminal.append(line);
}

function bootTerminal() {
  terminal.innerHTML = '';
  print('GREEN LIGHT PAY CONTROL PLANE / prototype 0.1.1', 'info');
  print('Boundary: sandbox orchestration + verification. live_money_movement=false');
  print('Type `help` to inspect the system. Use `/` to play the counter journey.');
}

async function loadAll({ quiet = false } = {}) {
  const [dashboard, partners, merchants, intents, audit] = await Promise.all([
    api('/api/dashboard'), api('/api/partners'), api('/api/merchants'), api('/api/payment-intents?limit=100'), api('/api/audit?limit=100')
  ]);
  state.dashboard = dashboard;
  state.partners = partners.partners;
  state.merchants = merchants.merchants;
  state.intents = intents.payment_intents;
  state.audit = audit.events;
  if (!state.selectedMerchantId || !state.merchants.some((merchant) => merchant.id === state.selectedMerchantId)) state.selectedMerchantId = state.merchants[0]?.id;
  render();
  if (!quiet) toast('Developer records refreshed.');
}

function render() {
  renderSystem();
  renderControls();
  renderIntents();
  renderQualifications();
  renderAudit();
}

function renderSystem() {
  const data = state.dashboard;
  $('#sys-mode').textContent = data.mode;
  $('#sys-version').textContent = `v${data.prototype_version || '0.1.1'}`;
  $('#sys-partners').textContent = data.approved_partners;
  $('#sys-merchants').textContent = data.active_merchants;
  $('#sys-open').textContent = data.open_payment_intents;
  $('#sys-ledger').textContent = money(data.ledger_difference_cents);
  $('#sys-ledger').style.color = data.ledger_difference_cents === 0 ? 'var(--green)' : 'var(--red)';
  $('#sys-audit').textContent = data.audit.valid ? 'VALID' : 'FAILED';
  $('#sys-audit').style.color = data.audit.valid ? 'var(--green)' : 'var(--red)';
  $('#sys-audit-detail').textContent = `${data.audit.events_checked} events checked`;
}

function renderControls() {
  const merchant = selectedMerchant();
  if (!merchant?.controls) return;
  const controls = merchant.controls;
  $('#control-paused').checked = controls.paused;
  $('#control-per-tx').value = (controls.per_transaction_limit_cents / 100).toFixed(2);
  $('#control-daily').value = (controls.daily_limit_cents / 100).toFixed(2);
  $('#control-commitment').value = controls.required_commitment;
  $('#control-asset').textContent = `${controls.allowed_asset_code} :: ${controls.allowed_mint}`;
  $('#control-wallet').textContent = merchant.settlement_wallet;
  $('#controls-updated').textContent = shortDate(controls.updated_at);
}

function actionFor(intent) {
  if (['SCREENING_REQUIRED', 'REVIEW_REQUIRED'].includes(intent.status)) return { action: 'screen', label: 'POST screen APPROVE' };
  if (intent.status === 'READY_FOR_PAYMENT') return { action: 'submit', label: 'POST demo signature' };
  if (intent.status === 'SUBMITTED') return { action: 'verify', label: 'POST dual verify' };
  if (['VERIFIED', 'EXCEPTION'].includes(intent.status)) return { action: 'reconcile', label: 'POST reconcile' };
  return null;
}

function renderIntents() {
  const requested = new URLSearchParams(location.search).get('intent');
  $('#intent-empty').hidden = state.intents.length > 0;
  $('#intent-rows').innerHTML = state.intents.map((intent) => {
    const action = actionFor(intent);
    const evidence = intent.signature ? `${escapeHtml(intent.signature.slice(0, 15))}…` : 'awaiting signature';
    return `<tr class="${intent.id === requested ? 'highlight' : ''}">
      <td><strong>${escapeHtml(intent.public_reference)}</strong><small>${shortDate(intent.created_at)}</small></td>
      <td><strong>${escapeHtml(intent.store_id)}</strong><small>${escapeHtml(intent.register_id)}</small></td>
      <td><strong>${money(intent.amount_usd_cents)}</strong><small>${escapeHtml(intent.asset_code)}</small></td>
      <td>${status(intent.status)}</td>
      <td><code>${evidence}</code><small>${escapeHtml(intent.status_reason || 'no exception')}</small></td>
      <td>${action ? `<button class="row-action" type="button" data-action="${action.action}" data-intent-id="${escapeHtml(intent.id)}">${action.label}</button>` : '<small>no command available</small>'}</td>
    </tr>`;
  }).join('');
  if (requested) document.querySelector('tr.highlight')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderQualifications() {
  const partnerCards = state.partners.map((partner) => `<div class="record"><header><div><strong>${escapeHtml(partner.legal_name)}</strong><small>regulated-partner fixture</small></div>${status(partner.status)}</header><dl><div><dt>approval_reference</dt><dd>${escapeHtml(partner.cannabis_approval_reference)}</dd></div><div><dt>screening_authorized</dt><dd>${partner.screening_authorized}</dd></div><div><dt>settlement_authorized</dt><dd>${partner.settlement_authorized}</dd></div><div><dt>expires_at</dt><dd>${escapeHtml(partner.approval_expires_at)}</dd></div></dl></div>`).join('');
  const merchantCards = state.merchants.map((merchant) => `<div class="record"><header><div><strong>${escapeHtml(merchant.dba)}</strong><small>merchant fixture · ${escapeHtml(merchant.state)}</small></div>${status(merchant.status)}</header><dl><div><dt>license</dt><dd>${escapeHtml(merchant.license_number)}</dd></div><div><dt>category</dt><dd>${escapeHtml(merchant.license_category)}</dd></div><div><dt>pos_provider</dt><dd>${escapeHtml(merchant.pos_provider)}</dd></div><div><dt>sandbox_only</dt><dd>${merchant.sandbox_only}</dd></div></dl></div>`).join('');
  $('#qualification-records').innerHTML = partnerCards + merchantCards;
}

function renderAudit() {
  $('#audit-events').innerHTML = state.audit.map((event) => `<li><b>#${String(event.sequence).padStart(3, '0')}</b><span><strong>${escapeHtml(formatAction(event.action))}</strong><small>${escapeHtml(event.aggregate_type)} :: ${escapeHtml(event.actor)} :: ${escapeHtml(event.event_hash.slice(0, 12))}…</small></span><time>${shortDate(event.created_at)}</time></li>`).join('');
}

async function runIntentAction(intent, action) {
  if (action === 'screen') await api(`/api/payment-intents/${intent.id}/screen`, { method: 'POST', actor: 'developer-partner-fixture', body: JSON.stringify({ decision: 'APPROVE', partnerReference: `dev-screen-${crypto.randomUUID()}` }) });
  if (action === 'submit') await api(`/api/payment-intents/${intent.id}/submit`, { method: 'POST', actor: 'developer-wallet-fixture', body: JSON.stringify({ signature: `sandboxSig-${crypto.randomUUID().replaceAll('-', '')}`, sourceWallet: 'GLPDemoCustomerWallet111111111111111111111111' }) });
  if (action === 'verify') {
    const merchant = state.merchants.find((item) => item.id === intent.merchant_id);
    const slot = 312_000_000 + Math.floor(Math.random() * 500_000);
    const evidence = { signature: intent.signature, commitment: merchant.controls.required_commitment, tokenProgram: intent.expected_token_program, mint: intent.expected_mint, sourceWallet: intent.source_wallet, destinationWallet: intent.expected_destination, rawAmount: intent.expected_raw_amount, slot, transactionError: false };
    await api(`/api/payment-intents/${intent.id}/verify`, { method: 'POST', actor: 'developer-verifier', body: JSON.stringify({ primary: { ...evidence, rpcProvider: 'dev-watcher-a' }, secondary: { ...evidence, rpcProvider: 'dev-watcher-b' } }) });
  }
  if (action === 'reconcile') await api(`/api/payment-intents/${intent.id}/reconcile`, { method: 'POST', actor: 'developer-reconciler', body: JSON.stringify({ posAmountCents: intent.amount_usd_cents, chainRawAmount: intent.expected_raw_amount, partnerAmountCents: intent.amount_usd_cents }) });
  await loadAll({ quiet: true });
  print(`${action.toUpperCase()} completed for ${intent.public_reference}`, 'info');
  toast(`${intent.public_reference}: ${action} command completed.`);
}

async function execute(command) {
  const normalized = command.trim();
  if (!normalized) return;
  printCommand(normalized);
  const [name, ...args] = normalized.split(/\s+/);
  const verb = name.toLowerCase();
  if (verb === 'help') {
    print('commands:\n  health              system boundary + integrity\n  intents             list payment runs\n  inspect <reference> show one minimized intent\n  merchant            active merchant record\n  partner             assigned partner record\n  controls            merchant controls JSON\n  audit               recalculate audit chain\n  routes              API route summary\n  refresh             reload all records\n  open                 launch playable sandbox\n  clear                clear terminal');
    return;
  }
  if (verb === 'clear') { bootTerminal(); return; }
  if (verb === 'open') { location.href = '/'; return; }
  if (verb === 'refresh') { await loadAll({ quiet: true }); print('records refreshed', 'info'); return; }
  if (verb === 'health') { print(state.dashboard); return; }
  if (verb === 'intents') { print(state.intents.map(({ public_reference, amount_usd, status, store_id, register_id }) => ({ public_reference, amount_usd, status, store_id, register_id }))); return; }
  if (verb === 'merchant') { print(selectedMerchant()); return; }
  if (verb === 'partner') { print(state.partners.find((partner) => partner.id === selectedMerchant()?.partner_id) || state.partners[0]); return; }
  if (verb === 'controls') { print(selectedMerchant()?.controls || {}); return; }
  if (verb === 'audit') { print(await api('/api/audit/verify')); return; }
  if (verb === 'routes') { print('GET  /api/health\nPOST /api/payment-intents\nPOST /api/payment-intents/:id/screen\nGET  /api/checkout/:id\nPOST /api/checkout/:id/authorize\nPOST /api/payment-intents/:id/verify\nPOST /api/payment-intents/:id/reconcile\nGET  /api/audit/verify'); return; }
  if (verb === 'inspect') {
    const key = args.join(' ').toUpperCase();
    const intent = state.intents.find((item) => item.public_reference.toUpperCase() === key || item.id === args[0]);
    if (!intent) throw new Error('intent not found; use `intents` to list references');
    print(intent);
    return;
  }
  throw new Error(`unknown command: ${verb}. Type help.`);
}

$('#terminal-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#terminal-input');
  const command = input.value;
  input.value = '';
  if (command.trim()) { commandHistory.push(command); historyIndex = commandHistory.length; }
  try { await execute(command); } catch (error) { print(`${error.code ? `${error.code}: ` : ''}${error.message}`, 'error'); }
});

$('#terminal-input').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowUp' && commandHistory.length) { event.preventDefault(); historyIndex = Math.max(0, historyIndex - 1); event.currentTarget.value = commandHistory[historyIndex]; }
  if (event.key === 'ArrowDown' && commandHistory.length) { event.preventDefault(); historyIndex = Math.min(commandHistory.length, historyIndex + 1); event.currentTarget.value = commandHistory[historyIndex] || ''; }
});

$('#terminal-clear').addEventListener('click', bootTerminal);
$('#refresh-data').addEventListener('click', () => loadAll().catch((error) => toast(error.message, true)));

$('#controls-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const merchant = selectedMerchant();
  const controls = merchant.controls;
  const form = new FormData(event.currentTarget);
  try {
    await api(`/api/merchants/${merchant.id}/controls`, { method: 'PATCH', actor: 'developer-merchant-operator', body: JSON.stringify({ paused: form.get('paused') === 'on', perTransactionLimitCents: Math.round(Number(form.get('perTransaction')) * 100), dailyLimitCents: Math.round(Number(form.get('daily')) * 100), allowedAssetCode: controls.allowed_asset_code, allowedMint: controls.allowed_mint, tokenProgram: controls.token_program, requiredCommitment: form.get('commitment'), storeIds: controls.store_ids, registerIds: controls.register_ids }) });
    await loadAll({ quiet: true });
    print('PATCH merchant.controls -> 200 OK', 'info');
    toast('Merchant controls saved and audit-linked.');
  } catch (error) { print(`${error.code || 'ERROR'}: ${error.message}`, 'error'); toast(error.message, true); }
});

$('#intent-rows').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const intent = state.intents.find((item) => item.id === button.dataset.intentId);
  if (!intent) return;
  button.disabled = true;
  try { await runIntentAction(intent, button.dataset.action); } catch (error) { print(`${error.code || 'ERROR'}: ${error.message}`, 'error'); toast(error.message, true); } finally { button.disabled = false; }
});

bootTerminal();
loadAll({ quiet: true }).then(() => print('bootstrap complete: merchant=ready partner=qualified audit=valid', 'info')).catch((error) => { print(`BOOT_FAILED: ${error.message}`, 'error'); toast(error.message, true); });
