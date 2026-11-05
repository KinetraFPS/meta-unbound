// Small statistics helpers. Everything is win-rate math on (wins, games).
export const logit = (p) => Math.log(p / (1 - p));
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Shrink a raw win rate toward `toward` with `k` pseudo-games (beta-binomial posterior mean).
export const shrink = (wins, games, k, toward = 0.5) => (wins + k * toward) / (games + k);

// 95% interval for a beta(a, b) via normal approximation (fine for a, b > ~20).
export function betaCI(a, b) {
  const m = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return [m - 1.96 * sd, m + 1.96 * sd];
}

export function mean(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0; }
export function sd(xs) { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 1e-9; }
export function pearson(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let n = 0, dx = 0, dy = 0;
  xs.forEach((x, i) => { n += (x - mx) * (ys[i] - my); dx += (x - mx) ** 2; dy += (ys[i] - my) ** 2; });
  return dx && dy ? n / Math.sqrt(dx * dy) : 0;
}
export const pp = (x) => +(x * 100).toFixed(2); // proportion → percentage points
