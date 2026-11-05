// The scoring engine. For every hero and situation:
//   prior     = pre-patch win rate + predicted patch effect + expert shift
//   evidence  = post-patch games
//   posterior = beta-binomial blend of the two, with every contribution recorded.
import cfg from '../config.js';
import { shrink, logit, sigmoid, betaCI, mean, sd, clamp, pp } from './stats.js';

export function expertShifts(claims, heroNames, patchDate) {
  // claims: [{ source, date, hero, rating (-2..+2), context?, weight?, note?, url? }]
  const now = Date.now(), byHero = {};
  for (const c of claims) {
    if (!heroNames.includes(c.hero) || typeof c.rating !== 'number') continue;
    const ageDays = (now - new Date(c.date)) / 864e5;
    let w = (c.weight ?? 1) * 0.5 ** (ageDays / cfg.expert.halfLifeDays);
    if (new Date(c.date) < new Date(patchDate)) w *= 0.5; // said before this patch: half weight
    (byHero[c.hero] ??= []).push({ ...c, effectiveWeight: +w.toFixed(3) });
  }
  const out = {};
  for (const [hero, cs] of Object.entries(byHero)) {
    const W = cs.reduce((s, c) => s + c.effectiveWeight, 0);
    const avg = cs.reduce((s, c) => s + c.rating * c.effectiveWeight, 0) / W;
    const confidence = W / (W + 1); // more independent weight → trust the average more
    const shift = clamp(avg * cfg.expert.ppPerPoint * confidence, -cfg.expert.maxShiftPp, cfg.expert.maxShiftPp) / 100;
    out[hero] = { shift, avgRating: +avg.toFixed(2), claims: cs };
  }
  return out;
}

export function scoreContext({ heroes, pre, post, patchSummary, k, experts, bans }) {
  const totalPreMatches = Object.values(pre).reduce((s, r) => s + r.matches, 0) / 12;
  const totalPostMatches = Object.values(post).reduce((s, r) => s + r.matches, 0) / 12;
  const rows = [];
  for (const h of heroes) {
    const a = pre[h.id], b = post[h.id];
    if (!a && !b) continue;
    const preW = a?.wins ?? 0, preN = a?.matches ?? 0, postW = b?.wins ?? 0, postN = b?.matches ?? 0;
    const basePre = shrink(preW, preN, cfg.shrinkGames);
    const ps = patchSummary[h.name];
    const changed = !!ps && ps.kind === 'hero' && (ps.buffs + ps.nerfs + ps.unknown) > 0;
    const patchDelta = changed ? k * ps.score : 0;
    const exp = experts[h.name];
    const expertDelta = exp?.shift ?? 0;
    const priorMean = clamp(basePre + patchDelta + expertDelta, 0.3, 0.7);
    // Reworks/unclassified lines widen the prior further: we know less.
    let priorN = Math.min(preN, changed ? cfg.priorGames.changed : cfg.priorGames.unchanged);
    if (changed && ps.unknown) priorN *= 1 / (1 + 0.25 * ps.unknown);
    priorN = Math.max(priorN, 200);
    const alpha = priorMean * priorN + postW, beta = (1 - priorMean) * priorN + (postN - postW);
    const posterior = alpha / (alpha + beta);
    const [lo, hi] = betaCI(alpha, beta);
    const wPost = postN / (postN + priorN);
    rows.push({
      id: h.id, name: h.name,
      posterior, ci: [lo, hi],
      preW, postW, preWR: basePre, preN, postWR: postN ? postW / postN : null, postN,
      patchDelta, expertDelta, priorMean, priorN: Math.round(priorN), wPost,
      pickRate: preN / Math.max(totalPreMatches, 1), postPickRate: postN / Math.max(totalPostMatches, 1),
      banRate: bans?.[h.id] ?? null,
      patch: changed ? { verdict: ps.verdict, score: ps.score, buffs: ps.buffs, nerfs: ps.nerfs, unknown: ps.unknown } : null,
      // Evidence breakdown in percentage points of the final number (sums to posterior − 50%).
      evidence: {
        prePatchPp: pp((basePre - 0.5) * (1 - wPost)),
        patchPredPp: pp(patchDelta * (1 - wPost)),
        expertPp: pp(expertDelta * (1 - wPost)),
        postPatchPp: postN ? pp((postW / postN - 0.5) * wPost) : 0,
      },
      perMatch: a ? {
        kills: a.total_kills / a.matches, deaths: a.total_deaths / a.matches, assists: a.total_assists / a.matches,
        damage: a.total_player_damage / a.matches, objDamage: a.total_boss_damage / a.matches,
        netWorth: a.total_net_worth / a.matches, damageTaken: a.total_player_damage_taken / a.matches,
        lastHits: a.total_last_hits / a.matches,
        accuracy: a.total_shots_hit / Math.max(a.total_shots_hit + a.total_shots_missed, 1),
      } : null,
    });
  }
  // Tier by z-score, but only heroes with enough games define the distribution.
  const ref = rows.filter((r) => r.preN + r.postN > 1000).map((r) => r.posterior);
  const m = mean(ref), s = sd(ref);
  for (const r of rows) {
    r.z = (r.posterior - m) / s;
    r.tier = cfg.tiers.find((t) => r.z >= t.z).tier;
    // Plausible tier range from the CI — honest about thin samples.
    r.tierRange = [cfg.tiers.find((t) => (r.ci[1] - m) / s >= t.z).tier, cfg.tiers.find((t) => (r.ci[0] - m) / s >= t.z).tier];
  }
  rows.sort((x, y) => y.posterior - x.posterior);
  return rows;
}

