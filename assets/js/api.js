// The app's data layer. Pages call get/post/put/patch/del exactly as they did with the old PHP API;
// each call is translated here into Supabase Auth / database-function calls and answered in the SAME shape,
// so the page files barely changed. All permission checks happen inside the database (RLS + functions).
import { sb, isolatedClient, setRemember, REMEMBER_KEY, configured } from './supabase.js';
import { state } from './state.js';

export class ApiError extends Error {
  constructor(message, status = 0, errors = {}) {
    super(message);
    this.status = status;
    this.errors = errors; // field-level messages, e.g. { email: 'This email is already in use.' }
  }
}

/** A message that is always safe to show. Anything unexpected becomes the page's friendly fallback. */
export function errMsg(error, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof ApiError && error.status > 0 && error.status < 500) return error.message;
  if (error instanceof ApiError && error.status === 0) return error.message;
  return fallback;
}

const GENERIC = 'Something went wrong. Please try again.';
const FORBIDDEN = "You don't have permission to do that.";

/* ---------------- error translation: nothing technical ever reaches the screen ---------------- */
function authError(e) {
  const code = e.code || '';
  const msg = String(e.message || '');
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return new ApiError('Incorrect email or password.', 401);
  if (code === 'email_not_confirmed') return new ApiError('Please confirm your email address first. Check your inbox for the confirmation link.', 403);
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || e.status === 429) return new ApiError('Too many attempts. Please wait a few minutes and try again.', 429);
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(msg)) return new ApiError('This email is already in use.', 409, { email: 'This email is already in use.' });
  if (code === 'weak_password') return new ApiError('Choose a stronger password (at least 8 characters).', 400, { password: 'Choose a stronger password (at least 8 characters).' });
  if (code === 'same_password') return new ApiError('Choose a password different from the current one.', 400, { newPassword: 'Choose a password different from the current one.' });
  if (code === 'signup_disabled' || code === 'email_provider_disabled') return new ApiError('Registration is currently closed. Please contact the administrator.', 403);
  if (/database error/i.test(msg)) return new ApiError('This registration could not be completed. The email may be reserved or registrations may be closed. Please contact the administrator.', 409);
  if (/session|jwt|token/i.test(msg) && e.status === 401) return new ApiError('Your session has expired. Please sign in again.', 401);
  console.error('[Sunshine] auth', code || e.status || e.name);
  return new ApiError(GENERIC, e.status >= 400 && e.status < 500 ? 400 : 500);
}

function toApiError(e) {
  if (e instanceof ApiError) return e;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  const friendly = /^PT(\d{3})$/.exec(code); // our own user-friendly errors raised inside the database
  if (friendly) return new ApiError(msg, Number(friendly[1]), e.hint ? { [e.hint]: msg } : {});
  if (code === '42501') return new ApiError(FORBIDDEN, 403);
  if (e && typeof e.name === 'string' && e.name.startsWith('Auth')) return authError(e);
  if (e?.status === 401 || code === 'PGRST301' || /jwt/i.test(msg)) {
    document.dispatchEvent(new CustomEvent('app:expired'));
    return new ApiError('Your session has expired. Please sign in again.', 401);
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return new ApiError('Unable to reach the server. Check your connection and try again.', 0);
  }
  console.error('[Sunshine]', code || e?.name || 'error'); // log the code only, never keys or SQL
  return new ApiError(GENERIC, 500);
}

/* ---------------- small helpers ---------------- */
async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

const toId = (v) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : null);

