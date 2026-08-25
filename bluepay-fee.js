const BLUEPAY_FEE_NGN=10000;
const BLUEPAY_FLUTTERWAVE_LINK='https://flutterwave.com/pay/0zvts47js4us';

async function startBluePayFeePayment(){
  try{
    const db=window.vickiearnSupabase;
    if(!db) throw new Error('Payment service is unavailable.');
    const {data:{user},error}=await db.auth.getUser();
    if(error||!user) throw new Error('Please sign in before paying the withdrawal fee.');
    openActionModal(`<h2>Withdrawal processing fee</h2><p><b>₦10,000</b> — Withdrawal Processing & Verification Fee.</p><p>This fee covers BluePay's stated withdrawal-processing and account-verification service. It is separate from your withdrawal amount.</p><div class="action-note">You will be redirected to BluePay's official Flutterwave checkout. BluePay will only treat the fee as paid after server-side payment confirmation.</div><button class="primary-action" onclick="window.location.href='${BLUEPAY_FLUTTERWAVE_LINK}'">Continue to Flutterwave →</button><button class="secondary-action" onclick="closeActionModal()">Cancel</button>`);
  }catch(e){showToast(e.message||'Unable to start payment.')}
}

async function requestWithdrawal(){
  try{
    const db=window.vickiearnSupabase;
    if(!db) throw new Error('Dashboard connection is unavailable.');
    const {data:{user},error}=await db.auth.getUser();
    if(error||!user) throw new Error('Please sign in again.');
    const w=await db.from('wallets').select('balance_kobo').eq('user_id',user.id).maybeSingle();
    if(w.error) throw w.error;
    const balance=Number(w.data?.balance_kobo||0);
    const feeConfirmed=user.user_metadata?.withdrawal_fee_paid===true;
    openActionModal(`<h2>Withdraw money</h2><p>Available balance: <b>₦${(balance/100).toLocaleString('en-NG',{minimumFractionDigits:2})}</b></p>${!feeConfirmed?`<div class="action-note warning"><b>Withdrawal locked.</b><br>Required fee: <b>₦${BLUEPAY_FEE_NGN.toLocaleString()}</b><br><small>Purpose: withdrawal processing and account verification.</small></div><button class="primary-action" onclick="startBluePayFeePayment()">Pay ₦10,000 & verify →</button><button class="secondary-action" onclick="closeActionModal()">Close</button>`:balance>=500000?'<input id="withdrawAmount" type="number" min="5000" placeholder="Amount in Naira"><input id="accountName" placeholder="Account name"><input id="accountNumber" inputmode="numeric" maxlength="10" placeholder="10-digit account number"><input id="bankCode" inputmode="numeric" placeholder="Bank code"><button class="primary-action" onclick="submitWithdrawal()">Request withdrawal</button>':'<div class="action-note warning">You need at least ₦5,000 before you can submit a withdrawal.</div><button class="secondary-action" onclick="closeActionModal()">Close</button>'}`
  }catch(e){showToast(e.message||'Unable to open withdrawals.')}
}

window.startBluePayFeePayment=startBluePayFeePayment;
window.requestWithdrawal=requestWithdrawal;

window.addEventListener('load',()=>{
  const params=new URLSearchParams(location.search);
  if(params.get('fee')==='complete'){
    setTimeout(()=>showToast('Payment return received. Waiting for server confirmation.'),600);
  }
});
