const { createClient } = window.supabase;
const supabase = createClient(window.VICKIEARN_SUPABASE_URL, window.VICKIEARN_SUPABASE_KEY);
window.vickiearnSupabase = supabase;

const modal = document.getElementById('modal');
const authForm = document.getElementById('authForm');
let authMode = 'signup';
const referralCodeFromUrl = new URLSearchParams(window.location.search).get('ref') || '';

document.getElementById('refCode').value = referralCodeFromUrl;

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.getElementById('authStatus');
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const fullName = document.getElementById('fullName').value.trim();
  const refCode = document.getElementById('refCode').value.trim().toUpperCase();
  status.textContent = 'Please wait…';
  try {
    if (authMode === 'signup') {
      if (!fullName) throw new Error('Please enter your full name.');
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName, referral_code: refCode || null } } });
      if (error) throw error;
      if (data.session) {
        status.textContent = 'Account created. Opening your dashboard…';
        window.location.href = 'dashboard.html';
      } else {
        status.textContent = 'Account created. Check your email to verify your account, then return here and log in.';
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) throw new Error('Login did not create a session.');
      status.textContent = 'Signed in. Opening your dashboard…';
      window.location.href = 'dashboard.html';
    }
  } catch (error) { status.textContent = error.message || 'Something went wrong.'; }
});

async function openModal(type) {
  if (type === 'withdraw') {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { authMode = 'login'; }
    else { window.location.href = 'dashboard.html#wallet'; return; }
  } else authMode = type === 'login' ? 'login' : 'signup';

  const title = document.getElementById('modalTitle');
  const text = document.getElementById('modalText');
  const submit = document.getElementById('authSubmit');
  const name = document.getElementById('fullName');
  const ref = document.getElementById('refCode');
  const status = document.getElementById('authStatus');
  authForm.style.display = 'block';
  title.textContent = authMode === 'login' ? 'Welcome back' : 'Create your VickiEarn account';
  text.textContent = authMode === 'login' ? 'Log in to access your real wallet and dashboard.' : 'Create a secure VickiEarn account.';
  submit.textContent = authMode === 'login' ? 'Log in' : 'Create account';
  name.style.display = authMode === 'login' ? 'none' : 'block';
  ref.style.display = authMode === 'login' ? 'none' : 'block';
  status.textContent = '';
  modal.classList.add('show');
}
function closeModal(){modal.classList.remove('show');}

async function loadUserData(){
  const {data:{user}}=await supabase.auth.getUser(); if(!user)return;
  const [p,w,r,re]=await Promise.all([
    supabase.from('profiles').select('full_name,referral_code').eq('id',user.id).single(),
    supabase.from('wallets').select('balance_kobo,lifetime_earned_kobo').eq('user_id',user.id).single(),
    supabase.from('referrals').select('*',{count:'exact',head:true}).eq('referrer_id',user.id),
    supabase.from('transactions').select('amount_kobo').eq('user_id',user.id).eq('type','referral_reward')
  ]);
  if(p.error||w.error){console.error(p.error||w.error);return;}
  const balance=Number(w.data.balance_kobo||0)/100;
  const earnings=(re.data||[]).reduce((s,x)=>s+Number(x.amount_kobo||0),0)/100;
  const el=document.querySelector('.balance'); if(el)el.textContent=`₦${balance.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const link=document.getElementById('referralLink'); if(link)link.textContent=`${location.origin}${location.pathname}?ref=${p.data.referral_code}`;
  document.getElementById('referralCount')?.replaceChildren(document.createTextNode(`${r.count||0} referrals`));
  document.getElementById('referralEarnings')?.replaceChildren(document.createTextNode(`₦${earnings.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}`));
}

async function loadTasks(){
  const grid=document.getElementById('taskGrid'); if(!grid)return;
  const {data,error}=await supabase.from('tasks').select('id,title,description,reward_kobo,max_completions,completion_count').eq('status','active').order('created_at',{ascending:false});
  if(error){grid.innerHTML='<p>Tasks are temporarily unavailable.</p>';return;}
  if(!data?.length){grid.innerHTML='<p>No active tasks are available right now.</p>';return;}
  grid.innerHTML=data.map(t=>{const limit=t.max_completions!==null&&t.completion_count>=t.max_completions;return `<article class="task-card"><div class="task-icon">🎯</div><div><h3>${escapeHtml(t.title)}</h3><p>${escapeHtml(t.description)}</p></div><strong>₦${(Number(t.reward_kobo)/100).toLocaleString('en-NG')}</strong><button ${limit?'disabled':''} onclick="claimTask('${t.id}')">${limit?'Completed':'Start task'}</button></article>`}).join('');
}
async function claimTask(taskId){const {data:{user}}=await supabase.auth.getUser();if(!user){openModal('login');return;}const {error}=await supabase.from('task_completions').insert({task_id:taskId,user_id:user.id,proof:{submitted_from:'web'}});if(error){alert(error.message);return;}alert('Task started. Your completion is pending review.');}
function copyReferral(){const v=document.getElementById('referralLink').textContent;if(v.startsWith('Sign in')){openModal('login');return;}navigator.clipboard?.writeText(v);document.getElementById('copyStatus').textContent='Referral link copied.';}
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

supabase.auth.onAuthStateChange((_event,session)=>{if(session)loadUserData();});
loadTasks();loadUserData();
