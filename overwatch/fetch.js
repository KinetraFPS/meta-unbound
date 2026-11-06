// Cached, rate-limited GET for the Overwatch pipeline (JSON from OverFast, HTML from Blizzard).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cfg from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;

export async function fetchCached(url, { as = 'json', ttlHours = cfg.cacheTtlHours, offline = false } = {}) {
  fs.mkdirSync(cfg.cacheDir, { recursive: true });
  const file = path.join(cfg.cacheDir, crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + (as === 'json' ? '.json' : '.html'));
  if (fs.existsSync(file) && (offline || (Date.now() - fs.statSync(file).mtimeMs) / 3.6e6 < ttlHours)) {
    const raw = fs.readFileSync(file, 'utf8');
    return as === 'json' ? JSON.parse(raw) : raw;
  }
  if (offline) throw new Error(`offline and no cache for ${url}`);
  for (let attempt = 1; ; attempt++) {
    const wait = cfg.requestDelayMs - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'overwatch-meta-auditor/0.1 (fan project)' } });
      if (res.status === 429) { const ra = +(res.headers.get('retry-after') || 5); await sleep(ra * 1000); throw new Error('HTTP 429'); }
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const body = as === 'json' ? await res.json() : await res.text();
      fs.writeFileSync(file, as === 'json' ? JSON.stringify(body) : body);
      return body;
    } catch (e) {
      if (attempt >= 4 || /HTTP 4(0[0-9]|1|2[0-8])/.test(e.message)) throw new Error(`${url} failed: ${e.message}`);
      await sleep(1500 * 2 ** attempt);
    }
  }
}
