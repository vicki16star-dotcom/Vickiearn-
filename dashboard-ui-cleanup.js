(()=>{
  const cleanDeposit=()=>{
    if(typeof window.openActionModal!=='function')return;
    window.openActionModal('<h2>Deposit to BluePay</h2><p>Enter the amount you want to add to your BluePay wallet. There are no premium tiers on this version.</p><label>Amount in Naira</label><input id="bluepayDepositAmount" type="number" min="100" step="100" placeholder="e.g. 5000"><button class="primary-action" onclick="window.startBluePayDeposit()">Continue to payment</button><div class="action-note"><b>Important:</b> Any promotion shown on your account is subject to its published eligibility terms. Depositing money does not by itself guarantee a cash return.</div>');
  };
  window.startBluePayDeposit=async()=>{
    const amount=Number(document.getElementById('bluepayDepositAmount')?.value||0);
    if(!Number.isFinite(amount)||amount<100)return window.showToast?.('Enter at least ₦100.');
    try{
      if(!window.VickiEarnPayments?.initializeDeposit)throw new Error('Payment service is still loading. Please refresh once.');
      await window.VickiEarnPayments.initializeDeposit(amount,'wallet');
    }catch(e){window.showToast?.(e.message||'Payment could not start.');}
  };
  window.deposit=cleanDeposit;
  window.addEventListener('load',()=>{
    document.querySelectorAll('.tier-grid,.tier-option').forEach(e=>e.remove());
  });
})();
