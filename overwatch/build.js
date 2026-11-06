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
  if (!offline) fs.writeFileSync(path.join(SNAP_DIR, `${today}.json`), JSON.stringify({ date: today, stats }));
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

  const slimChange = (c) => ({ t: c.target, a: c.ability, l: c.line.replace(/^[-•*]\s*[^:]+:\s*/, ''), d: c.direction, m: c.magnitude, c: c.confidence, r: c.reason });
  const out = {
    generated: new Date().toISOString(),
    heroes: heroes.map((h) => ({ key: h.key, name: h.name, role: h.role, subrole: h.subrole, img: h.portrait })),
    kits, maps: maps.map((m) => ({ key: m.key, name: m.name, mode: m.gamemodes.find((g) => cfg.mapModes.includes(g)), img: m.screenshot, location: m.location })),
    stats, mapStats,
    patches: patches.map((p) => ({ id: p.id, title: p.title, date: p.date, changes: p.changes.filter((c) => c.kind === 'hero').map(slimChange), summary: Object.fromEntries(Object.entries(p.summary).map(([k, s]) => [k, { v: s.verdict, s: s.score, b: s.buffs, n: s.nerfs, u: s.unknown }])), dev: p.dev })),
    trend, snapshots: snaps.map((s) => s.date),
    config: { platforms: cfg.platforms, regions: cfg.regions, divisions: cfg.divisions, shrinkPick: cfg.shrinkPick, tiers: cfg.tiers.map((t) => ({ tier: t.tier, z: Number.isFinite(t.z) ? t.z : -99 })), gamemode: cfg.gamemode },
    calls,
  };
  fs.mkdirSync('dist-ow', { recursive: true });
  fs.writeFileSync('dist-ow/data.js', `window.OW = ${JSON.stringify(out)};\n`);
  for (const f of fs.readdirSync('overwatch/dashboard')) fs.copyFileSync(path.join('overwatch/dashboard', f), path.join('dist-ow', f));
  fs.copyFileSync('dashboard/style.css', 'dist-ow/style.css'); // shared design system with the Deadlock site
  log(`\n✔ Wrote dist-ow/ — ${heroes.length} heroes, ${Object.keys(stats).length} platform/region combos, ${maps.length} maps, ${patches.length} patches, ${snaps.length} snapshot(s)`);
}

main().catch((e) => { console.error('✖', e.message); process.exit(1); });
