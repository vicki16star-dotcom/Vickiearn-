const supabase = window.vickiearnSupabase;
let adminUser = null;
const money = n => `₦${(Number(n || 0) / 100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const esc = v => String(v ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
function toast(message, error=false){const el=document.getElementById('toast');el.textContent=message;el.className=`toast show ${error?'error':''}`;setTimeout(()=>el.className='toast',2600)}
function fmt(d){return d ? new Date(d).toLocaleString('en-NG',{dateStyle:'medium',timeStyle:'short'}) : '—'}
async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data}
async function requireAdmin(){
 const {data:{user},error}=await supabase.auth.getUser();
 if(error||!user){location.href='index.html';return false}
 const {data,isError}=await supabase.rpc('is_admin');
 if(isError || data!==true){document.getElementById('app').innerHTML='<section class="denied"><div class="shield">⛔</div><h1>Admin access required</h1><p>This account is not authorized to use VickiEarn administration.</p><a href="dashboard.html">Return to dashboard</a></section>';return false}
 adminUser=user; document.getElementById('adminEmail').textContent=user.email||'Administrator'; return true;
}
async function loadStats(){
 const [users,tasks,pendingTasks,pendingWithdrawals,volume] = await Promise.all([
  supabase.from('profiles').select('id',{count:'exact',head:true}),
  supabase.from('tasks').select('id',{count:'exact',head:true}),
  supabase.from('task_completions').select('id',{count:'exact',head:true}).eq('status','pending'),
  supabase.from('withdrawals').select('id',{count:'exact',head:true}).in('status',['pending','approved','processing']),
  supabase.from('transactions').select('amount_kobo').eq('type','deposit')
 ]);
 document.getElementById('statUsers').textContent=users.count??0;document.getElementById('statTasks').textContent=tasks.count??0;document.getElementById('statTaskQueue').textContent=pendingTasks.count??0;document.getElementById('statWithdrawals').textContent=pendingWithdrawals.count??0;document.getElementById('statDeposits').textContent=money((volume.data||[]).reduce((s,x)=>s+Number(x.amount_kobo||0),0));
}
async function loadTaskQueue(){
 const box=document.getElementById('taskQueue');
 const {data,error}=await supabase.from('task_completions').select('id,task_id,user_id,status,proof,created_at,tasks(title,reward_kobo),profiles:profiles!task_completions_user_id_fkey(full_name)').eq('status','pending').order('created_at',{ascending:false});
 if(error){box.innerHTML=`<div class="empty error-text">${esc(error.message)}</div>`;return}
 if(!data?.length){box.innerHTML='<div class="empty">No pending task submissions.</div>';return}
 box.innerHTML=data.map(x=>`<article class="queue-card"><div><span class="tag pending">Pending</span><h3>${esc(x.tasks?.title||'Task')}</h3><p><b>${esc(x.profiles?.full_name||'User')}</b> · ${money(x.tasks?.reward_kobo)} · ${fmt(x.created_at)}</p><details><summary>View proof</summary><pre>${esc(JSON.stringify(x.proof||{},null,2))}</pre></details></div><div class="actions"><button class="approve" onclick="reviewTask('${x.id}','approve')">Approve</button><button class="reject" onclick="reviewTask('${x.id}','reject')">Reject</button></div></article>`).join('');
}
async function reviewTask(id,action){if(!confirm(`${action==='approve'?'Approve':'Reject'} this task submission?`))return;try{await rpc(action==='approve'?'approve_task_completion':'reject_task_completion',{p_completion_id:id});toast(`Task ${action}d successfully`);await refreshAll()}catch(e){toast(e.message||'Operation failed',true)}}
async function loadWithdrawals(){
 const box=document.getElementById('withdrawalQueue');
 const {data,error}=await supabase.from('withdrawals').select('id,user_id,amount_kobo,status,account_name,account_number,bank_code,paystack_reference,failure_reason,created_at,profiles:profiles!withdrawals_user_id_fkey(full_name)').in('status',['pending','approved','processing','failed','rejected']).order('created_at',{ascending:false}).limit(50);
 if(error){box.innerHTML=`<div class="empty error-text">${esc(error.message)}</div>`;return}
 if(!data?.length){box.innerHTML='<div class="empty">No withdrawal requests.</div>';return}
 box.innerHTML=data.map(x=>{const masked=x.account_number?`••••${esc(x.account_number.slice(-4))}`:'—';let buttons='';if(x.status==='pending')buttons='<button class="approve" onclick="withdrawAction(\''+x.id+'\',\'approve\')">Approve</button><button class="reject" onclick="withdrawAction(\''+x.id+'\',\'reject\')">Reject</button>';else if(x.status==='approved')buttons='<button class="approve" onclick="withdrawAction(\''+x.id+'\',\'processing\')">Mark processing</button>';else if(x.status==='processing')buttons='<button class="approve" onclick="withdrawAction(\''+x.id+'\',\'complete\')">Mark paid</button><button class="reject" onclick="withdrawAction(\''+x.id+'\',\'fail\')">Fail</button>';return `<article class="queue-card"><div><span class="tag ${esc(x.status)}">${esc(x.status)}</span><h3>${money(x.amount_kobo)}</h3><p><b>${esc(x.profiles?.full_name||'User')}</b> · ${fmt(x.created_at)}</p><div class="bank"><span>Account: ${esc(x.account_name||'—')}</span><span>${masked}</span><span>Bank code: ${esc(x.bank_code||'—')}</span></div>${x.failure_reason?`<p class="error-text">${esc(x.failure_reason)}</p>`:''}</div><div class="actions">${buttons}</div></article>`}).join('');
}
async function withdrawAction(id,action){
 let args={p_withdrawal_id:id};let fn='';
 if(action==='approve')fn='approve_withdrawal';
 if(action==='reject'){fn='reject_withdrawal';args.p_reason=prompt('Reason for rejection:')||'Rejected by admin'}
 if(action==='processing')fn='mark_withdrawal_processing';
 if(action==='complete'){fn='complete_withdrawal';args.p_paystack_reference=prompt('Paystack payout reference:')||'';if(!args.p_paystack_reference)return}
 if(action==='fail'){fn='fail_withdrawal';args.p_reason=prompt('Failure reason:')||'Payment failed'}
 if(!confirm(`${action==='complete'?'Mark this withdrawal as paid':action==='processing'?'Mark this withdrawal as processing':action==='approve'?'Approve this withdrawal':'Continue with '+action+'?'}`))return;
 try{await rpc(fn,args);toast('Withdrawal updated');await refreshAll()}catch(e){toast(e.message||'Operation failed',true)}
}
async function loadUsers(){
 const box=document.getElementById('users');const {data,error}=await supabase.from('profiles').select('id,full_name,referral_code,role,created_at').order('created_at',{ascending:false}).limit(50);
 if(error){box.innerHTML=`<div class="empty error-text">${esc(error.message)}</div>`;return} if(!data?.length){box.innerHTML='<div class="empty">No users yet.</div>';return}
 box.innerHTML=`<div class="table"><div class="tr th"><span>Name</span><span>Role</span><span>Referral</span><span>Joined</span></div>${data.map(x=>`<div class="tr"><span>${esc(x.full_name||'—')}</span><span><span class="tag">${esc(x.role||'member')}</span></span><span>${esc(x.referral_code||'—')}</span><span>${fmt(x.created_at)}</span></div>`).join('')}</div>`;
}
async function loadTasks(){
 const box=document.getElementById('tasks');const {data,error}=await supabase.from('tasks').select('id,title,description,reward_kobo,status,max_completions,completion_count,created_at').order('created_at',{ascending:false});
 if(error){box.innerHTML=`<div class="empty error-text">${esc(error.message)}</div>`;return} if(!data?.length){box.innerHTML='<div class="empty">No tasks configured.</div>';return}
 box.innerHTML=data.map(x=>`<article class="task-row"><div><span class="tag ${esc(x.status)}">${esc(x.status)}</span><h3>${esc(x.title)}</h3><p>${esc(x.description||'')}</p></div><div class="task-meta"><b>${money(x.reward_kobo)}</b><small>${x.completion_count||0}${x.max_completions?` / ${x.max_completions}`:''} completions</small></div></article>`).join('');
}
async function refreshAll(){document.getElementById('refresh').textContent='Refreshing…';try{await Promise.all([loadStats(),loadTaskQueue(),loadWithdrawals(),loadUsers(),loadTasks()])}finally{document.getElementById('refresh').textContent='Refresh'}}
async function logout(){await supabase.auth.signOut();location.href='index.html'}
(async()=>{if(await requireAdmin())await refreshAll()})();
