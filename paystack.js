(()=>{
  const supabase=window.vickiearnSupabase;
  if(!supabase)return;
  async function requireUser(){const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('Please log in first.');return user;}
  async function initializeDeposit(amountNaira,tierId=null){
    const user=await requireUser();
    const amount=Math.round(Number(amountNaira)*100);
    if(!Number.isSafeInteger(amount)||amount<100)throw new Error('Enter a valid amount.');
    const body={amount_kobo:amount,tier_id:tierId||undefined,redirect_url:`${location.origin}${location.pathname}?payment=return`};
    const {data,error}=await supabase.functions.invoke('flutterwave-initialize',{body});
    if(error)throw error;
    if(!data?.status||!data?.checkout_url)throw new Error(data?.message||'Unable to initialize Flutterwave payment.');
    location.href=data.checkout_url;
  }
  async function verifyReturnedPayment(){
    const params=new URLSearchParams(location.search);
    if(params.get('payment')!=='return'&&!params.get('status'))return false;
    const status=params.get('status');
    if(status==='cancelled')showToastSafe('Flutterwave payment was cancelled.');
    else showToastSafe('Payment return received. Your deposit will appear after Flutterwave confirms the transaction.');
    history.replaceState({},document.title,location.pathname);
    return true;
  }
  function showToastSafe(message){const t=document.getElementById('toast');if(t){t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),4000)}}
  window.VickiEarnPayments={initializeDeposit,verifyReturnedPayment};
  window.BluePayPayments=window.VickiEarnPayments;
  window.addEventListener('load',verifyReturnedPayment);
})();