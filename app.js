const { createClient } = window.supabase;
const supabase = createClient(window.VICKIEARN_SUPABASE_URL, window.VICKIEARN_SUPABASE_KEY);

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
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, referral_code: refCode || null } }
      });
      if (error) throw error;
      if (data.session) {
        status.textContent = 'Account created and signed in.';
        await loadUserData();
        setTimeout(closeModal, 500);
      } else {
        status.textContent = 'Account created. Check your email to verify your account, then log in.';
      }
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
  const status = document.getElementById('authStatus');

  if (type === 'withdraw') {
    title.textContent = 'Withdrawal request';
    text.textContent = 'Sign in first. Withdrawals will use your server-side wallet and secured payout backend.';
    status.textContent = 'Secure payout processing will be enabled after the Paystack backend is configured.';
    authForm.style.display = 'none';
  } else {
    authForm.style.display = 'block';
    title.textContent = authMode === 'login' ? 'Welcome back' : 'Create your VickiEarn account';
    text.textContent = authMode === 'login' ? 'Log in to access your account.' : 'Create a secure VickiEarn account.';
    submit.textContent = authMode === 'login' ? 'Log in' : 'Create account';
    name.style.display = authMode === 'login' ? 'none' : 'block';
    ref.style.display = authMode === 'login' ? 'none' : 'block';
    status.textContent = '';
  }
  modal.classList.add('show');
}

function closeModal() { modal.classList.remove('show'); }

async function loadUserData() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const [profileResult, walletResult, referralResult, referralEarningsResult] = await Promise.all([
    supabase.from('profiles').select('full_name, referral_code').eq('id', user.id).single(),
    supabase.from('wallets').select('balance_kobo, lifetime_earned_kobo').eq('user_id', user.id).single(),
    supabase.from('referrals').select('*', { count: 'exact', head: true }).eq('referrer_id', user.id),
    supabase.from('transactions').select('amount_kobo').eq('user_id', user.id).eq('type', 'referral_reward')
  ]);

  if (profileResult.error || walletResult.error) {
    console.error('Unable to load account data', profileResult.error || walletResult.error);
    return;
  }

  const profile = profileResult.data;
  const wallet = walletResult.data;
  const balance = Number(wallet.balance_kobo || 0) / 100;
  const referralEarnings = (referralEarningsResult.data || []).reduce((sum, row) => sum + Number(row.amount_kobo || 0), 0) / 100;

  const balanceEl = document.querySelector('.balance');
  if (balanceEl) balanceEl.textContent = `₦${balance.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('referralLink').textContent = `${window.location.origin}${window.location.pathname}?ref=${profile.referral_code}`;
  document.getElementById('referralCount').textContent = `${referralResult.count || 0} referrals`;
  document.getElementById('referralEarnings').textContent = `₦${referralEarnings.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function loadTasks() {
  const grid = document.getElementById('taskGrid');
  const { data, error } = await supabase
    .from('tasks')
    .select('id,title,description,reward_kobo,max_completions,completion_count')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) { grid.innerHTML = '<p>Tasks are temporarily unavailable.</p>'; return; }
  if (!data?.length) { grid.innerHTML = '<p>No active tasks are available right now.</p>'; return; }

  grid.innerHTML = data.map(task => {
    const limitReached = task.max_completions !== null && task.completion_count >= task.max_completions;
    return `<article class="task-card"><div class="task-icon">🎯</div><div><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.description)}</p></div><strong>₦${(Number(task.reward_kobo) / 100).toLocaleString('en-NG')}</strong><button ${limitReached ? 'disabled' : ''} onclick="claimTask('${task.id}')">${limitReached ? 'Completed' : 'Start task'}</button></article>`;
  }).join('');
}

async function claimTask(taskId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { openModal('login'); return; }
  const { error } = await supabase.from('task_completions').insert({ task_id: taskId, user_id: user.id, proof: { submitted_from: 'web' } });
  if (error) {
    alert(error.message);
    return;
  }
  alert('Task started. Your completion is pending review. Rewards are credited only after approval.');
}

function copyReferral() {
  const value = document.getElementById('referralLink').textContent;
  if (value.startsWith('Sign in')) { openModal('login'); return; }
  navigator.clipboard?.writeText(value);
  document.getElementById('copyStatus').textContent = 'Referral link copied.';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) loadUserData();
});

loadTasks();
loadUserData();
