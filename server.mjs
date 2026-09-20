/*
 * Static file server for the Civic Air prototype.
 *
 * Deliberately dependency-free: the whole app is static HTML, one runtime file
 * and a font directory, so a node:http server is the entire backend and there is
 * nothing to install at build time.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 3000;

// Routes are clean paths rather than .html, so a link the user copies out of the
// address bar stays readable in a demo.
const ROUTES = {
  '/': 'index.html',
  '/command-center': 'command-center.html',
  '/alerts': 'alerts.html',
  '/flight-history': 'flight-history.html',
  '/data-request': 'data-request.html',
  '/privacy-audit': 'privacy-audit.html',
  '/qr': 'qr.html'
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
};

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const clean = url.pathname.replace(/\/+$/, '') || '/';

  if (clean === '/healthz') return send(res, 200, JSON.stringify({ ok: true }), TYPES['.json']);

  const mapped = ROUTES[clean];
  // Anything not in the route table is served from public/ by name. The join is
  // resolved and re-checked against ROOT so a traversal cannot escape it.
  const file = mapped
    ? path.join(ROOT, mapped)
    : path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));

  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain');

  fs.readFile(file, (err, body) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const cache = path.extname(file) === '.woff2'
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    res.writeHead(200, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
    res.end(body);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Civic Air listening on ${PORT}`);
});
