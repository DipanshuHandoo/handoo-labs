(() => {
  let theme = 'dark';
  try {
    const saved = localStorage.getItem('handoo-theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {}
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#090c13' : '#f6f7fb');
  window.handooTheme = {
    toggle() {
      theme = theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme;
      try { localStorage.setItem('handoo-theme', theme); } catch {}
      document.querySelectorAll('[data-theme-button]').forEach((button) => button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`));
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#090c13' : '#f6f7fb');
    },
  };
})();
