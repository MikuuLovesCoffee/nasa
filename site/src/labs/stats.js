// Trend statistics for a yearly series (nulls allowed): Theil–Sen + Mann–Kendall, and OLS + t-test + 95% CI.

const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

export function normCdf(x) { // Abramowitz–Stegun 7.1.26
  const s = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}

function lnGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const cj of c) ser += cj / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a, b, x) {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - (qab * x) / qap;
  d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d); let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d); c = 1 + aa / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d); c = 1 + aa / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}
function betai(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
/** two-sided p-value of Student's t with df degrees of freedom */
export const tTwoSided = (t, df) => betai(df / 2, 0.5, df / (df + t * t));
/** t such that the two-sided p equals alpha (bisection) */
function tCrit(df, alpha = 0.05) {
  let lo = 0, hi = 50;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (tTwoSided(mid, df) > alpha) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/**
 * vals: numbers or null, one per year (index = years since start).
 * Returns slope per year from both methods, p-values and the 95% CI of the OLS slope.
 */
export function trendStats(vals) {
  const pts = []; vals.forEach((v, i) => { if (v != null && isFinite(v)) pts.push([i, v]); });
  const n = pts.length;
  if (n < 8) return null;
  // Theil–Sen + Mann–Kendall (tie-corrected)
  const sl = []; let S = 0;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const d = pts[b][1] - pts[a][1]; sl.push(d / (pts[b][0] - pts[a][0])); S += Math.sign(d);
  }
  const counts = new Map(); pts.forEach(([, v]) => counts.set(v, (counts.get(v) || 0) + 1));
  let tie = 0; for (const t of counts.values()) tie += t * (t - 1) * (2 * t + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - tie) / 18;
  const z = varS > 0 ? (S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0) : 0;
  const mkP = varS > 0 ? 2 * (1 - normCdf(Math.abs(z))) : 1;
  const sen = median(sl);
  const senIntercept = median(pts.map(([x, y]) => y - sen * x));
  // OLS + t-test
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0; pts.forEach(([x, y]) => { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); });
  const b = sxy / sxx, a = my - b * mx;
  let sse = 0; pts.forEach(([x, y]) => { sse += (y - (a + b * x)) ** 2; });
  const df = n - 2, se = Math.sqrt(sse / df / sxx);
  const t = se > 0 ? b / se : 0, tP = se > 0 ? tTwoSided(Math.abs(t), df) : 1, tc = tCrit(df);
  return { n, sen, senIntercept, mkS: S, mkZ: z, mkP, ols: b, olsIntercept: a, olsP: tP, ci: [b - tc * se, b + tc * se], mean: my };
}
