function showToast(message){const t=document.getElementById('toast');if(!t)return;t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
function toggleSidebar(){document.querySelector('.sidebar')?.classList.toggle('open')}
function copyLink(){const input=document.querySelector('.copy-row input');if(input){navigator.clipboard?.writeText(input.value);const s=document.getElementById('copyStatus');if(s)s.textContent='Referral link copied (demo).';showToast('Referral link copied')}}
function logout(){location.href='index.html'}