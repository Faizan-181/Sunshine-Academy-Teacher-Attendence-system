// =====================================================================================
// LOCAL TEST HARNESS ONLY - not part of the app and never deployed.
// A tiny stand-in for the Supabase gateway on http://127.0.0.1:54321 :
//   /rest/v1/*  -> forwarded to a real PostgREST (the same server software Supabase uses)
//   /auth/v1/*  -> a minimal imitation of Supabase Auth (GoTrue) speaking the endpoints supabase-js uses.
// It is NOT the real Supabase Auth. It exists so the real frontend + real PostgreSQL + real PostgREST
// + real RLS can be exercised end to end on a laptop.
// =====================================================================================
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const PORT = Number(process.env.GATEWAY_PORT || 54321);
const POSTGREST = process.env.POSTGREST_URL || 'http://127.0.0.1:3000';
const SECRET = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters';
const DB = process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/sunshine_e2e';
const pool = new pg.Pool({ connectionString: DB, max: 4 });
let confirmEmail = process.env.CONFIRM_EMAIL === 'on'; // like the Supabase "Confirm email" switch
const refreshTokens = new Map(); // refresh token -> { userId, sessionId }
const log = (...a) => process.env.MOCK_VERBOSE && console.log('[mock]', ...a);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept-profile, content-profile, range, accept',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'content-range',
};
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS, ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const gotrueError = (res, status, error_code, msg, extra = {}) => send(res, status, { code: status, error_code, msg, ...extra });

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { resolve({}); } });
});

const userJson = (u) => ({
  id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.email_confirmed_at,
  phone: '', confirmed_at: u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at, app_metadata: u.raw_app_meta_data,
  user_metadata: u.raw_user_meta_data, identities: [{ id: u.id, user_id: u.id, identity_data: { email: u.email, sub: u.id }, provider: 'email' }],
  created_at: u.created_at, updated_at: u.updated_at,
});

function sessionFor(u, sessionId = crypto.randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const expires_in = Number(process.env.TOKEN_TTL || 3600);
  const access_token = jwt.sign({
    aud: 'authenticated', exp: now + expires_in, iat: now, iss: 'http://127.0.0.1:54321/auth/v1', sub: u.id, email: u.email, phone: '',
    app_metadata: u.raw_app_meta_data, user_metadata: u.raw_user_meta_data, role: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: now }], session_id: sessionId,
  }, SECRET);
  const refresh_token = crypto.randomBytes(8).toString('hex');
  refreshTokens.set(refresh_token, { userId: u.id, sessionId });
  return { access_token, token_type: 'bearer', expires_in, expires_at: now + expires_in, refresh_token, user: userJson(u) };
}

const getUserByEmail = async (email) => (await pool.query('select * from auth.users where lower(email) = lower($1)', [email])).rows[0];
const getUserById = async (id) => (await pool.query('select * from auth.users where id = $1', [id])).rows[0];
function bearerUser(req) {
  const h = req.headers.authorization || '';
  try { return jwt.verify(h.replace(/^Bearer /, ''), SECRET).sub; } catch { return null; }
}

