(() => {
  const SUPABASE_URL = window.VICKIEARN_SUPABASE_URL;
  const supabase = window.vickiearnSupabase;
  if (!SUPABASE_URL || !supabase) return;

  async function requireUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Please log in first.');
    return user;
  }

  async function initializeDeposit(amountNaira) {
    const user = await requireUser();
    const amount = Math.round(Number(amountNaira) * 100);
    if (!Number.isSafeInteger(amount) || amount < 100) throw new Error('Enter a valid amount.');

    const { data, error } = await supabase.functions.invoke('paystack-initialize', {
      body: { amount_kobo: amount, callback_url: `${location.origin}${location.pathname}?payment=return` }
    });
    if (error) throw error;
    if (!data?.status || !data?.data?.authorization_url) throw new Error(data?.message || 'Unable to initialize payment.');
    location.href = data.data.authorization_url;
  }

  async function requestWithdrawal(amountNaira, accountName, accountNumber, bankCode) {
    await requireUser();
    const amount = Math.round(Number(amountNaira) * 100);
    if (!Number.isSafeInteger(amount)) throw new Error('Enter a valid amount.');
    const { data, error } = await supabase.rpc('create_withdrawal_request', {
      p_amount_kobo: amount,
      p_account_name: accountName,
      p_account_number: accountNumber,
      p_bank_code: bankCode
    });
    if (error) throw error;
    return data;
  }

  window.VickiEarnPayments = { initializeDeposit, requestWithdrawal };
})();
