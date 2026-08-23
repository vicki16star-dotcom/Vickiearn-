(() => {
  const FIXED_TIERS = ['starter','plus','pro','business'];

  async function premiumTiers() {
    const { data, error } = await window.vickiearnSupabase
      .from('premium_tiers')
      .select('id,name,amount_kobo,daily_task_limit,description')
      .in('id', FIXED_TIERS)
      .order('amount_kobo');
    if (error) throw error;
    return data || [];
  }

  window.deposit = async function () {
    try {
      const tiers = await premiumTiers();
      if (!tiers.length) throw new Error('Premium tiers are temporarily unavailable. Please refresh.');
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
    } catch (e) {
      showToast(e.message || 'Unable to load premium tiers.');
    }
  };

  window.__verifyVickiEarnPayment = async function () {
    const params = new URLSearchParams(location.search);
    const reference = params.get('reference') || params.get('trxref');
    if (!reference || !window.VickiEarnPayments?.verifyReturnedPayment) return;
    const ok = await window.VickiEarnPayments.verifyReturnedPayment();
    if (ok) await window.loadDashboard();
  };

  window.addEventListener('load', () => {
    setTimeout(() => window.__verifyVickiEarnPayment(), 250);
  });
})();
