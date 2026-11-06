// Local server for both dashboards — `node src/serve.js` (or double-click start-local.cmd), then open
// http://localhost:5178. Mirrors the GitHub Pages layout: Deadlock at /, Overwatch at /overwatch/.
//
// Local-only extra: Overwatch matchups (Counterwatch, personal use). On start — and every few hours —
// the server checks whether your local matchup data is missing or older than the latest patch and
// refreshes it in the background. /overwatch/counters.js is always served from the newest local copy,
// so the page picks it up without a rebuild. None of this exists on the public site.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(base); // the data paths below are relative to the project folder
const root = path.join(base, 'dist'), owRoot = path.join(base, 'dist-ow');
const port = +process.env.PORT || 5178;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const PRIVATE = path.join(base, 'data/overwatch/private/counters.json');

// ---- background matchup refresh ----
const cw = { status: fs.existsSync(PRIVATE) ? 'ready' : 'idle', fetched: null, error: null };
async function refreshCounters() {
  if (cw.status === 'fetching') return;
  try {
    const { ensureCounters } = await import('../overwatch/counters.js');
    const { fetchCached } = await import('../overwatch/fetch.js');
    // Latest Overwatch patch date from the built dashboard, so data refreshes after each patch.
    let latestPatchDate = null;
    try { const ow = JSON.parse(fs.readFileSync(path.join(owRoot, 'data.js'), 'utf8').replace(/^window\.OW = /, '').replace(/;\s*$/, '')); latestPatchDate = ow.patches?.at(-1)?.date; } catch {}
    const heroes = await fetchCached('https://overfast-api.tekrop.fr/heroes', { ttlHours: 24 });
    const have = fs.existsSync(PRIVATE) ? JSON.parse(fs.readFileSync(PRIVATE, 'utf8')) : null;
    const stale = !have || (latestPatchDate && new Date(have.fetched) < new Date(latestPatchDate)) || Date.now() - new Date(have.fetched) > 7 * 864e5;
    if (!stale) { cw.status = 'ready'; cw.fetched = have.fetched; return; }
    cw.status = 'fetching'; cw.error = null;
    console.log('Matchups: fetching fresh Counterwatch data in the background (about 2 minutes)…');
    const data = await ensureCounters({ heroes, latestPatchDate, force: true, log: (m) => console.log('  ' + m.trim()) });
    cw.status = 'ready'; cw.fetched = data.fetched;
    console.log('Matchups: ready.');
  } catch (e) {
    cw.status = fs.existsSync(PRIVATE) ? 'ready' : 'error'; cw.error = e.message;
    console.log(`Matchups: refresh failed (${e.message})${cw.status === 'ready' ? ' — keeping the previous copy' : ''}`);
  }
}
refreshCounters();
setInterval(refreshCounters, 6 * 3600e3);

http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/overwatch') { res.writeHead(301, { location: '/overwatch/' }); return res.end(); }
  if (u === '/overwatch/counters-status') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(cw));
  }
  if (u === '/overwatch/counters.js') {
    // Always the newest local copy (no rebuild needed). Never a 404, so the page loads cleanly.
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    if (fs.existsSync(PRIVATE)) return res.end(`window.OWC = ${fs.readFileSync(PRIVATE, 'utf8')};\nwindow.OWC_LOCAL = true;\n`);
    return res.end(`window.OWC_LOCAL = true;\n`);
  }
  const r = u.startsWith('/overwatch/') ? owRoot : root;
  if (r === owRoot) u = u.slice('/overwatch'.length);
  const p = path.normalize(path.join(r, u.endsWith('/') ? u + 'index.html' : u));
  if (!p.startsWith(r) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': (types[path.extname(p)] || 'application/octet-stream') + '; charset=utf-8', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Dashboard: http://localhost:${port}  (Overwatch: http://localhost:${port}/overwatch/)`));
