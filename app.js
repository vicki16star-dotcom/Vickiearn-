const { createClient } = window.supabase;
const supabase = createClient(window.VICKIEARN_SUPABASE_URL, window.VICKIEARN_SUPABASE_KEY);

const modal = document.getElementById('modal');
let authMode = 'signup';
let referralCodeFromUrl = new URLSearchParams(window.location.search).get('ref') || '';

document.getElementById('refCode').value = referralCodeFromUrl;

document.getElementById('authForm').addEventListener('submit', async (event) => {
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
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, referral_code: refCode || null } }
      });
      if (error) throw error;
      status.textContent = 'Account created. Check your email if verification is enabled, then log in.';
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      status.textContent = 'Signed in successfully.';
      await loadUserData();
      setTimeout(closeModal, 500);
    }
  } catch (error) {
    status.textContent = error.message || 'Something went wrong.';
  }
});

function openModal(type) {
  authMode = type === 'login' ? 'login' : 'signup';
  const title = document.getElementById('modalTitle');
  const text = document.getElementById('modalText');
  const submit = document.getElementById('authSubmit');
  const name = document.getElementById('fullName');
  const ref = document.getElementById('refCode');
  if (type === 'withdraw') {
    title.textContent = 'Withdrawal request';
    text.textContent = 'Sign in first. Withdrawals are validated against your server-side wallet and require the configured production payout flow.';
    document.getElementById('authStatus').textContent = 'Withdrawal processing will be enabled after the secure payout backend is configured.';
    document.getElementById('authForm').style.display = 'none';
  } else {
    document.getElementById('authForm').style.display = 'block';
    title.textContent = authMode === 'login' ? 'Welcome back' : 'Create your VickiEarn account';
    text.textContent = authMode === 'login' ? 'Log in to access your account.' : 'Create a secure VickiEarn account.';
    submit.textContent = authMode === 'login' ? 'Log in' : 'Create account';
    name.style.display = authMode === 'login' ? 'none' : 'block';
    ref.style.display = authMode === 'login' ? 'none' : 'block';
    document.getElementById('authStatus').textContent = '';
  }
  modal.classList.add('show');
}

function closeModal() { modal.classList.remove('show'); }

async function loadUserData() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: profile } = await supabase.from('profiles').select('full_name, referral_code').eq('id', user.id).single();
  const { data: wallet } = await supabase.from('wallets').select('balance_kobo').eq('user_id', user.id).single();
  const { count } = await supabase.from('referrals').select('*', { count: 'exact', head: true }).eq('referrer_id', user.id);
  const balance = Number(wallet?.balance_kobo || 0) / 100;
  document.querySelector('.balance').firstChild.textContent = `₦${balance.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById('referralLink').textContent = `${window.location.origin}${window.location.pathname}?ref=${profile?.referral_code || ''}`;
  document.getElementById('referralCount').textContent = `${count || 0} referrals`;
}

async function loadTasks() {
  const grid = document.getElementById('taskGrid');
  const { data, error } = await supabase.from('tasks').select('id,title,description,reward_kobo').eq('status','active').order('created_at', { ascending: false });
  if (error) { grid.innerHTML = '<p>Tasks are temporarily unavailable.</p>'; return; }
  if (!data?.length) { grid.innerHTML = '<p>No active tasks are available right now.</p>'; return; }
  grid.innerHTML = data.map(task => `<article class="task-card"><div class="task-icon">🎯</div><div><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.description)}</p></div><strong>₦${(Number(task.reward_kobo)/100).toLocaleString('en-NG')}</strong><button onclick="claimTask('${task.id}')">Start task</button></article>`).join('');
}

async function claimTask(taskId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { openModal('login'); return; }
  const { error } = await supabase.from('task_completions').insert({ task_id: taskId, user_id: user.id, proof: { submitted_from: 'web' } });
  alert(error ? error.message : 'Task started. Submit the required proof for review.');
}

function copyReferral() {
  const value = document.getElementById('referralLink').textContent;
  if (value.startsWith('Sign in')) { openModal('login'); return; }
  navigator.clipboard?.writeText(value);
  document.getElementById('copyStatus').textContent = 'Referral link copied.';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) loadUserData();
});

loadTasks();
loadUserData();
