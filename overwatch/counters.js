#!/usr/bin/env node
// PERSONAL-USE matchup data from Counterwatch (https://www.counterwatch.gg).
//
// Counterwatch's terms allow personal, non-commercial use only, so this data is:
//   • fetched on YOUR machine, into data/overwatch/private/ (gitignored),
//   • added only to YOUR local dashboard (dist-ow/counters.js),
//   • never copied to docs/ or GitHub Pages (src/pages.js strips it and refuses to publish it).
// Each friend runs this themselves. Don't commit or re-host the output.
//
//   node overwatch/counters.js          → fetch if missing or older than the latest patch
//   node overwatch/counters.js --force  → fetch now
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRIVATE_FILE = 'data/overwatch/private/counters.json';
const BASE = 'https://www.counterwatch.gg';
const DELAY_MS = 1500; // ~1.5 minutes for all heroes; be gentle with a small site
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dec = (s) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      // A timeout so one stuck connection can't freeze the whole download.
      res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (personal meta tool)' }, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
      await sleep(3000 * attempt); continue;
    }
    if (res.ok) return res.text();
    if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`${url}: HTTP ${res.status}`);
    await sleep(3000 * attempt);
  }
}

// One "counters to <hero>" page → rows of { slug, rating, impact, kills, deaths, players, tag }
// rating = how well that row's hero does AGAINST the page's hero (positive = counters them).
export function parseCountersPage(html) {
  const body = html.slice(html.indexOf('<body'));
  const rows = [];
  for (const m of body.matchAll(/<a[^>]*?title="([^"]*)"[^>]*?href="\/stats\/overwatch\/heroes\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const [, title, slug, inner] = m;
    const r = inner.match(/>([+−-]?\d+(?:\.\d+)?)<\/span>/g)?.map((x) => x.slice(1, -7)).find((x) => /^[+−-]\d/.test(x) || x === '0.0');
    if (r == null) continue;
    const spans = [...inner.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((x) => dec(x[1]).trim()).filter(Boolean);
    const t = dec(title);
    const conf = dec(inner.match(/<abbr title="([^"]*)"/)?.[1] || '');
    rows.push({
      slug,
      rating: +r.replace('−', '-'),
      impact: +(spans.find((s) => /^≈/.test(s))?.replace(/[≈\s%+]/g, '').replace('−', '-') ?? NaN) || null,
      kills: +(t.match(/takes (\d+)% of the kills/)?.[1] ?? NaN) || null,
      deaths: +(t.match(/suffers (\d+)% of the deaths/)?.[1] ?? NaN) || null,
      players: +(conf.match(/([\d,]+) players/)?.[1]?.replace(/,/g, '') ?? NaN) || null,
      confidence: conf.split(':')[0].replace(/ confidence$/i, '') || null,
      tag: spans.find((s) => /pressure|duel|dive|poke|brawl|sustain|burst|range/i.test(s)) || null,
    });
  }
  return rows;
}

export async function fetchCounters({ heroes, log = console.log }) {
  const sitemap = await get(`${BASE}/sitemap.xml`);
  const slugs = [...sitemap.matchAll(/\/stats\/overwatch\/counters\/([a-z0-9-]+)<\/loc>/g)].map((m) => m[1]).filter((s) => !['6v6', 'stadium'].includes(s));
  const keyBySlug = {};
  for (const h of heroes) { const s = slugs.find((x) => x.replace(/-/g, '') === h.key.replace(/-/g, '')); if (s) keyBySlug[s] = h.key; }
  const matrix = {}; // matrix[a][b] = { r, ... } → how hero a does against hero b
  let done = 0;
  for (const [slug, target] of Object.entries(keyBySlug)) {
    await sleep(DELAY_MS);
    try {
      for (const row of parseCountersPage(await get(`${BASE}/stats/overwatch/counters/${slug}`))) {
        const a = keyBySlug[row.slug]; if (!a || a === target) continue;
        (matrix[a] ??= {})[target] = { r: row.rating, i: row.impact, k: row.kills, d: row.deaths, n: row.players, c: row.confidence, t: row.tag };
      }
    } catch (e) { log(`  ${slug}: ${e.message}`); }
    if (++done % 10 === 0) log(`  counters: ${done}/${Object.keys(keyBySlug).length} heroes`);
  }
  return { fetched: new Date().toISOString(), source: `${BASE}/stats/overwatch`, mode: '5v5 competitive (site default)', heroes: done, matrix };
}

export function loadPrivate() { return fs.existsSync(PRIVATE_FILE) ? JSON.parse(fs.readFileSync(PRIVATE_FILE, 'utf8')) : null; }

export async function ensureCounters({ heroes, latestPatchDate, force = false, log = console.log }) {
  const have = loadPrivate();
  const stale = !have || (latestPatchDate && new Date(have.fetched) < new Date(latestPatchDate)) || (Date.now() - new Date(have.fetched)) > 14 * 864e5;
  if (!force && !stale) return have;
  log(`▸ Fetching Counterwatch matchups for personal use${have ? ' (new patch since last fetch)' : ''}…`);
  const data = await fetchCounters({ heroes, log });
  fs.mkdirSync(path.dirname(PRIVATE_FILE), { recursive: true });
  fs.writeFileSync(PRIVATE_FILE, JSON.stringify(data));
  log(`  saved ${Object.keys(data.matrix).length} heroes' matchups to ${PRIVATE_FILE} (gitignored)`);
  return data;
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { fetchCached } = await import('./fetch.js');
  const heroes = await fetchCached('https://overfast-api.tekrop.fr/heroes', { ttlHours: 24 });
  await ensureCounters({ heroes, force: process.argv.includes('--force') });
  console.log('✔ Done. Run node overwatch/build.js to add it to your local dashboard.');
}
