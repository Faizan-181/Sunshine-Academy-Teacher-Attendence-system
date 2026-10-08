import { html, mount, ic, avatar, badge, debounce, dbOutdatedNotice } from './ui.js';
import { get } from './api.js';
import { state } from './state.js';
import { formatLongDate } from './format.js';

const ADMIN_LINKS = [
  ['/', 'Dashboard', 'layout-dashboard'],
  ['/teachers', 'Teachers', 'users'],
  ['/mark-attendance', 'Mark Attendance', 'clipboard-check'],
  ['/attendance', 'Attendance History', 'history'],
  ['/reports', 'Reports', 'chart-column'],
  ['/profile', 'Profile', 'circle-user'],
  ['/settings', 'Settings', 'settings'],
];
const TEACHER_LINKS = [
  ['/', 'Dashboard', 'layout-dashboard'],
  ['/my-attendance', 'My Attendance', 'calendar-check'],
  ['/profile', 'My Profile', 'circle-user'],
];

/** Draws the sidebar + top bar once after sign-in and returns the element pages render into. */
export function renderShell(app) {
  const user = state.user;
  const links = user.role === 'admin' ? ADMIN_LINKS : TEACHER_LINKS;

  mount(app, html`
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <div class="sidebar-brand">
        <span class="sidebar-logo"><img src="assets/img/logo.png" alt="Sunshine Academy crest" width="48" height="48"></span>
        <div class="sidebar-title"><strong>Sunshine</strong><span>Academy</span></div>
        <button type="button" class="sidebar-close" id="menu-close" aria-label="Close menu">${ic('x', 20)}</button>
      </div>
      <nav class="nav">${links.map(([to, label, name]) => html`<a href="#${to}" data-nav="${to}">${ic(name, 20)} ${label}</a>`)}</nav>
      <div class="sidebar-foot"><button type="button" id="logout-btn">${ic('log-out', 20)} Logout</button></div>
    </aside>
    <div class="backdrop hidden" id="backdrop"></div>
    <div class="main">
      <header class="topbar">
        <button type="button" class="menu-btn" id="menu-open" aria-label="Open menu">${ic('menu', 24)}</button>
        ${user.role === 'admin'
          ? html`<div class="gsearch" id="gsearch" role="search">${ic('search', 16)}<input class="input" id="gsearch-input" type="search" placeholder="Search teachers by name, ID or subject" aria-label="Search teachers" autocomplete="off"><div class="gsearch-results hidden" id="gsearch-results"></div></div>`
          : html`<a class="topbar-brand" href="#/"><img src="assets/img/logo.png" alt="" width="32" height="32"><span>Sunshine Academy</span></a>`}
        <p class="topbar-date">${formatLongDate(state.today)}</p>
        <div class="topbar-user"><div class="who"><strong>${user.name}</strong><span>${user.role}</span></div>${avatar(user.name)}</div>
      </header>
      <main class="content">${state.dbOutdated && user.role === 'admin' ? dbOutdatedNotice() : ''}<div id="view"></div></main>
    </div>`);

  const sidebar = app.querySelector('#sidebar');
  const backdrop = app.querySelector('#backdrop');
  const setOpen = (open) => { sidebar.classList.toggle('open', open); backdrop.classList.toggle('hidden', !open); };
  app.querySelector('#menu-open').addEventListener('click', () => setOpen(true));
  app.querySelector('#menu-close').addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  app.querySelectorAll('[data-nav]').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  app.querySelector('#logout-btn').addEventListener('click', () => document.dispatchEvent(new CustomEvent('app:logout')));

  bindGlobalSearch(app);
  return app.querySelector('#view');
}

/** Admin-only search box in the top bar: type a name, ID or subject and jump to that teacher. */
function bindGlobalSearch(app) {
  const box = app.querySelector('#gsearch');
  if (!box) return;
  const input = box.querySelector('input');
  const panel = box.querySelector('#gsearch-results');
  let latest = 0;

  const close = () => panel.classList.add('hidden');
  const show = (content) => { mount(panel, content); panel.classList.remove('hidden'); };

  const search = debounce(async (query) => {
    const mine = ++latest;
    if (query.length < 2) return close();
    try {
      const { data } = await get('/teachers', { search: query, limit: 6 });
      if (mine !== latest) return; // a newer search is already running
      show(data.length
        ? html`${data.map((t) => html`<a class="gs-item" href="#/teachers/${t.id}">${avatar(t.name)}<span class="gs-text"><b>${t.name}</b><small>${t.teacher_id} · ${t.subject}</small></span>${badge(t.status)}</a>`)}`
        : html`<p class="gs-empty">No teachers found.</p>`);
    } catch {
      if (mine === latest) show(html`<p class="gs-empty">Unable to search right now.</p>`);
    }
  }, 250);

  input.addEventListener('input', () => search(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); input.blur(); }
    if (e.key === 'Enter') panel.querySelector('.gs-item')?.click();
  });
  panel.addEventListener('click', (e) => { if (e.target.closest('.gs-item')) { close(); input.value = ''; } });
  document.addEventListener('mousedown', (e) => { if (!box.contains(e.target)) close(); });
}

/** Highlights the current page in the sidebar. */
export function setActiveNav(path) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const to = a.dataset.nav;
    const active = to === '/' ? path === '/' : path === to || path.startsWith(to + '/');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
