(() => {
  'use strict';

  const grid = document.getElementById('week-grid');
  const title = document.getElementById('week-title');
  const dialog = document.getElementById('schedule-dialog');
  const form = document.getElementById('schedule-form');
  const toast = document.getElementById('planner-toast');
  const dayNames = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];
  const demoPosts = [
    { day: 0, time: '09:00', channel: 'Facebook', title: 'Khuyến mãi tháng 11' },
    { day: 1, time: '10:30', channel: 'Instagram', title: 'Bộ sưu tập mới' },
    { day: 2, time: '14:00', channel: 'TikTok', title: 'Behind the scenes' },
    { day: 3, time: '15:30', channel: 'Facebook', title: 'Webinar' },
    { day: 5, time: '11:00', channel: 'Instagram', title: 'Story cuối tuần' },
  ];
  let offset = 0;
  let toastTimer;

  function mondayOf(date) {
    const monday = new Date(date);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
  }
  function formatDate(date) { return `${date.getDate()} Tháng ${date.getMonth() + 1}`; }
  function render() {
    const today = new Date();
    const start = mondayOf(today);
    start.setDate(start.getDate() + offset * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    title.textContent = `${String(start.getDate()).padStart(2, '0')} — ${formatDate(end)}`;
    grid.replaceChildren();
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const column = document.createElement('section');
      column.className = `day-column${date.toDateString() === today.toDateString() ? ' is-today' : ''}`;
      column.setAttribute('aria-label', `${dayNames[index]} ${date.getDate()}`);
      const heading = document.createElement('div');
      heading.className = 'day-heading';
      heading.innerHTML = `<span>${dayNames[index]}</span><strong>${date.getDate()}</strong>`;
      const posts = document.createElement('div');
      posts.className = 'day-posts';
      demoPosts.filter((post) => post.day === index && offset === 0).forEach((post) => posts.append(createPost(post)));
      column.append(heading, posts);
      grid.append(column);
    }
  }
  function createPost(post) {
    const card = document.createElement('article');
    card.className = 'post-card';
    card.dataset.channel = post.channel;
    const time = document.createElement('span');
    time.className = 'post-time';
    time.textContent = post.time;
    const name = document.createElement('strong');
    name.className = 'post-title';
    name.textContent = `${post.channel} / ${post.title}`;
    const status = document.createElement('span');
    status.className = 'post-status';
    status.textContent = 'Đã lên lịch';
    card.append(time, name, status);
    return card;
  }
  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
  }

  document.getElementById('previous-week').addEventListener('click', () => { offset -= 1; render(); });
  document.getElementById('next-week').addEventListener('click', () => { offset += 1; render(); });
  document.getElementById('today').addEventListener('click', () => { offset = 0; render(); });
  document.getElementById('week-view').addEventListener('change', (event) => {
    showToast(event.target.checked ? 'Đang xem lịch theo tuần' : 'Giao diện hiện hỗ trợ lịch tuần');
    event.target.checked = true;
  });
  document.getElementById('new-post').addEventListener('click', () => {
    window.location.href = './composer.html';
  });
  const closeDialog = () => dialog.close();
  document.getElementById('close-dialog').addEventListener('click', closeDialog);
  document.getElementById('cancel-dialog').addEventListener('click', closeDialog);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const postDate = new Date(`${data.get('date')}T00:00:00`);
    const currentMonday = mondayOf(new Date());
    const postMonday = mondayOf(postDate);
    const weekOffset = Math.round((postMonday - currentMonday) / 604800000);
    if (weekOffset !== offset) { offset = weekOffset; render(); }
    const day = (postDate.getDay() + 6) % 7;
    const post = { day, time: data.get('time'), channel: data.get('channel'), title: data.get('title') };
    const column = grid.children[day]?.querySelector('.day-posts');
    if (column) column.append(createPost(post));
    closeDialog();
    form.reset();
    showToast('Bài đăng đã được thêm vào lịch demo.');
  });
  document.getElementById('mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('is-open'));
  render();
})();
