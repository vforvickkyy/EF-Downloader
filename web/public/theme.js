// Applies the saved theme before the page draws, so it never flashes the wrong one.
try {
  const t = localStorage.getItem('eastape-admin-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* storage blocked: follow the system */ }