// Matchup / synergy lift: how much better than expected, given both heroes' overall strength.
export function pairLift(rows, wrById, { a, b, synergy }) {
  const out = [];
  for (const r of rows) {
    const ha = r[a], hb = r[b];
    const pa = wrById[ha], pb = wrById[hb];
    if (pa == null || pb == null || !r.matches_played) continue;
    // Expected log-odds: counters → strength difference; synergy → combined strength.
    const expected = synergy ? sigmoid(logit(pa) + logit(pb)) : sigmoid(logit(pa) - logit(pb));
    const obs = shrink(r.wins, r.matches_played, cfg.pairShrinkGames, expected);
    out.push({ a: ha, b: hb, n: r.matches_played, wr: r.wins / r.matches_played, expected, lift: obs - expected });
  }
  return out;
}

// Data-derived "theory" tags: archetypes from what heroes actually do, and situational lean.
export function deriveTags(heroes, byCtx, extraTheory = {}) {
  const all = byCtx.all, find = (ctx, id) => byCtx[ctx]?.find((r) => r.id === id);
  const metric = (f) => { const xs = all.filter((r) => r.perMatch).map((r) => f(r.perMatch)).sort((x, y) => x - y); return (q) => xs[Math.floor(q * (xs.length - 1))]; };
  const q = {
    netWorth: metric((p) => p.netWorth), damageTaken: metric((p) => p.damageTaken), assists: metric((p) => p.assists),
    objDamage: metric((p) => p.objDamage), damage: metric((p) => p.damage), deaths: metric((p) => p.deaths),
  };
  const banTop = [...all].filter((r) => r.banRate != null).sort((x, y) => y.banRate - x.banRate).slice(0, 5).map((r) => r.id);
  const tags = {};
  for (const h of heroes) {
    const r = all.find((x) => x.id === h.id); if (!r) continue;
    const t = [];
    const add = (tag, group, why) => t.push({ tag, group, why });
    if (h.hero_type) add(h.hero_type[0].toUpperCase() + h.hero_type.slice(1), 'role', 'Valve hero type');
    const p = r.perMatch;
    if (p) {
      if (p.netWorth >= q.netWorth(0.75)) add('Carry', 'archetype', 'top-quartile net worth');
      if (p.damageTaken >= q.damageTaken(0.75)) add('Frontline', 'archetype', 'top-quartile damage taken');
      if (p.assists >= q.assists(0.75)) add('Playmaker', 'archetype', 'top-quartile assists');
      if (p.objDamage >= q.objDamage(0.75)) add('Objective / push', 'archetype', 'top-quartile objective damage');
      if (p.damage >= q.damage(0.75)) add('Damage dealer', 'archetype', 'top-quartile hero damage');
      if (p.deaths <= q.deaths(0.25)) add('Safe', 'archetype', 'bottom-quartile deaths');
    }
    const s = find('short', h.id), l = find('long', h.id), hi = find('high', h.id), lo = find('low', h.id);
    if (s && l) {
      const d = s.posterior - l.posterior;
      if (d >= 0.02) add('Early-game', 'situational', `+${pp(d)}pp in short vs long games`);
      if (d <= -0.02) add('Late scaler', 'situational', `+${pp(-d)}pp in long vs short games`);
    }
    if (hi && lo) {
      const d = hi.posterior - lo.posterior;
      if (d >= 0.02) add('Skill-rewarding', 'situational', `+${pp(d)}pp at Oracle+ vs low ranks`);
      if (d <= -0.02) add('Low-rank stomper', 'situational', `+${pp(-d)}pp at low ranks vs Oracle+`);
    }
    if (banTop.includes(h.id)) add('Ban magnet', 'draft', 'top-5 ban rate');
    for (const tg of h.tags || []) add(tg, 'kit', 'Valve kit tag');
    for (const [arch, names] of Object.entries(extraTheory.archetypes || {})) if (names.includes(h.name)) add(arch, 'archetype', 'theory.json (manual)');
    tags[h.id] = t;
  }
  return tags;
}

// Aggregate matchup lift by archetype → "macro" view: which archetypes beat which.
export function archetypeMatrix(counters, tags) {
  const arch = (id) => (tags[id] || []).filter((t) => t.group === 'archetype' || t.group === 'role').map((t) => t.tag);
  const acc = {};
  for (const c of counters) for (const A of arch(c.a)) for (const B of arch(c.b)) {
    const k = `${A}|${B}`; const e = (acc[k] ??= { a: A, b: B, sum: 0, w: 0 });
    e.sum += c.lift * c.n; e.w += c.n;
  }
  return Object.values(acc).filter((e) => e.w > 5000).map((e) => ({ a: e.a, b: e.b, lift: e.sum / e.w, n: e.w }));
}
