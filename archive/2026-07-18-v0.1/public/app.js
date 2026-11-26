const state = {
  dashboard: null,
  partners: [],
  merchants: [],
  intents: [],
  audit: [],
  selectedMerchantId: null
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-GLP-Actor': 'sandbox-dashboard',
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Request failed.');
    error.code = payload.error?.code;
    error.details = payload.error?.details;
    throw error;
  }
  return payload;
}

function money(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
}

function shortDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function status(value) {
  return `<span class="status ${escapeHtml(value)}">${escapeHtml(String(value).replaceAll('_', ' '))}</span>`;
}

let toastTimer;
function toast(message, isError = false) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.toggle('error', isError);
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3600);
}

function selectedMerchant() {
  return state.merchants.find((merchant) => merchant.id === state.selectedMerchantId) || state.merchants[0];
}

async function loadAll({ quiet = false } = {}) {
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
  if (!state.selectedMerchantId || !state.merchants.some((merchant) => merchant.id === state.selectedMerchantId)) {
    state.selectedMerchantId = state.merchants[0]?.id || null;
  }
  render();
  if (!quiet) toast('Records refreshed.');
}

function render() {
  renderMetrics();
  renderMerchantOptions();
  renderControls();
  renderIntents();
  renderQualifications();
  renderAudit();
}

function renderMetrics() {
  const summary = state.dashboard;
  $('#metric-partners').textContent = summary.approved_partners;
  $('#metric-merchants').textContent = summary.active_merchants;
  $('#metric-open').textContent = summary.open_payment_intents;
  $('#metric-ledger').textContent = money(summary.ledger_difference_cents);
  $('#metric-ledger').style.color = summary.ledger_difference_cents === 0 ? 'var(--green)' : 'var(--red)';
  $('#metric-audit').textContent = summary.audit.valid ? 'Valid' : 'Failed';
  $('#metric-audit').style.color = summary.audit.valid ? 'var(--green)' : 'var(--red)';
  $('#metric-audit-detail').textContent = `${summary.audit.events_checked} hash-linked events`;
}

function renderMerchantOptions() {
  const select = $('#payment-merchant');
  select.innerHTML = state.merchants.map((merchant) =>
    `<option value="${escapeHtml(merchant.id)}" ${merchant.id === state.selectedMerchantId ? 'selected' : ''}>${escapeHtml(merchant.dba)} — ${escapeHtml(merchant.state)}</option>`
  ).join('');
  updatePaymentFields();
}

function updatePaymentFields() {
  const merchant = selectedMerchant();
  if (!merchant?.controls) return;
  $('#payment-asset').value = merchant.controls.allowed_asset_code;
  $('#payment-store').innerHTML = merchant.controls.store_ids.map((item) => `<option>${escapeHtml(item)}</option>`).join('');
  $('#payment-register').innerHTML = merchant.controls.register_ids.map((item) => `<option>${escapeHtml(item)}</option>`).join('');
}

function renderControls() {
  const merchant = selectedMerchant();
  if (!merchant?.controls) return;
  const controls = merchant.controls;
  $('#control-paused').checked = controls.paused;
  $('#control-per-tx').value = (controls.per_transaction_limit_cents / 100).toFixed(2);
  $('#control-daily').value = (controls.daily_limit_cents / 100).toFixed(2);
  $('#control-commitment').value = controls.required_commitment;
  $('#control-asset').textContent = `${controls.allowed_asset_code} · ${controls.allowed_mint}`;
  $('#control-wallet').textContent = merchant.settlement_wallet;
}

function actionFor(intent) {
  if (intent.status === 'SCREENING_REQUIRED') return { action: 'screen', label: 'Approve screening' };
  if (intent.status === 'REVIEW_REQUIRED') return { action: 'screen', label: 'Approve review' };
  if (intent.status === 'READY_FOR_PAYMENT') return { action: 'submit', label: 'Record sandbox signature' };
  if (intent.status === 'SUBMITTED') return { action: 'verify', label: 'Verify dual-RPC evidence' };
  if (intent.status === 'VERIFIED' || intent.status === 'EXCEPTION') return { action: 'reconcile', label: 'Run reconciliation' };
  return null;
}

