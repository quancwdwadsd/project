const sidebar = document.getElementById('sidebar');
    const menuButton = document.getElementById('mobile-menu');
    const overlay = document.getElementById('sidebar-overlay');
    const toast = document.getElementById('dashboard-toast');
    let toastTimer;

    function setSidebarOpen(open) {
      sidebar.classList.toggle('is-open', open);
      overlay.hidden = !open;
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', open ? 'Đóng thanh điều hướng' : 'Mở thanh điều hướng');
    }

    menuButton.addEventListener('click', () => setSidebarOpen(!sidebar.classList.contains('is-open')));
    overlay.addEventListener('click', () => setSidebarOpen(false));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    });

    function showToast(message) {
      toast.textContent = message;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
    }

    document.getElementById('create-post').addEventListener('click', () => {
      window.location.href = './composer.html';
    });
