// Meta builds per hero: items (core / hidden gems / traps, in buy order) and ability upgrade order.
//
// Raw item win rate is misleading: teams that are already winning have more souls, so they buy
// more (and pricier) items. We therefore judge each item against the hero's other items OF THE SAME
// COST TIER ("tier-relative lift"), and shrink small samples toward zero.
import cfg from '../config.js';
import { get, unix } from './api.js';
import { shrink } from './stats.js';

const B = {
  minItemGames: 150,     // ignore items with fewer hero-games than this
  liftShrink: 300,       // pseudo-games shrinking lift toward 0
  core: { 1: 0.25, 2: 0.2, 3: 0.12, 4: 0.08, 5: 0.03 }, // pick rate needed to count as core, by tier
  gemMinPick: 0.02, gemMinLift: 0.015,
  trapMinPick: 0.08, trapMaxLift: -0.015,
  coreMinLift: -0.01,
};
export const buildConfig = B;

const PHASES = [
  { key: 'early', label: 'Early game', tiers: [1, 2] },
  { key: 'mid', label: 'Mid game', tiers: [3] },
  { key: 'late', label: 'Late game', tiers: [4, 5] },
];

function itemModel(rows, heroGames, heroWR, items) {
  const enriched = rows
    .map((r) => ({ r, it: items[r.item_id] }))
    .filter(({ r, it }) => it && it.type === 'upgrade' && it.shopable && r.matches >= B.minItemGames)
    .map(({ r, it }) => {
      const wr = shrink(r.wins, r.matches, B.liftShrink, heroWR);
      return { id: r.item_id, tier: it.item_tier, n: r.matches, pick: r.matches / heroGames, wr: r.wins / r.matches, rawLift: wr - heroWR, buyS: Math.round(r.avg_buy_time_s), sold: r.sold / r.matches };
    });
  // Tier baseline = pick-weighted mean lift of that tier's items for this hero.
  const base = {};
  for (const t of [1, 2, 3, 4, 5]) {
    const xs = enriched.filter((x) => x.tier === t);
    const w = xs.reduce((s, x) => s + x.n, 0);
    base[t] = w ? xs.reduce((s, x) => s + x.rawLift * x.n, 0) / w : 0;
  }
  for (const x of enriched) {
    x.lift = +(x.rawLift - base[x.tier]).toFixed(4);
    const corePick = B.core[x.tier] ?? 0.1;
    x.role = x.pick >= corePick && x.lift >= B.coreMinLift ? 'core'
      : x.pick >= B.trapMinPick && x.lift <= B.trapMaxLift ? 'trap'
      : x.pick >= B.gemMinPick && x.lift >= B.gemMinLift ? 'gem'
      : 'other';
    delete x.rawLift;
    x.pick = +x.pick.toFixed(4); x.wr = +x.wr.toFixed(4); x.sold = +x.sold.toFixed(3);
  }
  enriched.sort((a, b) => a.buyS - b.buyS);
  // Core per phase: the most-bought qualifying items (max 7), shown in average buy order.
  const pickCore = (p) => enriched.filter((x) => p.tiers.includes(x.tier) && x.role === 'core')
    .sort((a, b) => b.pick - a.pick).slice(0, 7).sort((a, b) => a.buyS - b.buyS);
  const phases = PHASES.map((p) => ({
    ...p,
    core: pickCore(p),
    gems: enriched.filter((x) => p.tiers.includes(x.tier) && x.role === 'gem').sort((a, b) => b.lift - a.lift).slice(0, 6),
    traps: enriched.filter((x) => p.tiers.includes(x.tier) && x.role === 'trap').sort((a, b) => a.lift - b.lift).slice(0, 4),
  }));
  // Phases reference items by id; the full list keeps anything bought in ≥2% of games.
  const slim = (x) => x.id;
  return {
    items: enriched.filter((x) => x.pick >= 0.02 || x.role !== 'other'),
    phases: phases.map((p) => ({ key: p.key, label: p.label, core: p.core.map(slim), gems: p.gems.map(slim), traps: p.traps.map(slim) })),
  };
}

function abilityModel(rows) {
  if (!rows?.length) return null;
  // Only games long enough to finish an upgrade path are listed, and those skew toward wins,
  // so compare orders with each other (games-weighted mean of the listed orders), not with the hero.
  const tot = rows.reduce((s, r) => s + r.matches, 0);
  const heroWR = rows.reduce((s, r) => s + r.wins, 0) / tot;
  const sorted = [...rows].sort((a, b) => b.matches - a.matches);
  const top = sorted[0];
  const minN = Math.max(300, top.matches * 0.1);
  const pack = (r) => r && ({ order: r.abilities, times: (r.avg_upgrade_times_s || []).map(Math.round), n: r.matches, wr: r.wins / r.matches, lift: shrink(r.wins, r.matches, B.liftShrink, heroWR) - heroWR });
  const best = sorted.filter((r) => r.matches >= minN).sort((a, b) => shrink(b.wins, b.matches, B.liftShrink, heroWR) - shrink(a.wins, a.matches, B.liftShrink, heroWR))[0];
  const total = rows.reduce((s, r) => s + r.matches, 0);
  return { popular: { ...pack(top), share: top.matches / total }, best: best && best !== top ? { ...pack(best), share: best.matches / total } : null };
}

export async function collectBuilds({ heroes, items, from, offline, log }) {
  const ctxs = { all: {}, high: cfg.contexts.high.params };
  const out = {};
  // Hero totals for the same window → item pick rates.
  const totals = {};
  for (const [k, params] of Object.entries(ctxs)) {
    const rows = await get('/v1/analytics/hero-stats', { ...params, min_unix_timestamp: unix(from) }, { offline });
    totals[k] = Object.fromEntries(rows.map((r) => [r.hero_id, r]));
  }
  let i = 0;
  for (const h of heroes) {
    if (!totals.all[h.id]) continue;
    if (++i % 10 === 0) log(`  builds: ${i}/${heroes.length} heroes`);
    out[h.id] = {};
    for (const [k, params] of Object.entries(ctxs)) {
      const t = totals[k][h.id];
      if (!t || t.matches < 1000) continue;
      const heroWR = t.wins / t.matches;
      const rows = await get('/v1/analytics/item-stats', { ...params, hero_id: h.id, min_unix_timestamp: unix(from), min_matches: B.minItemGames }, { offline });
      const ab = await get('/v1/analytics/ability-order-stats', { ...params, hero_id: h.id, min_unix_timestamp: unix(from), min_matches: 100 }, { offline }).catch(() => []);
      out[h.id][k] = { games: t.matches, wr: heroWR, ...itemModel(rows, t.matches, heroWR, items), abilities: abilityModel(ab) };
    }
  }
  return out;
}

// Slim item/ability dictionary for the dashboard (only what's referenced).
export function itemDictionary(builds, items) {
  const ids = new Set();
  for (const hb of Object.values(builds)) for (const b of Object.values(hb)) {
    b.items.forEach((x) => ids.add(x.id));
    for (const o of [b.abilities?.popular, b.abilities?.best]) o?.order.forEach((id) => ids.add(id));
  }
  const out = {};
  for (const id of ids) {
    const it = items[id]; if (!it) continue;
    out[id] = { name: it.name, cost: it.cost ?? null, slot: it.item_slot_type ?? null, tier: it.item_tier ?? null, img: it.shop_image_webp || it.image_webp || it.image || null, active: !!it.is_active_item, type: it.type, abilityType: it.ability_type ?? null };
  }
  return out;
}