function renderIntents() {
  const body = $('#intent-rows');
  $('#intent-empty').hidden = state.intents.length > 0;
  body.innerHTML = state.intents.map((intent) => {
    const next = actionFor(intent);
    const evidence = intent.signature
      ? `<code>${escapeHtml(intent.signature.slice(0, 14))}…</code><small>${escapeHtml(intent.status_reason || 'Signature recorded')}</small>`
      : '<small>Awaiting transaction evidence</small>';
    return `<tr>
      <td data-label="Reference"><strong>${escapeHtml(intent.public_reference)}</strong><small>${shortDate(intent.created_at)}</small></td>
      <td data-label="Counter"><strong>${escapeHtml(intent.store_id)}</strong><small>${escapeHtml(intent.register_id)}</small></td>
      <td data-label="Amount"><strong>${money(intent.amount_usd_cents)}</strong><small>${escapeHtml(intent.asset_code)}</small></td>
      <td data-label="Status">${status(intent.status)}</td>
      <td data-label="Evidence">${evidence}</td>
      <td data-label="Next action"><div class="row-actions">${next ? `<button data-action="${next.action}" data-intent-id="${escapeHtml(intent.id)}">${next.label}</button>` : '<small>Record complete for current state</small>'}</div></td>
    </tr>`;
  }).join('');
}

function renderQualifications() {
  const partners = state.partners.map((partner) => `<div class="record-card">
    <header><div><strong>${escapeHtml(partner.legal_name)}</strong><small>Settlement and screening partner</small></div>${status(partner.status)}</header>
    <div class="record-list">
      <span>Written cannabis scope</span><span>Custody authority recorded</span>
      <span>Screening authority recorded</span><span>Settlement authority recorded</span>
    </div>
    <code>${escapeHtml(partner.cannabis_approval_reference || 'Approval reference missing')}</code>
  </div>`).join('');
  const merchants = state.merchants.map((merchant) => `<div class="record-card">
    <header><div><strong>${escapeHtml(merchant.dba)}</strong><small>${escapeHtml(merchant.state)} · ${escapeHtml(merchant.license_category)} · ${escapeHtml(merchant.pos_provider)}</small></div>${status(merchant.status)}</header>
    <div class="record-list">
      <span>License record captured</span><span>State source recorded</span>
      <span>POS identity bound</span><span>Counter limits active</span>
    </div>
    <code>${escapeHtml(merchant.license_number)} · ${escapeHtml(merchant.license_verification_source)}</code>
  </div>`).join('');
  $('#qualification-records').innerHTML = partners + merchants;
}

function renderAudit() {
  $('#audit-events').innerHTML = state.audit.map((event) => `<li>
    <span class="sequence">#${String(event.sequence).padStart(3, '0')}</span>
    <span><strong>${escapeHtml(event.action.replaceAll('_', ' '))}</strong><small>${escapeHtml(event.aggregate_type)} · ${escapeHtml(event.actor)} · ${escapeHtml(event.event_hash.slice(0, 12))}…</small></span>
    <time datetime="${escapeHtml(event.created_at)}">${shortDate(event.created_at)}</time>
  </li>`).join('');
}

$('#payment-merchant').addEventListener('change', (event) => {
  state.selectedMerchantId = event.target.value;
  updatePaymentFields();
  renderControls();
});

