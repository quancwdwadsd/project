(() => {
  const menu = document.getElementById('mobile-menu');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const setOpen = (open) => {
    sidebar.classList.toggle('is-open', open);
    overlay.hidden = !open;
    menu.setAttribute('aria-expanded', String(open));
  };
  menu.addEventListener('click', () => setOpen(!sidebar.classList.contains('is-open')));
  overlay.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });
})();
