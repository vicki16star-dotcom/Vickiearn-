(()=>{
  const BPC_ACCOUNTS=[
    {bank:'Flutterwave MFB (Formerly OK MFB)',name:'Peace Maduforo Palmpay FLW',number:'9622481087'},
    {bank:'Flutterwave MFB (Formerly OK MFB)',name:'Peace Maduforo Palmpay FLW',number:'9680830062'}
  ];
  const cleanDeposit=()=>{
    if(typeof window.openActionModal!=='function')return;
    const accounts=BPC_ACCOUNTS.map((a,i)=>`<div class="action-note" style="margin:10px 0"><b>Account ${i+1}</b><br>Bank: <b>${a.bank}</b><br>Name: <b>${a.name}</b><br>Account number: <strong style="font-size:20px">${a.number}</strong><button class="small-btn" onclick="navigator.clipboard.writeText('${a.number}');window.showToast?.('Account number copied.')">Copy account number</button></div>`).join('');
    window.openActionModal(`<h2>Buy BPC</h2><p>Make your BPC payment using either of these active Flutterwave virtual accounts.</p>${accounts}<div class="action-note"><b>Important:</b> Pay only the amount shown for your BPC purchase. Keep your transfer reference/receipt for payment verification.</div><label>Amount in Naira</label><input id="bluepayDepositAmount" type="number" min="100" step="100" placeholder="Enter BPC amount"><button class="primary-action" onclick="window.startBluePayDeposit()">Continue</button><button class="secondary-action" onclick="closeActionModal()">Close</button>`);
  };
  window.startBluePayDeposit=async()=>{
    const amount=Number(document.getElementById('bluepayDepositAmount')?.value||0);
    if(!Number.isFinite(amount)||amount<100)return window.showToast?.('Enter a valid BPC amount.');
    try{
      if(!window.VickiEarnPayments?.initializeDeposit)throw new Error('Payment service is still loading. Please refresh once.');
      await window.VickiEarnPayments.initializeDeposit(amount,'bpc');
    }catch(e){window.showToast?.(e.message||'Payment could not start.');}
  };
  window.deposit=cleanDeposit;
  window.openBPCDeposit=cleanDeposit;
  window.addEventListener('load',()=>{
    document.querySelectorAll('.tier-grid,.tier-option').forEach(e=>e.remove());
  });
})();
