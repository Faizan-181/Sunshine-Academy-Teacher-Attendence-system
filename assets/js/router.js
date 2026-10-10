import { state } from './state.js';
import { html, mount, ic, loading } from './ui.js';
import { renderShell, setActiveNav } from './layout.js';

// Pages load on demand. roles: who may open the page (leave out = any signed-in user).
const ROUTES = [
  { path: '/', title: 'Dashboard', load: () => import('./pages/dashboard.js') },
  { path: '/profile', title: 'Profile', load: () => import('./pages/profile.js') },
  { path: '/teachers', title: 'Teachers', roles: ['admin'], load: () => import('./pages/teachers.js') },
  { path: '/teachers/new', title: 'Add Teacher', roles: ['admin'], load: () => import('./pages/teacher-form.js') },
  { path: '/teachers/:id', title: 'Teacher Profile', roles: ['admin'], load: () => import('./pages/teacher-profile.js') },
  { path: '/teachers/:id/edit', title: 'Edit Teacher', roles: ['admin'], load: () => import('./pages/teacher-form.js') },
  { path: '/mark-attendance', title: 'Mark Attendance', roles: ['admin'], load: () => import('./pages/mark-attendance.js') },
  { path: '/attendance', title: 'Attendance History', roles: ['admin'], load: () => import('./pages/history.js') },
  { path: '/leave-requests', title: 'Leave Management', load: () => import('./pages/leave-requests.js') },
  { path: '/reports', title: 'Reports', roles: ['admin'], load: () => import('./pages/reports.js') },
  { path: '/settings', title: 'Settings', roles: ['admin'], load: () => import('./pages/settings.js') },
  { path: '/my-attendance', title: 'My Attendance', roles: ['teacher'], load: () => import('./pages/my-attendance.js') },
].map((r) => ({ ...r, regex: new RegExp('^' + r.path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') }));

// Pages anyone can open without signing in.
const PUBLIC = {
  '/login': { title: 'Sign in', load: () => import('./pages/login.js') },
  '/register': { title: 'Teacher registration', load: () => import('./pages/register.js') },
  '/setup': { title: 'First-time setup', load: () => import('./pages/setup.js') },
};

const app = () => document.getElementById('app');
let shellFor = null; // user id the current shell was drawn for
let navToken = 0;

export function clearShell() {
  shellFor = null;
}

export async function renderRoute() {
  const token = ++navToken;
  const hash = location.hash.slice(1) || '/';
  const [path, queryString] = hash.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString || ''));

  // Arriving from a password-reset email: a small stand-alone page, not the normal app shell.
  if (path === '/reset-password') {
    clearShell();
    document.title = 'Reset password · Sunshine Academy';
    const mod = await import('./pages/reset-password.js');
    if (token === navToken) mod.default({ app: app() });
    return;
  }

  // Signed out: only the login, register and first-time setup pages are available.
  if (!state.user) {
    const publicPage = PUBLIC[path];
    if (!publicPage) {
      sessionStorage.setItem('sunshine_next', hash);
      location.hash = '#/login';
      return;
    }
    clearShell();
    document.title = `${publicPage.title} · Sunshine Academy`;
    const mod = await publicPage.load();
    if (token === navToken) {
      mod.default({
        app: app(),
        onSignedIn: () => {
          const next = sessionStorage.getItem('sunshine_next') || '/';
          sessionStorage.removeItem('sunshine_next');
          const target = '#' + next;
          if (location.hash === target) renderRoute(); else location.hash = target; // hashchange re-renders
        },
      });
    }
    return;
  }

  if (PUBLIC[path]) {
    location.hash = '#/';
    return;
  }

  let match = null;
  for (const route of ROUTES) {
    const m = route.regex.exec(path);
    if (m) { match = { route, params: m.groups || {} }; break; }
  }

  if (match?.route.roles && !match.route.roles.includes(state.user.role)) {
    location.hash = '#/';
    return;
  }

  if (shellFor !== state.user.id) {
    renderShell(app());
    shellFor = state.user.id;
  }
  const view = document.getElementById('view');
  setActiveNav(path);

  if (!match) {
    document.title = 'Page not found · Sunshine Academy';
    mount(view, html`<div class="state" style="min-height:60vh;justify-content:center"><img src="assets/img/logo.png" alt="" width="96" height="96" style="object-fit:contain"><h3 style="font-size:24px;margin-top:24px">Page not found</h3><p>The page you are looking for does not exist or has been moved.</p><a class="btn btn-primary" href="#/">Back to dashboard</a></div>`);
    return;
  }

  document.title = `${match.route.title} · Sunshine Academy`;
  // Each visit renders into its own container, so a slow page can never draw over a newer one.
  const root = document.createElement('div');
  mount(root, loading());
  view.replaceChildren(root);
  try {
    const mod = await match.route.load();
    if (token !== navToken) return;
    await mod.default({ root, params: match.params, query });
  } catch (error) {
    console.error(error);
    if (token === navToken) mount(root, html`<div class="card"><div class="state"><span class="state-icon err">${ic('circle-alert', 24)}</span><p>Something went wrong. Please try again.</p><a class="btn btn-secondary btn-sm" href="#/">Back to dashboard</a></div></div>`);
  }
}

export function startRouter() {
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}
