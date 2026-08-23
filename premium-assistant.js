(() => {
  const FIXED_TIERS = ['starter','plus','pro','business'];
  const originalDeposit = window.deposit;

  function premiumTiers() {
    return (window.currentTiers || []).filter(t => FIXED_TIERS.includes(String(t.id)));
  }

  window.deposit = function () {
    const tiers = premiumTiers();
    if (!tiers.length) {
      if (typeof showToast === 'function') showToast('Premium tiers are temporarily unavailable. Please refresh.');
      return;
    }
    const cards = tiers.map(t => `
      <button class="tier-option" onclick="submitDepositTier('${String(t.id).replace(/'/g,"\\'")}',${Number(t.amount_kobo)})">
        <b>${escapeHtml(t.name)}</b>
        <strong>${naira(t.amount_kobo)}</strong>
        <small>${escapeHtml(t.description || 'Premium task access')} · Up to ${Number(t.daily_task_limit || 0)} task submissions/day</small>
      </button>`).join('');
    openActionModal(`<h2>Premium task access</h2>
      <p>Choose one of the four fixed premium access amounts. Your payment is verified by VickiEarn's server before wallet credit and access activation.</p>
      <div class="tier-grid">${cards}</div>
      <div class="action-note"><b>Important:</b> Premium access unlocks additional eligible tasks. It does not guarantee profit or a fixed cash return. Rewards are earned only from completed and approved tasks.</div>
      <button class="secondary-action" onclick="openCustomDeposit()">Make a normal wallet deposit</button>`);
  };

  window.__verifyVickiEarnPayment = async function () {
    const params = new URLSearchParams(location.search);
    const reference = params.get('reference') || params.get('trxref');
    if (!reference || !window.VickiEarnPayments?.verifyReturnedPayment) return;
    const ok = await window.VickiEarnPayments.verifyReturnedPayment();
    if (ok) {
      await loadDashboard();
    }
  };

  const start = window.loadDashboard;
  window.loadDashboard = async function () {
    await start();
    window.currentTiers = (window.currentTiers || []).slice();
  };

  window.addEventListener('load', () => {
    setTimeout(() => window.__verifyVickiEarnPayment(), 250);
  });
})();
