#!/usr/bin/env node
// Usage:
//   node src/build.js                       → analyse the latest balance patch
//   node src/build.js --patch notes.txt     → feed your own patch notes (e.g. a new patch, or a hypothetical)
//   node src/build.js --offline             → rebuild from cache only
//   node src/build.js --llm                 → also classify patch lines with Claude (needs ANTHROPIC_API_KEY)
// Output: dist/index.html (open in a browser) + dist/data.js
import fs from 'node:fs';
import path from 'node:path';
import cfg from '../config.js';
import { get, unix } from './api.js';
import { loadPatchTimeline, customPatch } from './patches.js';
import { backtest } from './impact.js';
import { scoreContext, expertShifts, pairLift, deriveTags, archetypeMatrix } from './score.js';
import { pp, shrink } from './stats.js';
import { createLlmClassifier } from './llmClassifier.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const offline = flag('offline');
const useLlm = flag('llm');
const log = (...m) => console.log(...m);
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const DAY = 864e5;

async function main() {
  log('▸ Loading heroes & items');
  const heroes = (await get('/v1/assets/heroes', { only_active: true }, { offline, ttlHours: 24 }))
    // Don't trust in_development: newly released heroes keep that flag while live. Heroes without
    // any match data are dropped later by the scorer.
    .filter((h) => h.player_selectable && !h.disabled);
  const items = (await get('/v1/assets/items', {}, { offline, ttlHours: 24 })).filter((i) => i.type === 'upgrade');
  const heroNames = heroes.map((h) => h.name), itemNames = items.map((i) => i.name);
  const heroIdByName = Object.fromEntries(heroes.map((h) => [h.name, h.id]));

  const overrides = readJson('data/patch-overrides.json', {});
  const claims = readJson('data/experts/claims.json', []);
  const theory = readJson('data/theory.json', {});

  log('▸ Building patch timeline');
  const rulesTimeline = await loadPatchTimeline({ heroNames, itemNames, overrides, offline });
  let classifier = null, timeline = rulesTimeline;
  if (useLlm) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) log('  note: ANTHROPIC_API_KEY is not set; the SDK will try other credential sources (e.g. an `ant auth login` profile)');
    log(`▸ LLM pass over patch lines (${cfg.llm.model}, mode=${cfg.llm.mode})`);
    classifier = createLlmClassifier({ log, client: globalThis.__dmaTestClient });
    timeline = await loadPatchTimeline({ heroNames, itemNames, overrides, offline, classifier });
    const s = classifier.stats;
    log(`  ${s.newLines} lines classified in ${s.requests} request(s), ${s.cachedLines} from cache, ${s.inputTokens + s.outputTokens} tokens${s.failures.length ? `, ${s.failures.length} failure(s)` : ''}`);
  }
  let current, prev, mode;
  if (opt('patch')) {
    const text = fs.readFileSync(opt('patch'), 'utf8');
    const date = opt('date') ? new Date(opt('date')) : new Date();
    current = await customPatch(text, { heroNames, itemNames, overrides, date, title: opt('title') || path.basename(opt('patch')), classifier });
    prev = [...timeline].reverse().find((p) => new Date(p.date) < date) || timeline.at(-1);
    mode = date > Date.now() - DAY ? 'forecast' : 'replay';
  } else {
    current = timeline.at(-1);
    prev = timeline.at(-2);
    mode = 'live';
  }
  const tCur = new Date(current.date), now = new Date();
  let preFrom = new Date(prev.date);
  const preTo = mode === 'forecast' ? now : tCur;
  let preNote = `${prev.title} → ${current.custom && mode === 'forecast' ? 'now' : current.title}`;
  if (preTo - preFrom < 3 * DAY) { preFrom = new Date(preTo - 7 * DAY); preNote += ' (window extended to 7 days; spans an earlier patch)'; }
  const postFrom = mode === 'forecast' ? null : tCur;
  log(`  current: ${current.title} (${current.date.slice(0, 16)}), mode=${mode}`);
  log(`  pre-patch window: ${preFrom.toISOString().slice(0, 16)} → ${preTo.toISOString().slice(0, 16)}`);

  log('▸ Fetching hero stats per situation');
  const byCtx = {}, rawCtx = {};
  const bansRows = await get('/v1/analytics/hero-ban-stats', { min_unix_timestamp: unix(preFrom), max_unix_timestamp: unix(preTo) }, { offline });
  const bans = Object.fromEntries(bansRows.map((b) => [b.hero_id, b.bans / b.matches]));

  log('▸ Backtesting the patch-impact model on past patches');
  const bt = await backtest(timeline, heroIdByName, { currentPatchId: current.id, offline, log });
  log(`  k = ${(bt.k * 100).toFixed(2)}pp per unit (${bt.fitted ? 'fitted' : 'fallback'}), n=${bt.n}, r=${bt.r}, sign accuracy=${bt.signAccuracy}`);
  // With the LLM on, also replay the rules-only parser so the Audit tab can show whether the LLM helps.
  const btRules = useLlm ? await backtest(rulesTimeline, heroIdByName, { currentPatchId: current.id, offline }) : null;
  if (btRules) log(`  rules-only for comparison: r=${btRules.r}, sign accuracy=${btRules.signAccuracy}, error ${btRules.maeModelPp}pp`);

  const experts = expertShifts(claims, heroNames, current.date);
  for (const [ctx, { params }] of Object.entries(cfg.contexts)) {
    const preRows = await get('/v1/analytics/hero-stats', { ...params, min_unix_timestamp: unix(preFrom), max_unix_timestamp: unix(preTo) }, { offline });
    const postRows = postFrom ? await get('/v1/analytics/hero-stats', { ...params, min_unix_timestamp: unix(postFrom) }, { offline, ttlHours: 1 }) : [];
    const pre = Object.fromEntries(preRows.map((r) => [r.hero_id, r]));
    const post = Object.fromEntries(postRows.map((r) => [r.hero_id, r]));
    rawCtx[ctx] = { preGames: preRows.reduce((s, r) => s + r.matches, 0) / 12, postGames: postRows.reduce((s, r) => s + r.matches, 0) / 12 };
    byCtx[ctx] = scoreContext({ heroes, pre, post, patchSummary: current.summary, k: bt.k, experts, bans: ctx === 'all' ? bans : null });
    log(`  ${ctx}: ${Math.round(rawCtx[ctx].preGames)} pre-patch matches, ${Math.round(rawCtx[ctx].postGames)} post-patch`);
  }

  log('▸ Matchups & synergies');
  const pairFrom = unix(preFrom);
  // Baseline strength over the SAME window the pair data covers (pre + post), so lift isn't
  // polluted by a hero's strength changing mid-window.
  const wrById = Object.fromEntries(byCtx.all.map((r) => [r.id, shrink(r.preW + r.postW, r.preN + r.postN, cfg.shrinkGames)]));
  const countersAll = await get('/v1/analytics/hero-counter-stats', { min_unix_timestamp: pairFrom, same_lane_filter: false, min_matches: 150 }, { offline });
  const countersLane = await get('/v1/analytics/hero-counter-stats', { min_unix_timestamp: pairFrom, same_lane_filter: true, min_matches: 100 }, { offline });
  const synergy = await get('/v1/analytics/hero-synergy-stats', { min_unix_timestamp: pairFrom, same_lane_filter: false, min_matches: 150 }, { offline });
  const counters = pairLift(countersAll, wrById, { a: 'hero_id', b: 'enemy_hero_id' });
  const lane = pairLift(countersLane, wrById, { a: 'hero_id', b: 'enemy_hero_id' });
  const syn = pairLift(synergy, wrById, { a: 'hero_id1', b: 'hero_id2', synergy: true });

  const tags = deriveTags(heroes, byCtx, theory);
  const archetypes = archetypeMatrix(counters, tags);

  // Audit: places where sources disagree.
  const disagreements = [];
  for (const r of byCtx.all) {
    if (r.patch && r.postN > 2000) {
      const observed = r.postWR - r.preWR;
      if (Math.sign(observed) !== Math.sign(r.patchDelta) && Math.abs(observed) > 0.01)
        disagreements.push({ hero: r.name, type: 'patch prediction vs early data', detail: `predicted ${pp(r.patchDelta)}pp, observed ${pp(observed)}pp over ${r.postN} games` });
    }
    const e = experts[r.name];
    if (e && Math.sign(e.avgRating) !== Math.sign(r.preWR - 0.5) && Math.abs(r.preWR - 0.5) > 0.015)
      disagreements.push({ hero: r.name, type: 'experts vs data', detail: `experts avg ${e.avgRating}, data ${pp(r.preWR - 0.5)}pp vs 50%` });
  }
  const flagged = current.changes.filter((c) => c.direction === null);

  const out = {
    generated: now.toISOString(), mode, preNote,
    patch: { ...current, flagged },
    timeline: timeline.map((p) => ({ id: p.id, title: p.title, date: p.date, link: p.link, summary: Object.values(p.summary).filter((s) => s.kind === 'hero').map((s) => ({ t: s.target, s: s.score, v: s.verdict })) })),
    contexts: Object.fromEntries(Object.entries(cfg.contexts).map(([k, v]) => [k, { label: v.label, ...rawCtx[k] }])),
    heroes: heroes.map((h) => ({ id: h.id, name: h.name, type: h.hero_type, img: h.images?.icon_image_small_webp || h.images?.icon_image_small, complexity: h.complexity })),
    tiers: byCtx, tags, counters, lane, synergy: syn, archetypes,
    experts: Object.fromEntries(Object.entries(experts).map(([k, v]) => [k, { ...v, shift: pp(v.shift) }])),
    backtest: bt,
    backtestRules: btRules && { r: btRules.r, signAccuracy: btRules.signAccuracy, maeModelPp: btRules.maeModelPp, maeNaivePp: btRules.maeNaivePp, n: btRules.n, k: btRules.k },
    llm: useLlm ? {
      model: cfg.llm.model, mode: cfg.llm.mode, stats: classifier.stats,
      used: current.changes.filter((c) => c.source === 'llm').length,
      disagreements: current.changes.filter((c) => c.disagree).map((c) => ({ id: c.id, target: c.target, line: c.line, rules: c.rules, llm: c.llm })),
    } : null,
    disagreements, config: cfg,
  };
  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync('dist/data.js', `window.META = ${JSON.stringify(out)};\n`);
  for (const f of fs.readdirSync('dashboard')) fs.copyFileSync(path.join('dashboard', f), path.join('dist', f));
  log(`\n✔ Wrote dist/index.html — ${byCtx.all.length} heroes, ${counters.length} matchups, ${syn.length} synergy pairs, ${flagged.length} patch lines flagged for review`);
}

main().catch((e) => { console.error('✖', e.message); process.exit(1); });
