#!/usr/bin/env node
// Overwatch meta auditor build.
//   node overwatch/build.js            → fetch latest stats + patch notes, write dist-ow/
//   node overwatch/build.js --offline  → rebuild from cache
// Tiers are computed in the browser from the raw numbers, so every platform/region/rank/map
// combination can be shown without precomputing it here.
import fs from 'node:fs';
import path from 'node:path';
import cfg from './config.js';
import { fetchCached } from './fetch.js';
import { loadPatches } from './patchNotes.js';
import { ensureCounters, loadPrivate } from './counters.js';
import { backfill } from './backfill.js';

const offline = process.argv.includes('--offline');
const log = (...m) => console.log(...m);
const api = (p, q = {}) => `${cfg.api}${p}${Object.keys(q).length ? '?' + new URLSearchParams(q) : ''}`;
const pack = (rows) => Object.fromEntries((rows || []).filter((r) => r.pickrate > 0 || r.winrate > 0).map((r) => [r.hero, [r.winrate, r.pickrate, r.banrate ?? 0]]));
const SNAP_DIR = 'data/overwatch/snapshots';

async function main() {
  log('▸ Heroes & kits');
  const heroes = await fetchCached(api('/heroes'), { offline, ttlHours: 24 });
  const kits = {};
  for (const h of heroes) {
    try {
      const d = await fetchCached(api(`/heroes/${h.key}`), { offline, ttlHours: 24 * 7 });
      kits[h.key] = {
        hp: d.hitpoints, subrole: d.subrole ?? h.subrole,
        abilities: (d.abilities || []).map((a) => ({ name: a.name, desc: a.description, icon: a.icon })),
        perks: { minor: (d.perks?.minor || []).map((p) => ({ name: p.name, desc: p.description, icon: p.icon })), major: (d.perks?.major || []).map((p) => ({ name: p.name, desc: p.description, icon: p.icon })) },
      };
    } catch (e) { log(`  (no details for ${h.key}: ${e.message})`); }
  }

  log('▸ Maps');
  const allMaps = await fetchCached(api('/maps'), { offline, ttlHours: 24 * 7 });
  const maps = allMaps.filter((m) => m.uses?.includes('standard') && m.gamemodes?.some((g) => cfg.mapModes.includes(g)));

  // Counterwatch publishes matchup data we can't republish (their terms: personal, non-commercial use),
  // so we only link to their per-hero pages. Their sitemap gives the exact URL slug for each hero.
  const cwLinks = {};
  try {
    const xml = await fetchCached('https://www.counterwatch.gg/sitemap.xml', { as: 'html', offline, ttlHours: 24 * 7 });
    const slugs = [...xml.matchAll(/\/stats\/overwatch\/counters\/([a-z0-9-]+)<\/loc>/g)].map((m) => m[1]).filter((s) => !['6v6', 'stadium'].includes(s));
    const bySquash = Object.fromEntries(slugs.map((s) => [s.replace(/-/g, ''), s]));
    for (const h of heroes) { const s = bySquash[h.key.replace(/-/g, '')]; if (s) cwLinks[h.key] = s; }
    log(`▸ Counterwatch links for ${Object.keys(cwLinks).length}/${heroes.length} heroes`);
  } catch (e) { log(`  (Counterwatch sitemap unavailable: ${e.message})`); }

  log('▸ Hero stats per platform / region / rank');
  const stats = {}, mapStats = {};
  let calls = 0;
  for (const platform of Object.keys(cfg.platforms)) for (const region of Object.keys(cfg.regions)) {
    const key = `${platform}|${region}`;
    stats[key] = {};
    for (const div of ['all', ...cfg.divisions]) {
      const q = { platform, region, gamemode: cfg.gamemode };
      if (div !== 'all') q.competitive_division = div;
      try { stats[key][div] = pack(await fetchCached(api('/heroes/stats', q), { offline })); calls++; } catch (e) { log(`  ${key} ${div}: ${e.message}`); }
    }
    log(`  ${key}: ${Object.keys(stats[key]).length} rank brackets`);
  }
  log('▸ Hero stats per map');
  for (const platform of Object.keys(cfg.platforms)) for (const region of Object.keys(cfg.regions)) {
    const key = `${platform}|${region}`;
    mapStats[key] = {};
    for (const m of maps) {
      try { const p = pack(await fetchCached(api('/heroes/stats', { platform, region, gamemode: cfg.gamemode, map: m.key }), { offline })); calls++; if (Object.keys(p).length >= 10) mapStats[key][m.key] = p; } catch (e) { /* map not in this pool */ }
    }
    log(`  ${key}: ${Object.keys(mapStats[key]).length} maps with data`);
  }

  log('▸ Patch notes');
  const patches = await loadPatches({ heroes, offline });
  log(`  ${patches.length} balance patches since ${patches[0]?.id}`);

  // Daily snapshot so "since the patch" changes and a backtest become possible over time
  // (Blizzard only publishes the current numbers, not history).
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  if (!offline) {
    // Merge (don't overwrite): an archive backfill may already have put data in today's file.
    const f = path.join(SNAP_DIR, `${today}.json`);
    const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { stats: {} };
    for (const [k, byDiv] of Object.entries(stats)) prev.stats[k] = { ...(prev.stats[k] || {}), ...byDiv };
    fs.writeFileSync(f, JSON.stringify({ date: today, stats: prev.stats, source: 'live' }));
  }
  if (!offline && !process.argv.includes('--no-backfill')) {
    log('▸ Archive backfill (history for Patch impact)');
    await backfill({ fromDate: patches[0]?.id, log });
  }
  const snaps = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')));
  // Main patch of the latest batch (a big patch plus any hotfixes within a week).
  const newest = patches.at(-1);
  const latestPatch = newest && patches.filter((p) => new Date(newest.date) - new Date(p.date) <= 7 * 864e5).sort((a, b) => b.changes.length - a.changes.length)[0];
  const before = latestPatch && [...snaps].reverse().find((s) => s.date < latestPatch.id);
  const current = snaps.at(-1);
  let trend = null;
  if (before && current && current.date > latestPatch.id) {
    trend = { patch: latestPatch.id, from: before.date, to: current.date, deltas: {} };
    for (const [k, byDiv] of Object.entries(current.stats)) {
      const a = before.stats[k]?.all, b = byDiv.all; if (!a || !b) continue;
      trend.deltas[k] = Object.fromEntries(Object.keys(b).filter((h) => a[h]).map((h) => [h, [+(b[h][0] - a[h][0]).toFixed(2), +(b[h][1] - a[h][1]).toFixed(2)]]));
    }
  }

  // ---- Patch impact: measured before/after changes per patch, and a backtest of the buff/nerf reading ----
  const DAY = 864e5;
  const PREFER = [['pc|americas', 'all'], ['pc|europe', 'all'], ['pc|asia', 'all'], ['console|americas', 'all']];
  const measured = patches.map((p, i) => {
    const next = patches[i + 1];
    const before = [...snaps].reverse().find((s) => s.date < p.id && Date.parse(p.id) - Date.parse(s.date) <= 21 * DAY);
    const after = snaps.find((s) => Date.parse(s.date) >= Date.parse(p.id) + 3 * DAY && (!next || s.date < next.id));
    if (!before || !after) return { id: p.id, measured: false, before: before?.date ?? null };
    const both = [];
    for (const k of Object.keys(after.stats)) for (const d of Object.keys(after.stats[k])) if (before.stats[k]?.[d]) both.push([k, d]);
    const ctx = PREFER.find(([k, d]) => both.some((x) => x[0] === k && x[1] === d)) || both.find((x) => x[1] === 'all') || both[0];
    if (!ctx) return { id: p.id, measured: false, before: before.date };
    const [k, d] = ctx, B = before.stats[k][d], A = after.stats[k][d];
    const heroes = {};
    for (const [h, s] of Object.entries(p.summary)) if (B[h] && A[h]) heroes[h] = { s: s.score, wrB: B[h][0], wrA: A[h][0], d: +(A[h][0] - B[h][0]).toFixed(2) };
    return { id: p.id, measured: true, ctx: `${k}|${d}`, before: before.date, after: after.date, heroes };
  });
  const pts = measured.flatMap((m) => (m.measured ? Object.entries(m.heroes).filter(([, x]) => x.s !== 0).map(([h, x]) => ({ patch: m.id, hero: h, score: x.s, observed: x.d })) : []));
  let backtest = null;
  if (pts.length >= 12) {
    const num = pts.reduce((s, x) => s + x.score * x.observed, 0), den = pts.reduce((s, x) => s + x.score ** 2, 0);
    const k = num > 0 && den > 0 ? num / den : null;
    const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
    const mx = mean(pts.map((x) => x.score)), my = mean(pts.map((x) => x.observed));
    const r = pts.reduce((s, x) => s + (x.score - mx) * (x.observed - my), 0) / Math.sqrt(pts.reduce((s, x) => s + (x.score - mx) ** 2, 0) * pts.reduce((s, x) => s + (x.observed - my) ** 2, 0) || 1);
    backtest = { n: pts.length, k, r: +r.toFixed(3), signAccuracy: +(pts.filter((x) => Math.sign(x.score) === Math.sign(x.observed)).length / pts.length).toFixed(3),
      maeModel: k ? +mean(pts.map((x) => Math.abs(x.observed - k * x.score))).toFixed(3) : null, maeNaive: +mean(pts.map((x) => Math.abs(x.observed))).toFixed(3),
      points: pts.map((x) => ({ ...x, predicted: k ? +(k * x.score).toFixed(2) : null })) };
  }
  const impact = { measured, backtest, need: 12, have: pts.length };
  log(`▸ Patch impact: ${measured.filter((m) => m.measured).length}/${patches.length} patches measured, ${pts.length} hero changes${backtest ? `, backtest r=${backtest.r}` : ' (backtest needs 12)'}`);

  const slimChange = (c) => ({ t: c.target, a: c.ability, l: c.line.replace(/^[-•*]\s*[^:]+:\s*/, ''), d: c.direction, m: c.magnitude, c: c.confidence, r: c.reason });
  const out = {
    generated: new Date().toISOString(),
    heroes: heroes.map((h) => ({ key: h.key, name: h.name, role: h.role, subrole: h.subrole, img: h.portrait })),
    kits, maps: maps.map((m) => ({ key: m.key, name: m.name, mode: m.gamemodes.find((g) => cfg.mapModes.includes(g)), img: m.screenshot, location: m.location })),
    stats, mapStats,
    patches: patches.map((p) => ({ id: p.id, title: p.title, date: p.date, changes: p.changes.filter((c) => c.kind === 'hero').map(slimChange), summary: Object.fromEntries(Object.entries(p.summary).map(([k, s]) => [k, { v: s.verdict, s: s.score, b: s.buffs, n: s.nerfs, u: s.unknown }])), dev: p.dev })),
    trend, impact, snapshots: snaps.map((s) => s.date), cwLinks,
    config: { platforms: cfg.platforms, regions: cfg.regions, divisions: cfg.divisions, shrinkPick: cfg.shrinkPick, tiers: cfg.tiers.map((t) => ({ tier: t.tier, z: Number.isFinite(t.z) ? t.z : -99 })), gamemode: cfg.gamemode },
    calls,
  };
  fs.mkdirSync('dist-ow', { recursive: true });
  fs.writeFileSync('dist-ow/data.js', `window.OW = ${JSON.stringify(out)};\n`);

  // Personal-use Counterwatch matchups: kept in a SEPARATE file that src/pages.js never publishes.
  fs.rmSync('dist-ow/counters.js', { force: true });
  if (!process.argv.includes('--no-counters')) {
    try {
      const cw = offline ? loadPrivate() : await ensureCounters({ heroes, latestPatchDate: latestPatch?.date, log });
      if (cw) fs.writeFileSync('dist-ow/counters.js', `window.OWC = ${JSON.stringify(cw)};\n`);
      else log('  (no matchup data — run node overwatch/counters.js to add it to your local copy)');
    } catch (e) { log(`  (Counterwatch fetch failed: ${e.message}; local dashboard built without matchups)`); }
  }
  for (const f of fs.readdirSync('overwatch/dashboard')) fs.copyFileSync(path.join('overwatch/dashboard', f), path.join('dist-ow', f));
  fs.copyFileSync('dashboard/style.css', 'dist-ow/style.css'); // shared design system with the Deadlock site
  log(`\n✔ Wrote dist-ow/ — ${heroes.length} heroes, ${Object.keys(stats).length} platform/region combos, ${maps.length} maps, ${patches.length} patches, ${snaps.length} snapshot(s)`);
}

main().catch((e) => { console.error('✖', e.message); process.exit(1); });
