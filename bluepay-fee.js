const BLUEPAY_FEE_NGN=10000;
const BLUEPAY_FLUTTERWAVE_LINK='https://flutterwave.com/pay/0zvts47js4us';
const BLUEPAY_VIRTUAL_ACCOUNTS=[
  {bank:'Flutterwave MFB (Formerly OK MFB)',name:'Peace Maduforo Palmpay FLW',number:'9622481087'},
  {bank:'Flutterwave MFB (Formerly OK MFB)',name:'Peace Maduforo Palmpay FLW',number:'9680830062'}
];

function copyBluePayAccount(number){
  navigator.clipboard?.writeText(number).then(()=>showToast('Account number copied.')).catch(()=>showToast('Copy was blocked by the browser.'));
}

async function startBluePayFeePayment(){
  try{
    const db=window.vickiearnSupabase;
    if(!db) throw new Error('Payment service is unavailable.');
    const {data:{user},error}=await db.auth.getUser();
    if(error||!user) throw new Error('Please sign in before making a payment.');
    const accounts=BLUEPAY_VIRTUAL_ACCOUNTS.map(a=>`<div class="action-note"><b>${a.bank}</b><br><b>${a.name}</b><br><strong style="font-size:1.25rem;letter-spacing:.04em">${a.number}</strong><button class="small-btn" onclick="copyBluePayAccount('${a.number}')">Copy account number</button></div>`).join('');
    openActionModal(`<h2>BluePay payment</h2><p><b>Amount: ₦${BLUEPAY_FEE_NGN.toLocaleString('en-NG')}</b></p><p>Choose either of BluePay's active Flutterwave virtual accounts below. Only make a transfer to an account shown on this page.</p>${accounts}<div class="action-note warning"><b>Important:</b> A transfer is not treated as verified merely because you upload a receipt or press a button. BluePay must receive and verify the Flutterwave transaction before any account action is taken.</div><button class="primary-action" onclick="window.location.href='${BLUEPAY_FLUTTERWAVE_LINK}'">Use Flutterwave checkout instead →</button><button class="secondary-action" onclick="closeActionModal()">Close</button>`);
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
    openActionModal(`<h2>Withdraw money</h2><p>Available balance: <b>₦${(balance/100).toLocaleString('en-NG',{minimumFractionDigits:2})}</b></p>${!feeConfirmed?`<div class="action-note warning"><b>Withdrawal processing payment</b><br>Required amount: <b>₦${BLUEPAY_FEE_NGN.toLocaleString()}</b><br><small>The payment page will show both active Flutterwave virtual accounts and an optional Flutterwave checkout.</small></div><button class="primary-action" onclick="startBluePayFeePayment()">View payment options →</button><button class="secondary-action" onclick="closeActionModal()">Close</button>`:balance>=500000?'<input id="withdrawAmount" type="number" min="5000" placeholder="Amount in Naira"><input id="accountName" placeholder="Account name"><input id="accountNumber" inputmode="numeric" maxlength="10" placeholder="10-digit account number"><input id="bankCode" inputmode="numeric" placeholder="Bank code"><button class="primary-action" onclick="submitWithdrawal()">Request withdrawal</button>':'<div class="action-note warning">You need at least ₦5,000 before you can submit a withdrawal.</div><button class="secondary-action" onclick="closeActionModal()">Close</button>'}`
  }catch(e){showToast(e.message||'Unable to open withdrawals.')}
}

window.copyBluePayAccount=copyBluePayAccount;
window.startBluePayFeePayment=startBluePayFeePayment;
window.requestWithdrawal=requestWithdrawal;
window.addEventListener('load',()=>{
  const params=new URLSearchParams(location.search);
  if(params.get('fee')==='complete') setTimeout(()=>showToast('Payment return received. Waiting for server confirmation.'),600);
});
