// Thin client for api.deadlock-api.com with an on-disk cache.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cfg from '../config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

export async function get(endpoint, params = {}, { ttlHours = cfg.cacheTtlHours, offline = false } = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])
  ).toString();
  const url = `${cfg.api}${endpoint}${qs ? '?' + qs : ''}`;
  const key = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  fs.mkdirSync(cfg.cacheDir, { recursive: true });
  const file = path.join(cfg.cacheDir, `${key}.json`);

  if (fs.existsSync(file)) {
    const ageH = (Date.now() - fs.statSync(file).mtimeMs) / 3.6e6;
    if (offline || ageH < ttlHours) return JSON.parse(fs.readFileSync(file, 'utf8')).body;
  }
  if (offline) throw new Error(`offline and no cache for ${url}`);

  const wait = cfg.requestDelayMs - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  for (let attempt = 1; ; attempt++) {
    lastCall = Date.now();
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'deadlock-meta-auditor/0.1' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      fs.writeFileSync(file, JSON.stringify({ url, fetched: new Date().toISOString(), body }));
      return body;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${url} failed: ${e.message}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

export const unix = (d) => Math.floor(new Date(d).getTime() / 1000);
