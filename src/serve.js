// Minimal static server for dist/ — `node src/serve.js` then open http://localhost:5178
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mirrors the GitHub Pages layout: Deadlock at /, Overwatch at /overwatch/
const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(base, 'dist'), owRoot = path.join(base, 'dist-ow');
const port = +process.env.PORT || 5178;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/overwatch') { res.writeHead(301, { location: '/overwatch/' }); return res.end(); }
  const r = u.startsWith('/overwatch/') ? owRoot : root;
  if (r === owRoot) u = u.slice('/overwatch'.length);
  const p = path.normalize(path.join(r, u.endsWith('/') ? u + 'index.html' : u));
  if (!p.startsWith(r) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': (types[path.extname(p)] || 'application/octet-stream') + '; charset=utf-8', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Dashboard: http://localhost:${port}`));
