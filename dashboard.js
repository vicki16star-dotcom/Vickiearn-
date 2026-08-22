const supabase = window.vickiearnSupabase;
let currentUser = null;
function showToast(message){const t=document.getElementById('toast');if(!t)return;t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
function toggleSidebar(){document.querySelector('.sidebar')?.classList.toggle('open')}
async function copyLink(){const input=document.querySelector('.copy-row input');if(input){await navigator.clipboard?.writeText(input.value);const s=document.getElementById('copyStatus');if(s)s.textContent='Referral link copied.';showToast('Referral link copied')}}
async function logout(){await supabase.auth.signOut();location.href='index.html'}
async function loadDashboard(){
 const {data:{user}}=await supabase.auth.getUser(); if(!user){location.href='index.html';return} currentUser=user;
 const [profile,wallet,refs,tx,tasks]=await Promise.all([
  supabase.from('profiles').select('full_name,referral_code,role').eq('id',user.id).single(),
  supabase.from('wallets').select('balance_kobo,lifetime_earned_kobo').eq('user_id',user.id).single(),
  supabase.from('referrals').select('*',{count:'exact',head:true}).eq('referrer_id',user.id),
  supabase.from('transactions').select('type,amount_kobo,description,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(10),
  supabase.from('tasks').select('id,title,description,reward_kobo').eq('status','active').order('created_at',{ascending:false})
 ]);
 if(wallet.error){showToast('Unable to load wallet');return}
 const naira=n=>`₦${(Number(n||0)/100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
 document.querySelector('.profile b')?.replaceChildren(document.createTextNode(profile.data?.full_name||user.email));
 document.querySelector('.profile small')?.replaceChildren(document.createTextNode(profile.data?.role==='admin'?'Administrator':'Member'));
 document.querySelector('.topbar h1')?.replaceChildren(document.createTextNode(`Welcome, ${profile.data?.full_name||'there'} 👋`));
 document.querySelector('.balance')?.replaceChildren(document.createTextNode(naira(wallet.data.balance_kobo)));
 const metrics=document.querySelectorAll('.metric b'); if(metrics.length){metrics[2].textContent=naira(wallet.data.lifetime_earned_kobo)}
 const refInput=document.querySelector('.copy-row input'); if(refInput)refInput.value=`${location.origin}${location.pathname.replace('dashboard.html','')}?ref=${profile.data.referral_code}`;
 const refEarn=(tx.data||[]).filter(x=>x.type==='referral_reward').reduce((s,x)=>s+Number(x.amount_kobo),0); if(metrics.length>1)metrics[1].textContent=naira(refEarn);
 const taskPanel=document.querySelector('#tasks'); if(taskPanel){taskPanel.querySelectorAll('.task').forEach(x=>x.remove()); (tasks.data||[]).forEach(task=>{const row=document.createElement('div');row.className='task';row.innerHTML=`<span class="task-icon">🎯</span><div><b>${escapeHtml(task.title)}</b><small>${escapeHtml(task.description||'Complete this task')}</small></div><strong>${naira(task.reward_kobo)}</strong><button>Start</button>`;row.querySelector('button').onclick=()=>claimTask(task.id);taskPanel.appendChild(row)})}
 const history=document.querySelector('#history'); if(history){history.querySelectorAll('.transaction').forEach(x=>x.remove());(tx.data||[]).forEach(item=>{const row=document.createElement('div');row.className='transaction';const positive=!['withdrawal','withdrawal_reversal'].includes(item.type);row.textContent=`${positive?'✓':'↗'} ${item.description||item.type} ${positive?'+':'-'}${naira(item.amount_kobo)}`;history.appendChild(row)})}
}
async function claimTask(taskId){const {error}=await supabase.from('task_completions').insert({task_id:taskId,user_id:currentUser.id,proof:{submitted_from:'dashboard'}});if(error)showToast(error.message);else showToast('Task submitted for review')}
async function requestWithdrawal(){const amount=prompt('Withdrawal amount in Naira (minimum ₦5,000):');if(!amount)return;const name=prompt('Account name:');const number=prompt('10-digit account number:');const bank=prompt('Bank code:');try{const id=await window.VickiEarnPayments.requestWithdrawal(amount,name,number,bank);showToast(`Withdrawal ${id} submitted`);await loadDashboard()}catch(e){showToast(e.message||'Withdrawal failed')}}
async function deposit(){const amount=prompt('Deposit amount in Naira:');if(!amount)return;try{await window.VickiEarnPayments.initializeDeposit(amount)}catch(e){showToast(e.message||'Payment could not start')}}
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
supabase?.auth.onAuthStateChange((_event,session)=>{if(!session)location.href='index.html'});
loadDashboard();
