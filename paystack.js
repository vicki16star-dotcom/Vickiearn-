(()=>{
  const supabase=window.vickiearnSupabase;
  if(!supabase)return;
  const accounts=[
    {bank:'Flutterwave MFB (Formerly OK MFB)',name:'Peace Maduforo Palmpay FLW',number:'9622481087'},
    {bank:'Flutterwave MFB (Formerly OK MFB)',name:'Peace Maduforo Palmpay FLW',number:'9680830062'}
  ];
  async function requireUser(){const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('Please log in first.');return user;}
  function esc(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));}
  async function initializeDeposit(amountNaira,tierId=null){
    await requireUser();
    const amount=Math.round(Number(amountNaira)*100);
    if(!Number.isSafeInteger(amount)||amount<10000)throw new Error('Enter a valid amount of at least ₦100.');
    const {data,error}=await supabase.functions.invoke('create-deposit-intent',{body:{amount_kobo:amount,tier_id:tierId||null}});
    if(error)throw new Error(error.message||'Could not create deposit request.');
    if(!data?.status||!data?.reference)throw new Error(data?.message||'Could not create deposit request.');
    const naira=(amount/100).toLocaleString('en-NG',{minimumFractionDigits:2});
    openActionModal(`<h2>Complete your BPC payment</h2><p>Transfer exactly <b>₦${naira}</b> to either active Flutterwave virtual account below.</p><div class="tier-grid">${accounts.map((a,i)=>`<div class="tier-option" style="cursor:default"><b>Account ${i+1}</b><small>${esc(a.bank)}<br><b>${esc(a.name)}</b></small><strong>${a.number}</strong><button class="small-btn" onclick="navigator.clipboard.writeText('${a.number}');showToast('Account number copied.')">Copy account number</button></div>`).join('')}</div><div class="action-note"><b>Payment reference:</b> ${esc(data.reference)}<br>Keep your bank transfer reference/receipt. Your BPC/wallet value is not credited until the payment is independently verified.</div><button class="secondary-action" onclick="closeActionModal()">Close</button>`);
  }
  async function verifyReturnedPayment(){return false;}
  window.VickiEarnPayments={initializeDeposit,verifyReturnedPayment};
  window.BluePayPayments=window.VickiEarnPayments;
})();