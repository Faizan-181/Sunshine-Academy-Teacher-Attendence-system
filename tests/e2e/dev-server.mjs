// Static file server for local testing. It sends the SAME security headers (CSP etc.) as vercel.json,
// so a Content-Security-Policy violation shows up locally instead of after deployment.
// Config comes from environment variables: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (never a secret key).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8080);
const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml' };

const csp = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
  `connect-src 'self' ${URL_}`.trim(), "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
].join('; ');

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const headers = {
    'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Cache-Control': 'no-store',
  };
  if (pathname === '/assets/js/config.js') {
    res.writeHead(200, { ...headers, 'Content-Type': TYPES['.js'] });
    return res.end(`window.SUNSHINE_CONFIG = ${JSON.stringify({ supabaseUrl: URL_, supabaseKey: KEY })};`);
  }
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const allowed = rel === 'index.html' || rel.startsWith('assets/'); // nothing else (SQL, docs, scripts) is ever served
  const file = path.join(ROOT, rel);
  if (!allowed || !file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, headers); return res.end('Not found');
  }
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`dev server on http://127.0.0.1:${PORT}`));
