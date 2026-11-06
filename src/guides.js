// Expert item-counter guide (data/guides/deadlock-item-counters.json), resolved against the live item
// catalogue and checked against real matches: for every recommended item we compare its win rate in
// games against that enemy with its usual win rate.
import fs from 'node:fs';
import { get, unix } from './api.js';
import { shrink } from './stats.js';

const GUIDE = 'data/guides/deadlock-item-counters.json';
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

export async function buildGuide({ heroes, itemById, from, offline, log }) {
  if (!fs.existsSync(GUIDE)) return null;
  const g = JSON.parse(fs.readFileSync(GUIDE, 'utf8'));
  const heroByName = Object.fromEntries(heroes.map((h) => [norm(h.name), h]));
  const itemByName = {};
  for (const it of Object.values(itemById)) if (it.type === 'upgrade' && it.shopable) itemByName[norm(it.name)] = it;

  // Resolve names → ids; generic entries (anti-heal, Parry, …) stay as text.
  const unknown = new Set();
  const out = {};
  for (const [name, entries] of Object.entries(g.heroes)) {
    const h = heroByName[norm(name)];
    if (!h) { log(`  guide: unknown hero "${name}"`); continue; }
    out[h.id] = entries.map((e) => ({
      ...e,
      items: e.items.map((n) => {
        const it = itemByName[norm(n)];
        if (it) return { id: it.id, name: it.name };
        const gen = g.generic?.[n];
        if (!gen) unknown.add(n);
        return { generic: n, name: gen?.label || n, note: gen?.note || null, examples: (gen?.examples || []).map((x) => itemByName[norm(x)]).filter(Boolean).map((x) => ({ id: x.id, name: x.name })) };
      }),
    }));
  }
  if (unknown.size) log(`  guide: unresolved names kept as text: ${[...unknown].join(', ')}`);

  // Data check: item win rate in games vs this enemy, relative to (a) the item's usual win rate and
  // (b) how every item does vs this enemy (removes "this enemy is weak/strong overall").
  const base = Object.fromEntries((await get('/v1/analytics/item-stats', { min_unix_timestamp: unix(from), min_matches: 200 }, { offline })).map((r) => [r.item_id, r]));
  const checks = {};
  for (const hid of Object.keys(out)) {
    const ids = new Set(out[hid].flatMap((e) => e.items.flatMap((x) => (x.id ? [x.id] : x.examples?.map((y) => y.id) || []))));
    let rows;
    try { rows = await get('/v1/analytics/item-stats', { min_unix_timestamp: unix(from), min_matches: 100, enemy_hero_ids: hid }, { offline }); } catch (e) { log(`  guide check for ${hid} failed: ${e.message}`); continue; }
    let sw = 0, sd = 0; // games-weighted average shift across all items vs this enemy
    for (const r of rows) { const b = base[r.item_id]; if (!b) continue; sd += (r.wins / r.matches - b.wins / b.matches) * r.matches; sw += r.matches; }
    const shift = sw ? sd / sw : 0;
    checks[hid] = {};
    for (const r of rows) {
      if (!ids.has(r.item_id) || !base[r.item_id]) continue;
      const b = base[r.item_id], wb = b.wins / b.matches;
      const lift = shrink(r.wins, r.matches, 800, wb + shift) - (wb + shift);
      checks[hid][r.item_id] = { lift: +lift.toFixed(4), n: r.matches, wr: +(r.wins / r.matches).toFixed(4), usual: +wb.toFixed(4) };
    }
  }
  return { source: g.source, principles: g.principles, heroes: out, checks };
}
