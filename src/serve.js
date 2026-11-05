// Minimal static server for dist/ — `node src/serve.js` then open http://localhost:5178
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = +process.env.PORT || 5178;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const p = path.normalize(path.join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': (types[path.extname(p)] || 'application/octet-stream') + '; charset=utf-8', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Dashboard: http://localhost:${port}`));
