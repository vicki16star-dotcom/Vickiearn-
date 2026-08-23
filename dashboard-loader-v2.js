(()=>{
  // The dashboard-failsafe loader is the single source of truth now.
  // Do not run a second Promise.all() loader here; one optional table failing
  // must never leave the rest of the dashboard stuck on Loading.
  window.__vickiEarnBoot=()=>typeof window.loadDashboard==='function' ? window.loadDashboard() : Promise.resolve();
})();