async function auth(req, res, url) {
  const route = url.pathname.replace('/auth/v1', '');
  const q = url.searchParams;
  const body = req.method === 'GET' ? {} : await readBody(req);
  log(req.method, route);

  if (route === '/signup' && req.method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email)) return gotrueError(res, 422, 'validation_failed', 'Unable to validate email address: invalid format');
    if (password.length < 6) return gotrueError(res, 422, 'weak_password', 'Password should be at least 6 characters.', { weak_password: { reasons: ['length'] } });
    const existing = await getUserByEmail(email);
    if (existing) {
      if (!confirmEmail) return gotrueError(res, 422, 'user_already_exists', 'User already registered');
      return send(res, 200, { ...userJson(existing), identities: [] }); // real Supabase hides existing accounts when email confirmation is on
    }
    try {
      const id = crypto.randomUUID();
      const confirmedAt = confirmEmail ? null : new Date().toISOString();
      await pool.query(
        `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ($1, $2, $3, $4, $5)`,
        [id, email, await bcrypt.hash(password, 8), confirmedAt, JSON.stringify(body.data || {})]);
      const u = await getUserById(id);
      return send(res, 200, confirmEmail ? userJson(u) : sessionFor(u));
    } catch (e) {
      log('signup db error:', e.message);
      return gotrueError(res, 500, 'unexpected_failure', 'Database error saving new user');
    }
  }

  if (route === '/token' && req.method === 'POST') {
    if (q.get('grant_type') === 'password') {
      const u = await getUserByEmail(String(body.email || ''));
      if (!u || !(await bcrypt.compare(String(body.password || ''), u.encrypted_password || ''))) return gotrueError(res, 400, 'invalid_credentials', 'Invalid login credentials');
      if (!u.email_confirmed_at) return gotrueError(res, 400, 'email_not_confirmed', 'Email not confirmed');
      await pool.query('update auth.users set last_sign_in_at = now() where id = $1', [u.id]);
      return send(res, 200, sessionFor(await getUserById(u.id)));
    }
    if (q.get('grant_type') === 'refresh_token') {
      const rec = refreshTokens.get(body.refresh_token);
      if (!rec) return gotrueError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      refreshTokens.delete(body.refresh_token);
      return send(res, 200, sessionFor(await getUserById(rec.userId), rec.sessionId));
    }
    return gotrueError(res, 400, 'validation_failed', 'unsupported grant_type');
  }

  if (route === '/user' && req.method === 'GET') {
    const id = bearerUser(req);
    const u = id && (await getUserById(id));
    return u ? send(res, 200, userJson(u)) : gotrueError(res, 401, 'bad_jwt', 'invalid JWT');
  }
  if (route === '/user' && req.method === 'PUT') {
    const id = bearerUser(req);
    const u = id && (await getUserById(id));
    if (!u) return gotrueError(res, 401, 'bad_jwt', 'invalid JWT');
    if (body.password !== undefined) {
      if (String(body.password).length < 6) return gotrueError(res, 422, 'weak_password', 'Password should be at least 6 characters.', { weak_password: { reasons: ['length'] } });
      if (await bcrypt.compare(String(body.password), u.encrypted_password)) return gotrueError(res, 422, 'same_password', 'New password should be different from the old password.');
      await pool.query('update auth.users set encrypted_password = $1 where id = $2', [await bcrypt.hash(String(body.password), 8), u.id]);
    }
    return send(res, 200, userJson(await getUserById(u.id)));
  }
  if (route === '/logout' && req.method === 'POST') return send(res, 204);
  if (route === '/recover' && req.method === 'POST') { log('recovery email requested for', body.email); return send(res, 200, {}); }
  return gotrueError(res, 404, 'not_found', 'Not found');
}

function proxyRest(req, res, url) {
  const target = new URL(POSTGREST + url.pathname.replace('/rest/v1', '') + url.search);
  const headers = { ...req.headers, host: target.host };
  delete headers.origin;
  const up = http.request(target, { method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, ...CORS });
    r.pipe(res);
  });
  up.on('error', () => send(res, 502, { message: 'PostgREST is not reachable' }));
  req.pipe(up);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  try {
    if (url.pathname.startsWith('/auth/v1/')) return await auth(req, res, url);
    if (url.pathname.startsWith('/rest/v1/')) return proxyRest(req, res, url);
    // test-only controls
    if (url.pathname === '/__test/confirm-email-mode') { confirmEmail = url.searchParams.get('on') === '1'; return send(res, 200, { confirmEmail }); }
    if (url.pathname === '/__test/confirm') { await pool.query('update auth.users set email_confirmed_at = now() where lower(email) = lower($1)', [url.searchParams.get('email')]); return send(res, 200, {}); }
    if (url.pathname === '/__test/health') return send(res, 200, { ok: true, confirmEmail });
    return send(res, 404, { message: 'not found' });
  } catch (e) {
    console.error('[mock] error', e.message);
    return send(res, 500, { message: 'mock error' });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`mock supabase gateway on ${PORT} (confirm email ${confirmEmail ? 'ON' : 'OFF'})`));
