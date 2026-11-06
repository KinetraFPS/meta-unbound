// Overwatch meta auditor settings. Data: OverFast API (community), which mirrors Blizzard's
// official Hero Statistics page. Patch notes: Blizzard's official patch-notes pages.
export default {
  api: 'https://overfast-api.tekrop.fr',
  blizzard: 'https://overwatch.blizzard.com/en-us/news/patch-notes',
  cacheDir: 'data/cache/overwatch',
  cacheTtlHours: 6,
  requestDelayMs: 600,         // OverFast is a free community service: keep it gentle

  gamemode: 'competitive',
  platforms: { pc: 'PC', console: 'Console' },
  regions: { americas: 'Americas', europe: 'Europe', asia: 'Asia' },
  divisions: ['bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster'],
  mapModes: ['control', 'escort', 'hybrid', 'push', 'flashpoint', 'clash'], // competitive map types

  // Blizzard doesn't publish game counts, so pick rate stands in for sample size:
  // win rate is pulled toward 50% as if `shrinkPick` percentage points of pick rate were at 50%.
  shrinkPick: 1.0,
  patchMonths: 4,              // how many months of patch notes to parse
  tiers: [{ tier: 'S', z: 1.25 }, { tier: 'A', z: 0.5 }, { tier: 'B', z: -0.5 }, { tier: 'C', z: -1.25 }, { tier: 'D', z: -Infinity }],
};
