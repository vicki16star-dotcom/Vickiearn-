const sb = window.vickiearnSupabase;
const $ = (id) => document.getElementById(id);
let busy = false;

const money = (n) => `₦${(Number(n || 0) / 100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (d) => d ? new Date(d).toLocaleString('en-NG',{dateStyle:'medium',timeStyle:'short'}) : '—';
const timeout = (p, ms, label) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms))]);

function status(text, error=false){ const el=$('adminEmail'); if(el){el.textContent=text;el.classList.toggle('error-text',error);} }
function toast(text,error=false){ const el=$('toast'); if(!el)return; el.textContent=text; el.className=`toast show ${error?'error':''}`; setTimeout(()=>el.className='toast',3000); }
function box(id,text,error=false){ const el=$(id); if(el){el.innerHTML=`<div class="empty ${error?'error-text':''}">${esc(text)}</div>`;} }
async function rpc(name,args={}){ if(!sb) throw new Error('Secure connection library is unavailable'); const r=await timeout(sb.rpc(name,args),6000,`Secure action ${name}`); if(r.error) throw r.error; return r.data; }

async function authenticate(){
  if(!sb) throw new Error('Secure connection library is unavailable');
  status('Checking secure admin access…');
  const r=await timeout(sb.auth.getUser(),5000,'Authentication check');
  if(r.error) throw r.error;
  const user=r.data?.user;
  if(!user){ location.href='index.html'; return null; }
  const ok=await rpc('is_admin');
  if(ok!==true){
    $('app').innerHTML='<section class="denied"><div class="shield">⛔</div><h1>Admin access required</h1><p>This account is not authorized to use VickiEarn administration.</p><a href="dashboard.html">Return to dashboard</a></section>';
    return null;
  }
  status(user.email || 'Administrator');
  return user;
}

async function loadStats(){
  const [u,t,q,w,d] = await Promise.all([
    timeout(sb.from('profiles').select('id',{count:'exact',head:true}),5000,'Users'),
    timeout(sb.from('tasks').select('id',{count:'exact',head:true}).eq('status','active'),5000,'Tasks'),
    timeout(sb.from('task_completions').select('id',{count:'exact',head:true}).eq('status','pending'),5000,'Task reviews'),
    timeout(sb.from('withdrawals').select('id',{count:'exact',head:true}).in('status',['pending','approved','processing']),5000,'Withdrawals'),
    timeout(sb.from('transactions').select('amount_kobo').eq('type','deposit').limit(1000),5000,'Deposits')
  ]);
  if(u.error)throw u.error;if(t.error)throw t.error;if(q.error)throw q.error;if(w.error)throw w.error;if(d.error)throw d.error;
  $('statUsers').textContent=u.count ?? 0;
  $('statTasks').textContent=t.count ?? 0;
  $('statTaskQueue').textContent=q.count ?? 0;
  $('statWithdrawals').textContent=w.count ?? 0;
  $('statDeposits').textContent=money((d.data||[]).reduce((s,x)=>s+Number(x.amount_kobo||0),0));
}

async function loadTaskQueue(){
  const boxEl=$('taskQueue');
  const q=await timeout(sb.from('task_completions').select('id,task_id,user_id,status,proof,created_at').eq('status','pending').order('created_at',{ascending:false}).limit(50),6000,'Task reviews');
  if(q.error)throw q.error; const rows=q.data||[];
  if(!rows.length){boxEl.innerHTML='<div class="empty">No pending task submissions.</div>';return;}
  const tids=[...new Set(rows.map(x=>x.task_id).filter(Boolean))], uids=[...new Set(rows.map(x=>x.user_id).filter(Boolean))];
  const [tr,pr]=await Promise.all([
    tids.length?timeout(sb.from('tasks').select('id,title,reward_kobo').in('id',tids),5000,'Task details'):Promise.resolve({data:[],error:null}),
    uids.length?timeout(sb.from('profiles').select('id,full_name').in('id',uids),5000,'User details'):Promise.resolve({data:[],error:null})
  ]);
  if(tr.error)throw tr.error;if(pr.error)throw pr.error;
  const tasks=Object.fromEntries((tr.data||[]).map(x=>[x.id,x])), users=Object.fromEntries((pr.data||[]).map(x=>[x.id,x]));
  boxEl.innerHTML=rows.map(x=>{const t=tasks[x.task_id]||{},u=users[x.user_id]||{};return `<article class="queue-card"><div><span class="tag pending">Pending</span><h3>${esc(t.title||'Task submission')}</h3><p><b>${esc(u.full_name||'User')}</b> · ${money(t.reward_kobo)} · ${fmt(x.created_at)}</p><details><summary>View proof</summary><pre>${esc(JSON.stringify(x.proof||{},null,2))}</pre></details></div><div class="actions"><button class="approve" onclick="reviewTask('${x.id}','approve')">Approve</button><button class="reject" onclick="reviewTask('${x.id}','reject')">Reject</button></div></article>`}).join('');
}

async function loadWithdrawals(){
  const el=$('withdrawalQueue');
  const q=await timeout(sb.from('withdrawals').select('id,user_id,amount_kobo,status,account_name,account_number,bank_code,paystack_reference,failure_reason,created_at').in('status',['pending','approved','processing','failed','rejected']).order('created_at',{ascending:false}).limit(50),6000,'Withdrawals');
  if(q.error)throw q.error; const rows=q.data||[];
  if(!rows.length){el.innerHTML='<div class="empty">No withdrawal requests.</div>';return;}
  const ids=[...new Set(rows.map(x=>x.user_id).filter(Boolean))];
  const pr=ids.length?await timeout(sb.from('profiles').select('id,full_name').in('id',ids),5000,'Withdrawal users'):{data:[],error:null};
  if(pr.error)throw pr.error; const names=Object.fromEntries((pr.data||[]).map(x=>[x.id,x.full_name]));
  el.innerHTML=rows.map(x=>{const masked=x.account_number?`••••${esc(String(x.account_number).slice(-4))}`:'—';let buttons='';if(x.status==='pending')buttons=`<button class="approve" onclick="withdrawAction('${x.id}','approve')">Approve</button><button class="reject" onclick="withdrawAction('${x.id}','reject')">Reject</button>`;else if(x.status==='approved')buttons=`<button class="approve" onclick="withdrawAction('${x.id}','processing')">Mark processing</button>`;else if(x.status==='processing')buttons=`<button class="approve" onclick="withdrawAction('${x.id}','complete')">Mark paid</button><button class="reject" onclick="withdrawAction('${x.id}','fail')">Fail</button>`;return `<article class="queue-card"><div><span class="tag ${esc(x.status)}">${esc(x.status)}</span><h3>${money(x.amount_kobo)}</h3><p><b>${esc(names[x.user_id]||'User')}</b> · ${fmt(x.created_at)}</p><div class="bank"><span>Account: ${esc(x.account_name||'—')}</span><span>${masked}</span><span>Bank code: ${esc(x.bank_code||'—')}</span></div>${x.failure_reason?`<p class="error-text">${esc(x.failure_reason)}</p>`:''}</div><div class="actions">${buttons}</div></article>`}).join('');
}

async function loadTasks(){
  const el=$('tasks'); const q=await timeout(sb.from('tasks').select('id,title,description,reward_kobo,status,max_completions,completion_count,created_at').order('created_at',{ascending:false}).limit(100),6000,'Tasks');
  if(q.error)throw q.error; const rows=q.data||[]; if(!rows.length){el.innerHTML='<div class="empty">No tasks configured.</div>';return;}
  el.innerHTML=rows.map(x=>`<article class="task-row"><div><span class="tag ${esc(x.status)}">${esc(x.status)}</span><h3>${esc(x.title)}</h3><p>${esc(x.description||'')}</p></div><div class="task-meta"><b>${money(x.reward_kobo)}</b><small>${x.completion_count||0}${x.max_completions?` / ${x.max_completions}`:''} completions</small></div></article>`).join('');
}

async function loadUsers(){
  const el=$('users'); const q=await timeout(sb.from('profiles').select('id,full_name,referral_code,role,created_at').order('created_at',{ascending:false}).limit(50),6000,'Users');
  if(q.error)throw q.error; const rows=q.data||[]; if(!rows.length){el.innerHTML='<div class="empty">No users yet.</div>';return;}
  el.innerHTML=`<div class="table"><div class="tr th"><span>Name</span><span>Role</span><span>Referral</span><span>Joined</span></div>${rows.map(x=>`<div class="tr"><span>${esc(x.full_name||'—')}</span><span><span class="tag">${esc(x.role||'member')}</span></span><span>${esc(x.referral_code||'—')}</span><span>${fmt(x.created_at)}</span></div>`).join('')}</div>`;
}

async function refreshAll(){
  if(busy)return; busy=true; const btn=$('refresh'); if(btn){btn.disabled=true;btn.textContent='Refreshing…';}
  try{
    const user=await authenticate(); if(!user)return;
    const results=await Promise.allSettled([loadStats(),loadTaskQueue(),loadWithdrawals(),loadTasks(),loadUsers()]);
    const failures=results.filter(x=>x.status==='rejected');
    if(failures.length){console.error(failures);toast(`${failures.length} admin section(s) failed to load`,true);}
    else toast('Admin dashboard connected');
  }catch(e){console.error('Admin startup:',e);status(`Connection failed — ${e.message||'unknown error'}`,true);['taskQueue','withdrawalQueue','tasks','users'].forEach(id=>box(id,`Unable to load: ${e.message||'unknown error'}`,true));toast(e.message||'Admin connection failed',true);}
  finally{busy=false;if(btn){btn.disabled=false;btn.textContent='Refresh';}}
}

async function reviewTask(id,action){if(!confirm(`${action==='approve'?'Approve':'Reject'} this task submission?`))return;try{await rpc(action==='approve'?'approve_task_completion':'reject_task_completion',{p_completion_id:id});toast(`Task ${action}d successfully`);await refreshAll();}catch(e){toast(e.message||'Operation failed',true);}}
async function withdrawAction(id,action){let fn='',args={p_withdrawal_id:id};if(action==='approve')fn='approve_withdrawal';if(action==='reject'){fn='reject_withdrawal';args.p_reason=prompt('Reason for rejection:')||'Rejected by admin';}if(action==='processing')fn='mark_withdrawal_processing';if(action==='complete'){fn='complete_withdrawal';args.p_paystack_reference=prompt('Paystack payout reference:')||'';if(!args.p_paystack_reference)return;}if(action==='fail'){fn='fail_withdrawal';args.p_reason=prompt('Failure reason:')||'Payment failed';}if(!confirm('Continue with this withdrawal action?'))return;try{await rpc(fn,args);toast('Withdrawal updated');await refreshAll();}catch(e){toast(e.message||'Operation failed',true);}}
async function logout(){if(sb)await sb.auth.signOut();location.href='index.html';}
window.refreshAll=refreshAll;window.reviewTask=reviewTask;window.withdrawAction=withdrawAction;window.logout=logout;

window.addEventListener('error',e=>{console.error(e.error||e.message);status('Admin script error — tap Refresh',true);});
setTimeout(()=>{if($('adminEmail')?.textContent.includes('Starting'))refreshAll();},100);
