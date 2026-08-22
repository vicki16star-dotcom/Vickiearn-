const modal = document.getElementById('modal');
const authForm = document.getElementById('authForm');
let authMode = 'signup';
let supabase = null;
const referralCodeFromUrl = new URLSearchParams(window.location.search).get('ref') || '';
const refInput = document.getElementById('refCode');
if (refInput) refInput.value = referralCodeFromUrl;

function getSupabase() {
  if (supabase) return supabase;
  if (!window.VICKIEARN_SUPABASE_URL || !window.VICKIEARN_SUPABASE_KEY) return null;
  if (window.supabase?.createClient) {
    supabase = window.supabase.createClient(window.VICKIEARN_SUPABASE_URL, window.VICKIEARN_SUPABASE_KEY);
    window.vickiearnSupabase = supabase;
  }
  return supabase;
}

function authErrorMessage(error) {
  const msg = error?.message || error?.error_description || error?.msg || 'Account creation failed. Please try again.';
  if (/email.*already|already.*registered|user.*already/i.test(msg)) return 'That email is already registered. Use Login instead.';
  if (/password/i.test(msg)) return 'Password must be at least 8 characters.';
  if (/invalid.*email|email.*invalid/i.test(msg)) return 'Please enter a valid email address.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/email.*not.*confirmed|not.*confirmed/i.test(msg)) return 'Please verify your email first, then log in.';
  return msg;
}

async function directAuth(path, body) {
  if (!window.VICKIEARN_SUPABASE_URL || !window.VICKIEARN_SUPABASE_KEY) throw new Error('Supabase configuration is missing.');
  const response = await fetch(`${window.VICKIEARN_SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: window.VICKIEARN_SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || 'Authentication request failed.');
  return data;
}

async function openModal(type) {
  authMode = type === 'login' ? 'login' : 'signup';
  if (type === 'withdraw') {
    const client = getSupabase();
    if (client?.auth) {
      const { data: { user } } = await client.auth.getUser();
      if (user) { window.location.assign('dashboard.html#wallet'); return; }
    }
    authMode = 'login';
  }
  document.getElementById('modalTitle').textContent = authMode === 'login' ? 'Welcome back' : 'Create your VickiEarn account';
  document.getElementById('modalText').textContent = authMode === 'login' ? 'Log in to access your real wallet and dashboard.' : 'Create a secure VickiEarn account.';
  document.getElementById('authSubmit').textContent = authMode === 'login' ? 'Log in' : 'Create account';
  document.getElementById('fullName').style.display = authMode === 'login' ? 'none' : 'block';
  document.getElementById('refCode').style.display = authMode === 'login' ? 'none' : 'block';
  document.getElementById('authStatus').textContent = '';
  modal?.classList.add('show');
}
function closeModal(){ modal?.classList.remove('show'); }

if (authForm) authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.getElementById('authStatus');
  const submit = document.getElementById('authSubmit');
  const email = document.getElementById('email')?.value.trim();
  const password = document.getElementById('password')?.value || '';
  const fullName = document.getElementById('fullName')?.value.trim() || '';
  const refCode = document.getElementById('refCode')?.value.trim().toUpperCase() || '';
  if (!email || !password) { status.textContent = 'Enter your email and password.'; return; }
  if (authMode === 'signup' && !fullName) { status.textContent = 'Please enter your full name.'; return; }
  if (password.length < 8) { status.textContent = 'Password must be at least 8 characters.'; return; }
  submit.disabled = true;
  submit.textContent = authMode === 'signup' ? 'Creating account…' : 'Signing in…';
  status.textContent = 'Connecting securely…';
  try {
    const client = getSupabase();
    let data;
    if (authMode === 'signup') {
      if (client?.auth) {
        const result = await client.auth.signUp({ email, password, options: { data: { full_name: fullName, referral_code: refCode || null }, emailRedirectTo: `${window.location.origin}/dashboard.html` } });
        if (result.error) throw result.error;
        data = result.data;
      } else {
        data = await directAuth('signup', { email, password, data: { full_name: fullName, referral_code: refCode || null } });
      }
      if (data?.session) {
        status.textContent = 'Account created. Opening your dashboard…';
        window.location.assign('dashboard.html');
      } else {
        status.textContent = 'Account created. Check your email to verify it, then log in.';
      }
    } else {
      if (client?.auth) {
        const result = await client.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        if (!result.data?.session) throw new Error('No active session was returned.');
      } else {
        const data = await directAuth('token?grant_type=password', { email, password });
        if (!data?.access_token) throw new Error('No active session was returned.');
      }
      status.textContent = 'Signed in. Opening your dashboard…';
      window.location.assign('dashboard.html');
    }
  } catch (error) {
    console.error('VickiEarn authentication error:', error);
    status.textContent = authErrorMessage(error);
  } finally {
    submit.disabled = false;
    submit.textContent = authMode === 'signup' ? 'Create account' : 'Log in';
  }
});

async function loadUserData(){
  const client = getSupabase();
  if (!client?.auth) return;
  const {data:{user}}=await client.auth.getUser(); if(!user)return;
  const [p,w,r,re]=await Promise.all([
    client.from('profiles').select('full_name,referral_code').eq('id',user.id).single(),
    client.from('wallets').select('balance_kobo,lifetime_earned_kobo').eq('user_id',user.id).single(),
    client.from('referrals').select('*',{count:'exact',head:true}).eq('referrer_id',user.id),
    client.from('transactions').select('amount_kobo').eq('user_id',user.id).eq('type','referral_reward')
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
  const grid=document.getElementById('taskGrid'); const client=getSupabase(); if(!grid || !client) return;
  const {data,error}=await client.from('tasks').select('id,title,description,reward_kobo,max_completions,completion_count').eq('status','active').order('created_at',{ascending:false});
  if(error){grid.innerHTML='<p>Tasks are temporarily unavailable.</p>';return;}
  if(!data?.length){grid.innerHTML='<p>No active tasks are available right now.</p>';return;}
  grid.innerHTML=data.map(t=>{const limit=t.max_completions!==null&&t.completion_count>=t.max_completions;return `<article class="task-card"><div class="task-icon">🎯</div><div><h3>${escapeHtml(t.title)}</h3><p>${escapeHtml(t.description)}</p></div><strong>₦${(Number(t.reward_kobo)/100).toLocaleString('en-NG')}</strong><button ${limit?'disabled':''} onclick="claimTask('${t.id}')">${limit?'Completed':'Start task'}</button></article>`}).join('');
}
async function claimTask(taskId){const client=getSupabase();if(!client?.auth)return;const {data:{user}}=await client.auth.getUser();if(!user){openModal('login');return;}const {error}=await client.from('task_completions').insert({task_id:taskId,user_id:user.id,proof:{submitted_from:'web'}});if(error){alert(error.message);return;}alert('Task started. Your completion is pending review.');}
function copyReferral(){const v=document.getElementById('referralLink').textContent;if(v.startsWith('Sign in')){openModal('login');return;}navigator.clipboard?.writeText(v);document.getElementById('copyStatus').textContent='Referral link copied.';}
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
const client=getSupabase();
if (client?.auth) client.auth.onAuthStateChange((_event,session)=>{if(session)loadUserData();});
loadTasks();loadUserData();