function monthRange(month) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month || '');
  if (!m) return null;
  const last = new Date(Number(m[1]), Number(m[2]), 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

const lower = (s) => String(s || '').trim().toLowerCase();

const toUser = (me) => ({
  id: me.id, name: me.name, email: me.email, username: me.email, role: me.role,
  teacherId: me.teacherId ?? null, teacherCode: me.teacherCode ?? null,
});

const STATUS_MESSAGES = {
  pending: 'Your registration is waiting for approval from the administrator.',
  rejected: 'Your registration was not approved. Please contact the administrator.',
  inactive: 'Your account is inactive. Please contact the administrator.',
};

// Client-side session limits (for convenience only; the real protection is in the database and Supabase Auth).
const IDLE_MS = 8 * 3600 * 1000;
const REMEMBER_MS = 30 * 86400 * 1000;
const touch = () => localStorage.setItem('sunshine_last_active', String(Date.now()));
function sessionTooOld() {
  const now = Date.now();
  if (localStorage.getItem(REMEMBER_KEY) === '1') {
    const until = Number(localStorage.getItem('sunshine_remember_until') || 0);
    return until > 0 && now > until;
  }
  const last = Number(localStorage.getItem('sunshine_last_active') || 0);
  return last > 0 && now - last > IDLE_MS;
}

/* ---------------- the route table: old API paths -> Supabase ---------------- */
const routes = [];
const add = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern}$`), handler });

// ----- Auth
add('GET', '/auth/session', async () => {
  let needsSetup = false;
  const { data } = await sb.auth.getSession();
  if (data.session && sessionTooOld()) {
    await sb.auth.signOut();
    data.session = null;
  }
  if (data.session) {
    const me = await rpc('my_account');
    if (me && me.status === 'active') {
      touch();
      return { user: toUser(me), csrf: '', today: me.today, needsSetup: false };
    }
    await sb.auth.signOut(); // deactivated, pending or removed while signed in
  }
  try {
    needsSetup = Boolean(await rpc('needs_setup'));
  } catch {
    throw new ApiError('The database is not ready yet. Please finish the Supabase setup described in the README.', 503);
  }
  return { user: null, needsSetup };
});

add('POST', '/auth/login', async (m, p, b) => {
  const email = lower(b.identifier);
  if (!email.includes('@')) throw new ApiError('Please sign in with your email address.', 400, { identifier: 'Please sign in with your email address.' });
  setRemember(Boolean(b.remember));
  const { error } = await sb.auth.signInWithPassword({ email, password: String(b.password || '') });
  if (error) throw error;
  const me = await rpc('my_account');
  if (!me || me.status !== 'active') {
    await sb.auth.signOut();
    throw new ApiError(STATUS_MESSAGES[me?.status] || 'We could not find your account. Please contact the administrator.', 403);
  }
  if (b.remember) localStorage.setItem('sunshine_remember_until', String(Date.now() + REMEMBER_MS));
  touch();
  return { user: toUser(me), csrf: '', today: me.today };
});

add('POST', '/auth/logout', async () => {
  await sb.auth.signOut();
  localStorage.removeItem(REMEMBER_KEY);
  localStorage.removeItem('sunshine_remember_until');
  return { message: 'Signed out.' };
});

// Teachers sign themselves up. The database makes every new account a PENDING teacher (never an admin).
add('POST', '/auth/register', async (m, p, b) => {
  if (b.website) return { message: 'Registration submitted.' }; // hidden spam-trap field was filled in
  if (b.password !== b.confirm_password) throw new ApiError('Please fix the highlighted fields.', 400, { confirm_password: 'The passwords do not match.' });
  const { data, error } = await isolatedClient().auth.signUp({
    email: lower(b.email),
    password: String(b.password || ''),
    options: { data: { name: b.name, phone: b.phone, subject: b.subject, date_of_birth: b.date_of_birth || '', address: b.address || '' } },
  });
  if (error) throw error;
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    throw new ApiError('This email is already in use.', 409, { email: 'This email is already in use.' });
  }
  return {
    message: 'Registration submitted. You can sign in once the administrator approves your account.'
      + (data.session ? '' : ' Please also confirm your email address using the link we sent you.'),
  };
});

// First administrator: needs the one-time setup code from the SQL editor.
add('POST', '/auth/setup', async (m, p, b) => {
  if (b.password !== b.confirm_password) throw new ApiError('Please fix the highlighted fields.', 400, { confirm_password: 'The passwords do not match.' });
  if (!(await rpc('verify_setup_code', { p_code: String(b.setup_code || '').trim() }))) {
    throw new ApiError('The setup code is not correct.', 403, { setup_code: 'The setup code is not correct.' });
  }
  setRemember(false);
  const { data, error } = await sb.auth.signUp({
    email: lower(b.email), password: String(b.password || ''), options: { data: { name: b.name } },
  });
  if (error) throw error;
  if (!data.session) {
    throw new ApiError('Your account was created but Supabase is waiting for email confirmation. Turn OFF "Confirm email" in Supabase (Authentication > Providers > Email) for the first setup, then try again. See the README.', 400);
  }
  try {
    const me = await rpc('claim_first_admin', { p_code: String(b.setup_code).trim() });
    touch();
    return { message: 'Administrator account created. Welcome to Sunshine Academy!', user: toUser(me), csrf: '', today: me.today };
  } catch (e) {
    await sb.auth.signOut();
    throw e;
  }
});

add('POST', '/auth/forgot-password', async (m, p, b) => {
  const { error } = await sb.auth.resetPasswordForEmail(lower(b.email), { redirectTo: `${location.origin}${location.pathname}` });
  if (error && (error.status === 429 || /rate/i.test(error.code || ''))) throw error;
  // Always the same answer: never reveal whether an email is registered.
  return { message: 'If that email address is registered, a password reset link is on its way.' };
});

add('POST', '/auth/update-password', async (m, p, b) => {
  const { error } = await sb.auth.updateUser({ password: String(b.password || '') });
  if (error) throw error;
  return { message: 'Password changed successfully.' };
});

add('POST', '/auth/change-password', async (m, p, b) => {
  const email = state.user?.email;
  const re = await sb.auth.signInWithPassword({ email, password: String(b.currentPassword || '') });
  if (re.error) throw new ApiError('Your current password is incorrect.', 400, { currentPassword: 'Your current password is incorrect.' });
  const { error } = await sb.auth.updateUser({ password: String(b.newPassword || '') });
  if (error) throw error;
  return { message: 'Password changed successfully.' };
});

add('PATCH', '/auth/me', async (m, p, b) => {
  const r = await rpc('update_my_name', { p_name: b.name });
  return { message: r.message, user: toUser(r.user) };
});

// ----- Teachers
add('GET', '/teachers', (m, p) => rpc('list_teachers', { p_search: p.search || '', p_status: p.status || '', p_page: Number(p.page) || 1, p_limit: Number(p.limit) || 10 }));
add('GET', '/teachers/options', () => rpc('teacher_options'));
add('GET', '/teachers/subjects', () => rpc('teacher_subjects'));
add('GET', '/teachers/me', () => rpc('get_my_teacher'));
add('GET', '/teachers/(\\d+)', (m) => rpc('get_teacher', { p_id: Number(m[1]) }));

const teacherArgs = (b) => ({
  p_teacher_id: b.teacher_id, p_name: b.name, p_phone: b.phone, p_subject: b.subject,
  p_date_of_birth: b.date_of_birth || '', p_joining_date: b.joining_date, p_address: b.address || '', p_status: b.status || 'active',
});

// Admin adds a teacher: (1) the database checks everything, (2) a login is created, (3) the record is completed.
add('POST', '/teachers', async (m, p, b) => {
  if (!b.password || String(b.password).length < 8) {
    throw new ApiError('Please fix the highlighted fields.', 400, { password: 'Password must be at least 8 characters.' });
  }
  await rpc('admin_precheck_new_teacher', { ...teacherArgs(b), p_email: lower(b.email) });
  const { data, error } = await isolatedClient().auth.signUp({
    email: lower(b.email), password: String(b.password),
    options: { data: { name: b.name, phone: b.phone, subject: b.subject, date_of_birth: b.date_of_birth || '', address: b.address || '' } },
  });
  if (error) throw error;
  if (!data.user || (data.user.identities && data.user.identities.length === 0)) {
    throw new ApiError('This email is already in use.', 409, { email: 'This email is already in use.' });
  }
  return rpc('admin_complete_new_teacher', { p_auth_user_id: data.user.id, ...teacherArgs(b) });
});

add('PUT', '/teachers/(\\d+)', (m, p, b) => rpc('admin_update_teacher', { p_id: Number(m[1]), ...teacherArgs(b) }));
add('PATCH', '/teachers/(\\d+)/status', (m, p, b) => rpc('admin_set_teacher_status', { p_id: Number(m[1]), p_status: b.status }));
add('DELETE', '/teachers/(\\d+)', () => {
  throw new ApiError('Teachers are deactivated, not deleted, so their attendance history is always kept.', 405);
});

// ----- Attendance
const listArgs = (p) => {
  const range = monthRange(p.month);
  return {
    p_teacher: toId(p.teacher), p_subject: p.subject || '', p_status: p.status || '', p_date: p.date || null,
    p_from: range ? range.from : p.from || null, p_to: range ? range.to : p.to || null,
  };
};
add('GET', '/attendance/today', (m, p) => rpc('get_attendance_sheet', { p_date: p.date || null }));
add('POST', '/attendance/bulk', (m, p, b) => rpc('admin_save_attendance', { p_date: b.date, p_records: b.records }));
add('GET', '/attendance', (m, p) => rpc('list_attendance', { ...listArgs(p), p_page: Number(p.page) || 1, p_limit: Number(p.limit) || 10 }));
add('GET', '/attendance/summary', async (m, p) => {
  const a = listArgs(p);
  return { data: await rpc('attendance_summary', { p_teacher: a.p_teacher, p_from: a.p_from, p_to: a.p_to }) };
});
add('PUT', '/attendance/(\\d+)', (m, p, b) => rpc('admin_update_attendance', {
  p_id: Number(m[1]), p_status: b.status, p_check_in: b.check_in || '', p_check_out: b.check_out || '', p_remarks: b.remarks || '',
}));
add('POST', '/attendance/me/check-in', () => rpc('self_check_in'));
add('POST', '/attendance/me/check-out', () => rpc('self_check_out'));

// ----- Reports, dashboards, settings, backups
add('GET', '/reports/attendance', (m, p) => {
  const a = listArgs(p);
  return rpc('attendance_report', { p_teacher: a.p_teacher, p_from: a.p_from, p_to: a.p_to });
});
add('GET', '/reports/yearly', (m, p) => rpc('attendance_yearly_report', { p_year: Number(p.year), p_teacher: toId(p.teacher) }));
add('GET', '/dashboard/admin', () => rpc('dashboard_admin'));
add('GET', '/dashboard/teacher', () => rpc('dashboard_teacher'));
add('GET', '/settings', () => rpc('get_settings'));
add('PUT', '/settings', (m, p, b) => rpc('admin_update_settings', {
  p_start_time: b.startTime, p_grace_minutes: Number(b.graceMinutes), p_self_checkin: Boolean(b.selfCheckin),
}));
add('GET', '/export/attendance', async (m, p) => ({
  data: await rpc('admin_export_attendance', { p_after_id: Number(p.after) || 0, p_limit: 1000, p_from: p.from || null, p_to: p.to || null }),
}));
add('GET', '/export/teachers', async () => ({ data: await rpc('admin_export_teachers') }));

/* ---------------- public API (same signatures as before) ---------------- */
export async function api(method, path, { params, body } = {}) {
  if (!configured) throw new ApiError('The app is not connected to Supabase yet. Please follow the setup steps in the README.', 503);
  const route = routes.find((r) => r.method === method && r.re.test(path));
  if (!route) throw new ApiError('We could not find what you were looking for.', 404);
  try {
    const result = await route.handler(route.re.exec(path), params || {}, body || {});
    if (path !== '/auth/session' && path !== '/auth/login') touch();
    return result;
  } catch (error) {
    throw toApiError(error);
  }
}

export const get = (path, params) => api('GET', path, { params });
export const post = (path, body) => api('POST', path, { body });
export const put = (path, body) => api('PUT', path, { body });
export const patch = (path, body) => api('PATCH', path, { body });
export const del = (path) => api('DELETE', path);
