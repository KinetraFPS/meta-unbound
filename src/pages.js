// Copies the built dashboards into docs/ so GitHub Pages can serve them.
// Usage: npm run pages, then commit + push docs/.
//
// The Overwatch matchup data (Counterwatch, personal use only) is NEVER published: counters.js is
// skipped, its <script> tag is removed, and the publish aborts if any of it slipped through.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PRIVATE = new Set(['counters.js']);
if (!fs.existsSync('dist/data.js')) { console.error('✖ dist/ is empty — run node src/build.js first'); process.exit(1); }
fs.rmSync('docs', { recursive: true, force: true });
fs.mkdirSync('docs');
for (const f of fs.readdirSync('dist')) fs.copyFileSync(path.join('dist', f), path.join('docs', f));
if (fs.existsSync('dist-ow/data.js')) {
  fs.mkdirSync('docs/overwatch');
  for (const f of fs.readdirSync('dist-ow')) {
    if (PRIVATE.has(f)) continue;
    let body = fs.readFileSync(path.join('dist-ow', f));
    if (f === 'index.html') body = body.toString().replace(/\s*<script src="counters\.js"[^>]*><\/script>/, '');
    fs.writeFileSync(path.join('docs/overwatch', f), body);
  }
}
fs.writeFileSync('docs/.nojekyll', ''); // serve files as-is

// Cache-busting: GitHub Pages lets browsers reuse files for ~10 minutes, so after a (daily) update
// people could see the old data. Tag every local script/stylesheet with a hash of its contents.
for (const dir of ['docs', 'docs/overwatch']) {
  const idx = path.join(dir, 'index.html');
  if (!fs.existsSync(idx)) continue;
  const html = fs.readFileSync(idx, 'utf8').replace(/(src|href)="([a-z0-9-]+\.(?:js|css))"/g, (m, attr, f) => {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) return m;
    const v = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 10);
    return `${attr}="${f}?v=${v}"`;
  });
  fs.writeFileSync(idx, html);
}

// Safety check: no Counterwatch data anywhere in what gets published.
const leaks = [];
// Signs of leaked DATA (not code that merely mentions it): the file itself, the data assignment,
// the matchup matrix, or a page that loads counters.js.
const LEAK = /window\.OWC\s*=|"matrix":\{"|<script[^>]+src="counters\.js"/;
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (PRIVATE.has(f) || LEAK.test(fs.readFileSync(p, 'utf8'))) leaks.push(p); } };
walk('docs');
if (leaks.length) { fs.rmSync('docs', { recursive: true, force: true }); console.error(`✖ Refusing to publish: Counterwatch data found in ${leaks.join(', ')}`); process.exit(1); }
console.log('✔ Copied dashboards to docs/ (no Counterwatch data) — commit and push to update GitHub Pages');
