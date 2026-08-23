(() => {
  const FIXED_TIERS = ['starter','plus','pro','business'];
  const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = kobo => `₦${(Number(kobo || 0) / 100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  async function premiumTiers() {
    const { data, error } = await window.vickiearnSupabase
      .from('premium_tiers')
      .select('id,name,amount_kobo,daily_task_limit,description')
      .in('id', FIXED_TIERS)
      .order('amount_kobo');
    if (error) throw error;
    return data || [];
  }

  window.openCustomDeposit = function () {
    if (typeof window.openActionModal !== 'function') return;
    window.openActionModal(`<h2>Normal wallet deposit</h2><p>Enter the amount you want to add to your VickiEarn wallet.</p><label>Amount in Naira</label><input id="customDepositAmount" type="number" min="100" step="100" placeholder="1000"><button class="primary-action" onclick="window.__startCustomDeposit()">Continue to payment</button>`);
  };

  window.__startCustomDeposit = async function () {
    try {
      const amount = Number(document.getElementById('customDepositAmount')?.value || 0);
      if (!Number.isFinite(amount) || amount < 100) throw new Error('Enter at least ₦100.');
      if (!window.VickiEarnPayments?.initializeDeposit) throw new Error('Payment service is still loading. Please try again.');
      await window.VickiEarnPayments.initializeDeposit(amount, 'wallet');
    } catch (e) {
      if (typeof window.showToast === 'function') window.showToast(e.message || 'Payment could not start.');
    }
  };

  window.deposit = async function () {
    try {
      const tiers = await premiumTiers();
      if (!tiers.length) throw new Error('Premium tiers are temporarily unavailable. Please refresh.');
      const cards = tiers.map(t => `
        <button class="tier-option" onclick="submitDepositTier('${String(t.id).replace(/'/g,"\\'")}',${Number(t.amount_kobo)})">
          <b>${safe(t.name)}</b>
          <strong>${money(t.amount_kobo)}</strong>
          <small>${safe(t.description || 'Premium task access')} · Up to ${Number(t.daily_task_limit || 0)} task submissions/day</small>
        </button>`).join('');
      window.openActionModal(`<h2>Premium task access</h2>
        <p>Choose one of the four fixed premium access amounts. Your payment is verified by VickiEarn's server before wallet credit and access activation.</p>
        <div class="tier-grid">${cards}</div>
        <div class="action-note"><b>Important:</b> Premium access unlocks additional eligible tasks. It does not guarantee profit or a fixed cash return. Rewards are earned only from completed and approved tasks.</div>
        <button class="secondary-action" onclick="openCustomDeposit()">Make a normal wallet deposit</button>`);
    } catch (e) {
      if (typeof window.showToast === 'function') window.showToast(e.message || 'Unable to load premium tiers.');
    }
  };

  window.submitDepositTier = async function (tier, amountKobo) {
    try {
      if (!window.VickiEarnPayments?.initializeDeposit) throw new Error('Payment service is still loading. Please try again.');
      await window.VickiEarnPayments.initializeDeposit(Number(amountKobo) / 100, tier);
    } catch (e) {
      if (typeof window.showToast === 'function') window.showToast(e.message || 'Payment could not start.');
    }
  };

  window.__verifyVickiEarnPayment = async function () {
    const params = new URLSearchParams(location.search);
    const reference = params.get('reference') || params.get('trxref');
    if (!reference || !window.VickiEarnPayments?.verifyReturnedPayment) return;
    const ok = await window.VickiEarnPayments.verifyReturnedPayment();
    if (ok && typeof window.loadDashboard === 'function') await window.loadDashboard();
  };

  window.addEventListener('load', () => setTimeout(() => window.__verifyVickiEarnPayment(), 250));
})();
