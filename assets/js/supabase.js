// Creates the Supabase client. The URL and the PUBLISHABLE (anon) key come from config.js, which is generated
// from environment variables at build time (see README). The anon key is designed to be public: what a person
// can do with it is decided by the database's Row Level Security, never by this file.
const cfg = window.SUNSHINE_CONFIG || {};

export const REMEMBER_KEY = 'sunshine_remember';

// Safety net: refuse to start if someone pasted a SECRET key here by mistake.
function looksSecret(key) {
  if (String(key).startsWith('sb_secret_')) return true;
  try {
    const payload = JSON.parse(atob(String(key).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

const hasLibrary = Boolean(window.supabase && window.supabase.createClient);
const secretKey = Boolean(cfg.supabaseKey) && looksSecret(cfg.supabaseKey);
if (secretKey) console.error('[Sunshine] A secret/service-role key was found in config.js. Remove it and use the publishable (anon) key.');

export const configured = Boolean(cfg.supabaseUrl && cfg.supabaseKey && hasLibrary && !secretKey);

// "Remember me": ticked -> the session survives closing the browser (localStorage);
// not ticked -> it ends with the tab (sessionStorage). The PKCE code verifier always uses localStorage so a
// password-reset link opened in a new tab still works.
const storage = {
  getItem(key) {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  },
  setItem(key, value) {
    const persistent = key.endsWith('-code-verifier') || localStorage.getItem(REMEMBER_KEY) === '1';
    (persistent ? sessionStorage : localStorage).removeItem(key); // never leave a stale copy behind
    (persistent ? localStorage : sessionStorage).setItem(key, value);
  },
  removeItem(key) {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  },
};

export const setRemember = (on) => (on ? localStorage.setItem(REMEMBER_KEY, '1') : localStorage.removeItem(REMEMBER_KEY));

export const sb = configured
  ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { storage, storageKey: 'sunshine-auth', flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// A second client that never stores a session. It is used to create OTHER people's accounts
// (registration, or an admin adding a teacher) without touching the signed-in user's session.
export function isolatedClient() {
  return window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sunshine-signup' },
  });
}
