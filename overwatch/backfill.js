#!/usr/bin/env node
// Backfills Overwatch win-rate history from the Internet Archive's saved copies of Blizzard's
// official Hero Statistics page, so the Patch impact view can compare "before" and "after" a patch.
//
// Each archived page is checked for the filters it was showing (mode, platform, region, rank, map).
// Only Competitive · all maps copies are kept — Blizzard's default page is Quick Play, and mixing
// that in would give wrong "before" numbers. Results merge into data/overwatch/snapshots/.
//
//   node overwatch/backfill.js     (safe to run often: already-checked captures are skipped)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SNAP_DIR = 'data/overwatch/snapshots';
const STATE = 'data/overwatch/backfill-state.json';
const MAX_PER_RUN = 40;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dec = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');

// ---- parse one Blizzard rates page (live or archived) ----
export function parseRatesPage(html) {
  const sel = {};
  // <select ...> blocks: read the selected <option>'s value and data-title
  for (const m of html.matchAll(/<option[^>]*?data-title="([^"]*)"[^>]*?selected="selected"[^>]*?value="([^"]*)"|<option[^>]*?selected="selected"[^>]*?data-title="([^"]*)"[^>]*?value="([^"]*)"/g)) {
    const title = (m[1] ?? m[3]).toLowerCase(), value = m[2] ?? m[4];
    if (/queue|competitive|quick play|stadium/.test(title)) sel.mode = /competitive/.test(title) ? 'competitive' : /quick/.test(title) ? 'quickplay' : 'other';
    else if (/mouse|controller|keyboard|console/.test(title)) sel.platform = /mouse|keyboard/.test(title) ? 'pc' : 'console';
    else if (/^(americas|europe|asia)$/.test(title)) sel.region = title;
    else if (/tier/.test(title) || /^(bronze|silver|gold|platinum|emerald|diamond|master|grandmaster)$/.test(title)) sel.div = /all_tiers/.test(title) ? 'all' : title;
    else if (/map/.test(title)) sel.map = value;
    else if (/role/.test(title)) sel.role = value;
  }
  const rows = {};
  for (const m of dec(html).matchAll(/\{"id":"([a-z0-9-]+)","cells":\{"name":"[^"]*","winrate":([\d.]+),"pickrate":([\d.]+),"banrate":([\d.]+)/g)) rows[m[1]] = [+m[2], +m[3], +m[4]];
  return { sel, rows };
}

const usable = ({ sel, rows }) => sel.mode === 'competitive' && sel.map === 'all-maps' && (!sel.role || sel.role === 'All') && sel.platform && sel.region && sel.div && Object.keys(rows).length >= 20;

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'meta-unbound backfill (fan project)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function backfill({ fromDate, log = console.log }) {
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { checked: {} };
  const from = (fromDate || '2026-01-01').replace(/-/g, '').slice(0, 8);
  let list;
  try {
    const cdx = await get(`https://web.archive.org/cdx/search/cdx?url=overwatch.blizzard.com/en-us/rates/&matchType=prefix&from=${from}&output=json&fl=timestamp,original&filter=statuscode:200&collapse=digest`);
    list = JSON.parse(cdx).slice(1);
  } catch (e) { log(`  Internet Archive unavailable (${e.message}); will try again next build`); return { added: 0, reason: 'archive unavailable' }; }
  // Prefer explicit competitive URLs (rq=1) — the bare URL is Quick Play by default.
  const todo = list.filter(([t, u]) => !state.checked[`${t} ${u}`]).sort((a, b) => (/rq=1/.test(b[1]) - /rq=1/.test(a[1])) || b[0].localeCompare(a[0])).slice(0, MAX_PER_RUN);
  log(`  archive: ${list.length} captures since ${fromDate}, checking ${todo.length} new`);
  let added = 0;
  for (const [ts, url] of todo) {
    await sleep(2000);
    let verdict = 'skipped';
    try {
      const parsed = parseRatesPage(await get(`https://web.archive.org/web/${ts}id_/${url}`));
      if (usable(parsed)) {
        const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
        const file = path.join(SNAP_DIR, `${date}.json`);
        const snap = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { date, stats: {}, source: 'archive' };
        const key = `${parsed.sel.platform}|${parsed.sel.region}`;
        snap.stats[key] ??= {};
        if (!snap.stats[key][parsed.sel.div]) { snap.stats[key][parsed.sel.div] = parsed.rows; added++; verdict = `kept ${key} ${parsed.sel.div}`; }
        fs.mkdirSync(SNAP_DIR, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(snap));
      } else verdict = `not competitive/all-maps (${parsed.sel.mode || '?'})`;
    } catch (e) { verdict = `error ${e.message}`; if (/HTTP 5/.test(e.message)) break; }
    state.checked[`${ts} ${url}`] = verdict;
  }
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state));
  log(`  archive: added ${added} historical snapshot(s)`);
  return { added };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await backfill({ fromDate: process.argv[2] || '2026-07-01' });
}