$('#payment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const amountUsdCents = Math.round(Number(form.get('amountUsd')) * 100);
  try {
    const result = await api('/api/payment-intents', {
      method: 'POST',
      body: JSON.stringify({
        merchantId: form.get('merchantId'),
        amountUsdCents,
        assetCode: form.get('assetCode'),
        storeId: form.get('storeId'),
        registerId: form.get('registerId'),
        posAuthorized: form.get('posAuthorized') === 'on',
        idempotencyKey: `pos-${crypto.randomUUID()}`
      })
    });
    const resultBox = $('#checkout-result');
    resultBox.hidden = false;
    resultBox.innerHTML = `<p><strong>${escapeHtml(result.public_reference)}</strong> is ready for partner screening. The one-time checkout token expires at ${shortDate(result.checkout_expires_at)}.</p><code>${escapeHtml(result.checkout_uri)}</code>`;
    await loadAll({ quiet: true });
    toast('One-time payment request created.');
  } catch (error) {
    toast(`${error.code || 'ERROR'}: ${error.message}`, true);
  }
});

$('#controls-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const merchant = selectedMerchant();
  const controls = merchant.controls;
  const form = new FormData(event.currentTarget);
  try {
    await api(`/api/merchants/${merchant.id}/controls`, {
      method: 'PATCH',
      body: JSON.stringify({
        paused: form.get('paused') === 'on',
        perTransactionLimitCents: Math.round(Number(form.get('perTransaction')) * 100),
        dailyLimitCents: Math.round(Number(form.get('daily')) * 100),
        allowedAssetCode: controls.allowed_asset_code,
        allowedMint: controls.allowed_mint,
        tokenProgram: controls.token_program,
        requiredCommitment: form.get('commitment'),
        storeIds: controls.store_ids,
        registerIds: controls.register_ids
      })
    });
    await loadAll({ quiet: true });
    toast('Merchant controls saved and recorded.');
  } catch (error) {
    toast(`${error.code || 'ERROR'}: ${error.message}`, true);
  }
});

$('#intent-rows').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const intent = state.intents.find((item) => item.id === button.dataset.intentId);
  if (!intent) return;
  button.disabled = true;
  try {
    if (button.dataset.action === 'screen') await approveScreening(intent);
    if (button.dataset.action === 'submit') await submitSandboxSignature(intent);
    if (button.dataset.action === 'verify') await verifySandboxEvidence(intent);
    if (button.dataset.action === 'reconcile') await reconcile(intent);
    await loadAll({ quiet: true });
  } catch (error) {
    toast(`${error.code || 'ERROR'}: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});

async function approveScreening(intent) {
  await api(`/api/payment-intents/${intent.id}/screen`, {
    method: 'POST',
    body: JSON.stringify({ decision: 'APPROVE', partnerReference: `sandbox-screen-${Date.now()}` })
  });
  toast('Partner screening approval recorded.');
}

async function submitSandboxSignature(intent) {
  await api(`/api/payment-intents/${intent.id}/submit`, {
    method: 'POST',
    body: JSON.stringify({
      signature: `sandboxSig-${crypto.randomUUID().replaceAll('-', '')}`,
      sourceWallet: 'GLPDemoCustomerWallet111111111111111111111111'
    })
  });
  toast('Sandbox transaction signature recorded.');
}

async function verifySandboxEvidence(intent) {
  const merchant = state.merchants.find((item) => item.id === intent.merchant_id);
  const slot = 310_000_000 + Math.floor(Math.random() * 1_000_000);
  const base = {
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
  await api(`/api/payment-intents/${intent.id}/verify`, {
    method: 'POST',
    body: JSON.stringify({
      primary: { ...base, rpcProvider: 'sandbox-rpc-primary' },
      secondary: { ...base, rpcProvider: 'sandbox-rpc-independent' }
    })
  });
  toast('Independent evidence matched; operational ledger posted.');
}

async function reconcile(intent) {
  await api(`/api/payment-intents/${intent.id}/reconcile`, {
    method: 'POST',
    body: JSON.stringify({
      posAmountCents: intent.amount_usd_cents,
      chainRawAmount: intent.expected_raw_amount,
      partnerAmountCents: intent.amount_usd_cents
    })
  });
  toast('POS, chain, partner, and ledger records reconciled.');
}

$('#refresh').addEventListener('click', () => loadAll().catch((error) => toast(error.message, true)));

loadAll({ quiet: true }).catch((error) => toast(`Unable to load sandbox: ${error.message}`, true));
