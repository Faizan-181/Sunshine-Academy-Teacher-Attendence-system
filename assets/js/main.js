import { state } from './state.js';
import { get, post } from './api.js';
import { sb, configured } from './supabase.js';
import { html, mount, toast, loading } from './ui.js';
import { clearShell, renderRoute, startRouter } from './router.js';

const app = document.getElementById('app');

function endSession(message) {
  state.user = null;
  state.csrf = '';
  state.needsSetup = false;
  clearShell();
  if (message) toast.error(message);
  if (location.hash === '#/login') renderRoute();
  else location.hash = '#/login';
}

// The server says the session ended (for example it timed out).
let expiredShown = false;
document.addEventListener('app:expired', () => {
  if (!state.user || expiredShown) return;
  expiredShown = true;
  endSession('Your session has expired. Please sign in again.');
  setTimeout(() => { expiredShown = false; }, 1000);
});

document.addEventListener('app:logout', async () => {
  state.signingOut = true; // so the sign-out event below is not mistaken for an expired session
  try { await post('/auth/logout'); } catch { /* signing out locally anyway */ }
  endSession();
  state.signingOut = false;
});

// Supabase tells us when a session ends or when someone arrives from a password-reset email.
if (configured) {
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      sessionStorage.setItem('sunshine_recovery', '1');
      history.replaceState(null, '', location.pathname); // remove ?code=... from the address bar
      location.hash = '#/reset-password';
    }
    if (event === 'SIGNED_OUT' && state.user && !state.signingOut) document.dispatchEvent(new CustomEvent('app:expired'));
  });
}

function showNotice(title, text) {
  mount(app, html`<div class="boot" style="padding:24px"><div class="card" style="max-width:520px;padding:28px;text-align:center">
    <img src="assets/img/logo.png" alt="" width="84" height="84" style="object-fit:contain;margin-bottom:12px">
    <h2 style="color:var(--navy-800);margin-bottom:8px">${title}</h2><p class="muted">${text}</p></div></div>`);
}

// Restore the session if one is stored, then start the app.
mount(app, html`<div class="boot">${loading('Loading…')}</div>`);
if (!configured) {
  showNotice('Almost there', 'This app is not connected to Supabase yet. Please follow the setup steps in the README (add your Supabase URL and publishable key), then reload this page.');
  throw new Error('Supabase is not configured');
}
try {
  const data = await get('/auth/session');
  state.user = data.user;
  state.csrf = data.csrf || '';
  state.today = data.today || '';
  state.needsSetup = Boolean(data.needsSetup);
} catch (error) {
  state.user = null;
  if (error.status === 503) {
    showNotice('The database is not ready', error.message);
    throw error;
  }
}
startRouter();
