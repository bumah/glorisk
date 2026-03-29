/**
 * GloRisk — Risk Calculation Engine (Shared: build + frontend)
 * ─────────────────────────────────────────────────────────────────────────────
 * Two indicator categories:
 *
 * A) STORED RAW + RE-SCORED  (volatility, volSpike, vsPeak, cagr3Y)
 *    Need 3-year data beyond the 252-day price window.
 *    Raw value is pre-computed; THRESHOLDS are applied to score it.
 *
 * B) FULLY RECALCULATED  (shortTrend, longTrend, maCross, momentum,
 *    return1M, return1Y, range52W)
 *    Derived from priceHistory + ma50History + ma200History.
 */

'use strict';

/* ── Scoring thresholds ──────────────────────────────────────────────────── */

export const THRESHOLDS = {
  volatility: {
    greenBelow: 30,
    amberBelow: 60,
  },
  volSpike: {
    greenBelow: 1.0,
    amberBelow: 2.0,
  },
  vsPeak: {
    greenBelow: 20,
    amberBelow: 30,
  },
  shortTrend: {
    greenAbove: 0,
    amberAbove: -6,
  },
  longTrend: {
    greenAbove: 0,
    amberAbove: -10,
  },
  maCross: {
    goldenCrossAt: 1.0,
  },
  momentum: {
    greenAbove: 0,
    amberAbove: -5,
  },
  return1M: {
    greenAbove: 0,
    amberAbove: -10,
  },
  return1Y: {
    greenAbove: 0,
    amberAbove: -20,
  },
  range52W: {
    greenAbove: 45,
    amberAbove: 25,
  },
  cagr3Y: {
    greenAbove: 0,
  },
};

/* ── Mood bands — percentage-based thresholds ────────────────────────────── */

export const MOOD_BANDS = [
  { pctLo:  0, pctHi: 10, label: 'Very Healthy', displayLabel: 'Very Stable', key: 'vcalm',    color: '#60A5FA', cls: 'mood-very-healthy' },
  { pctLo: 10, pctHi: 20, label: 'Healthy',      displayLabel: 'Stable',      key: 'calm',     color: '#22c55e', cls: 'mood-healthy'      },
  { pctLo: 20, pctHi: 50, label: 'Unsettled',    displayLabel: 'Unstable',    key: 'unsettled',color: '#f59e0b', cls: 'mood-unsettled'    },
  { pctLo: 50, pctHi: 70, label: 'Stressed',     displayLabel: 'Stressed',    key: 'stressed', color: '#f97316', cls: 'mood-stressed'     },
  { pctLo: 70, pctHi:101, label: 'Critical',     displayLabel: 'Critical',    key: 'danger',   color: '#ef4444', cls: 'mood-critical'     },
];

export const MAX_SCORE = 20; // 10 indicators × 2 pts max

/* ── Indicator metadata ──────────────────────────────────────────────────── */

export const IND_META = {
  volatility:  { label: 'Price Swings',      desc: 'How wildly the price moves day-to-day, expressed as an annualised figure. Higher volatility means larger and more unpredictable price moves.' },
  volSpike:    { label: 'Unusual Activity',   desc: 'Recent volatility compared to the longer-term average. A rising ratio means volatility is accelerating — something is changing.' },
  vsPeak:      { label: 'vs 3Y Peak',         desc: 'How far the price is from its 3-year high. Large drawdowns signal sustained weakness.' },
  shortTrend:  { label: 'Short-Term Trend',   desc: 'Price vs 50-day moving average. Positive = trading above short-term trend (bullish).' },
  longTrend:   { label: 'Long-Term Trend',    desc: 'Price vs 200-day moving average. Positive = sustained long-term uptrend intact.' },
  maCross:     { label: 'MA Cross',           desc: 'Golden Cross (bullish) when the 50D MA is above the 200D MA. Death Cross signals a downtrend.' },
  momentum:    { label: 'Momentum',           desc: '10-day return minus 30-day return. Positive = price is accelerating upward.' },
  return1M:    { label: '1M Return',          desc: 'Total price return over the past 30 days.' },
  return1Y:    { label: '1Y Return',          desc: 'Total price return over the past 12 months of available data.' },
  range52W:    { label: '52-Week Range',      desc: 'Where the price sits within its 52-week high/low band. Near the bottom = bearish.' },
  cagr3Y:      { label: '3Y CAGR',            desc: 'Compound annual growth rate over 3 years. Any negative CAGR = long-term value destruction.' },
};

export const IND_ORDER = [
  'volatility', 'volSpike', 'vsPeak',
  'shortTrend', 'longTrend', 'maCross',
  'return1M', 'return1Y',
  'range52W', 'cagr3Y',
];

/* ── Scoring helpers ─────────────────────────────────────────────────────── */

export function scoreHighBad(value, greenBelow, amberBelow) {
  if (value < greenBelow) return { color: 'green', pts: 0 };
  if (value < amberBelow) return { color: 'amber', pts: 1 };
  return { color: 'red', pts: 2 };
}

export function scoreLowBad(value, greenAbove, amberAbove) {
  if (value > greenAbove) return { color: 'green', pts: 0 };
  if (value > amberAbove) return { color: 'amber', pts: 1 };
  return { color: 'red', pts: 2 };
}

export function scoreLowBadInclusive(value, greenAbove, amberAbove) {
  if (value >= greenAbove) return { color: 'green', pts: 0 };
  if (value > amberAbove)  return { color: 'amber', pts: 1 };
  return { color: 'red', pts: 2 };
}

/* ── Formatters ──────────────────────────────────────────────────────────── */

function fmtPct(v, d = 1) { return (v >= 0 ? '+' : '') + v.toFixed(d) + '%'; }

/* ── Math helpers (used by build-time functions) ─────────────────────────── */

export function stddev(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / n;
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

export function sma(prices, period) {
  const result = new Array(prices.length).fill(null);
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += prices[j];
    result[i] = sum / period;
  }
  return result;
}

/* ── Build-time: compute Category A indicators from full price history ──── */

export function computeCategoryA(prices) {
  const n    = prices.length;
  const vals = prices.map(p => p.p);
  const last = vals[n - 1];

  // 1. Volatility — annualised stddev of log returns
  const logRet = [];
  for (let i = 1; i < n; i++) {
    if (vals[i] > 0 && vals[i - 1] > 0) {
      logRet.push(Math.log(vals[i] / vals[i - 1]));
    }
  }
  const annualVol = stddev(logRet) * Math.sqrt(252) * 100;

  // 2. Vol spike — recent 30D vol / full-period vol
  const recent30  = logRet.slice(-30);
  const recentVol = stddev(recent30) * Math.sqrt(252) * 100;
  const volSpike  = annualVol > 0 ? recentVol / annualVol : 1;

  // 3. vs 3Y Peak — drawdown from all-time high
  const peak   = Math.max(...vals);
  const vsPeak = (1 - last / peak) * 100;

  // 4. 3Y CAGR — compound annual growth rate
  const years  = (n - 1) / 252;
  const cagr3Y = years > 0 ? ((last / vals[0]) ** (1 / years) - 1) * 100 : 0;

  return {
    volatility: +annualVol.toFixed(4),
    volSpike:   +volSpike.toFixed(4),
    vsPeak:     +vsPeak.toFixed(4),
    cagr3Y:     +cagr3Y.toFixed(4),
  };
}

/* ── Build-time: compute all indicators from price arrays ────────────────── */

export function computeIndicatorsFromPrices(prices252, catA) {
  const n    = prices252.length;
  const vals = prices252.map(p => p.p);
  const last = vals[n - 1];

  // MA arrays
  const ma50arr  = sma(vals, 50);
  const ma200arr = sma(vals, 200);
  const ma50     = ma50arr[n - 1];
  const ma200    = ma200arr[n - 1];

  const inds = {};

  // Category A — stored pre-computed raw, re-scored
  inds.volatility = {
    raw: catA.volatility,
    label: catA.volatility.toFixed(1) + '%',
    ...scoreHighBad(catA.volatility, THRESHOLDS.volatility.greenBelow, THRESHOLDS.volatility.amberBelow),
  };

  inds.volSpike = {
    raw: catA.volSpike,
    label: catA.volSpike.toFixed(2) + '\u00d7',
    ...scoreHighBad(catA.volSpike, THRESHOLDS.volSpike.greenBelow, THRESHOLDS.volSpike.amberBelow),
  };

  inds.vsPeak = {
    raw: catA.vsPeak,
    label: '-' + catA.vsPeak.toFixed(1) + '%',
    ...scoreHighBad(catA.vsPeak, THRESHOLDS.vsPeak.greenBelow, THRESHOLDS.vsPeak.amberBelow),
  };

  const cagrColor = catA.cagr3Y > 0 ? 'green' : 'red';
  inds.cagr3Y = {
    raw: catA.cagr3Y,
    label: fmtPct(catA.cagr3Y),
    color: cagrColor,
    pts: cagrColor === 'green' ? 0 : 2,
  };

  // Category B — recalculated

  // shortTrend
  const stRaw = ma50 > 0 ? (last / ma50 - 1) * 100 : 0;
  inds.shortTrend = {
    raw: +stRaw.toFixed(4),
    label: fmtPct(stRaw),
    ...scoreLowBad(stRaw, THRESHOLDS.shortTrend.greenAbove, THRESHOLDS.shortTrend.amberAbove),
  };

  // longTrend
  const ltRaw = ma200 > 0 ? (last / ma200 - 1) * 100 : 0;
  inds.longTrend = {
    raw: +ltRaw.toFixed(4),
    label: fmtPct(ltRaw),
    ...scoreLowBad(ltRaw, THRESHOLDS.longTrend.greenAbove, THRESHOLDS.longTrend.amberAbove),
  };

  // maCross
  const crossRatio = (ma50 > 0 && ma200 > 0) ? ma50 / ma200 : 0;
  const isGolden   = crossRatio >= THRESHOLDS.maCross.goldenCrossAt;
  inds.maCross = {
    raw: +crossRatio.toFixed(4),
    label: isGolden ? 'Golden Cross' : 'Death Cross',
    color: isGolden ? 'green' : 'red',
    pts: isGolden ? 0 : 2,
  };

  // momentum (10D return - 30D return); inclusive zero = green
  const r10 = n > 11 ? (last / vals[n - 11] - 1) * 100 : 0;
  const r30 = n > 31 ? (last / vals[n - 31] - 1) * 100 : 0;
  const mom = r10 - r30;
  inds.momentum = {
    raw: +mom.toFixed(4),
    label: fmtPct(mom),
    ...scoreLowBadInclusive(mom, THRESHOLDS.momentum.greenAbove, THRESHOLDS.momentum.amberAbove),
  };

  // return1M; inclusive zero = green
  const r1m = n > 31 ? (last / vals[n - 31] - 1) * 100 : 0;
  inds.return1M = {
    raw: +r1m.toFixed(4),
    label: fmtPct(r1m),
    ...scoreLowBadInclusive(r1m, THRESHOLDS.return1M.greenAbove, THRESHOLDS.return1M.amberAbove),
  };

  // return1Y
  const r1y = (last / vals[0] - 1) * 100;
  inds.return1Y = {
    raw: +r1y.toFixed(4),
    label: fmtPct(r1y),
    ...scoreLowBad(r1y, THRESHOLDS.return1Y.greenAbove, THRESHOLDS.return1Y.amberAbove),
  };

  // range52W
  const p52  = vals.slice(-252);
  const hi52 = Math.max(...p52);
  const lo52 = Math.min(...p52);
  const rng  = hi52 !== lo52 ? (last - lo52) / (hi52 - lo52) * 100 : 50;
  inds.range52W = {
    raw: +rng.toFixed(4),
    label: rng.toFixed(0) + '%',
    ...scoreLowBad(rng, THRESHOLDS.range52W.greenAbove, THRESHOLDS.range52W.amberAbove),
  };

  return { indicators: inds, ma50History: ma50arr, ma200History: ma200arr };
}

/* ── Compute mood from indicators ────────────────────────────────────────── */

export function computeMood(indicators) {
  const score = IND_ORDER.reduce((sum, key) => sum + (indicators[key]?.pts ?? 0), 0);
  const pct   = (score / MAX_SCORE) * 100;
  const band  = MOOD_BANDS.find(b => pct >= b.pctLo && pct < b.pctHi) ?? MOOD_BANDS.at(-1);
  return { label: band.label, colorKey: band.key, color: band.color, score, pct: +pct.toFixed(1) };
}

/* ── getMoodBand convenience ─────────────────────────────────────────────── */

export function getMoodBand(label) {
  return MOOD_BANDS.find(b => b.label === label) ?? MOOD_BANDS[2];
}

/* ── Frontend: compute indicators from coin object (with precision fallback) */

export function calculateIndicators(coin) {
  const prices  = coin.priceHistory.map(p => p.p);
  const ma50    = coin.ma50History  ?? [];
  const ma200   = coin.ma200History ?? [];
  const n       = prices.length;
  const current = prices[n - 1];
  const src     = coin.indicators ?? {};

  function fallback(key, calcVal, tol = 2) {
    const storedRaw = src[key]?.raw;
    return (storedRaw !== undefined && Math.abs(calcVal - storedRaw) > tol)
      ? storedRaw : calcVal;
  }

  const indicators = {};

  /* A) Stored raw, re-scored */
  const volRaw = src.volatility?.raw ?? 0;
  indicators.volatility = {
    raw: volRaw, label: volRaw.toFixed(1) + '%',
    ...scoreHighBad(volRaw, THRESHOLDS.volatility.greenBelow, THRESHOLDS.volatility.amberBelow),
  };

  const spikeRaw = src.volSpike?.raw ?? 1;
  indicators.volSpike = {
    raw: spikeRaw, label: spikeRaw.toFixed(2) + '\u00d7',
    ...scoreHighBad(spikeRaw, THRESHOLDS.volSpike.greenBelow, THRESHOLDS.volSpike.amberBelow),
  };

  const peakRaw = src.vsPeak?.raw ?? 0;
  indicators.vsPeak = {
    raw: peakRaw, label: '-' + peakRaw.toFixed(1) + '%',
    ...scoreHighBad(peakRaw, THRESHOLDS.vsPeak.greenBelow, THRESHOLDS.vsPeak.amberBelow),
  };

  const cagr = src.cagr3Y?.raw ?? 0;
  indicators.cagr3Y = {
    raw: cagr, label: fmtPct(cagr),
    color: cagr > 0 ? 'green' : 'red',
    pts:   cagr > 0 ? 0 : 2,
  };

  /* B) Fully recalculated (with precision fallback) */
  const ma50Last  = ma50.length  ? ma50[ma50.length - 1]   : 0;
  const ma200Last = ma200.length ? ma200[ma200.length - 1]  : 0;

  {
    const calc = ma50Last > 0 ? (current / ma50Last - 1) * 100 : src.shortTrend?.raw ?? 0;
    const raw  = fallback('shortTrend', calc, 0.1);
    indicators.shortTrend = { raw, label: fmtPct(raw), ...scoreLowBad(raw, THRESHOLDS.shortTrend.greenAbove, THRESHOLDS.shortTrend.amberAbove) };
  }

  {
    const calc = ma200Last > 0 ? (current / ma200Last - 1) * 100 : src.longTrend?.raw ?? 0;
    const raw  = fallback('longTrend', calc);
    indicators.longTrend = { raw, label: fmtPct(raw), ...scoreLowBad(raw, THRESHOLDS.longTrend.greenAbove, THRESHOLDS.longTrend.amberAbove) };
  }

  {
    const calc    = (ma50Last > 0 && ma200Last > 0) ? ma50Last / ma200Last : src.maCross?.raw ?? 0;
    const stored  = src.maCross?.raw ?? calc;
    const ratio   = Math.abs(calc - stored) > 0.1 ? stored : calc;
    const golden  = ratio >= THRESHOLDS.maCross.goldenCrossAt;
    indicators.maCross = { raw: ratio, label: golden ? 'Golden Cross' : 'Death Cross', color: golden ? 'green' : 'red', pts: golden ? 0 : 2 };
  }

  {
    const r10  = n > 11 ? (current / prices[n - 11] - 1) * 100 : 0;
    const r30  = n > 31 ? (current / prices[n - 31] - 1) * 100 : 0;
    const raw  = fallback('momentum', r10 - r30, 0.1);
    indicators.momentum = { raw, label: fmtPct(raw), ...scoreLowBadInclusive(raw, THRESHOLDS.momentum.greenAbove, THRESHOLDS.momentum.amberAbove) };
  }

  {
    const raw = n > 31 ? (current / prices[n - 31] - 1) * 100 : 0;
    indicators.return1M = { raw, label: fmtPct(raw), ...scoreLowBadInclusive(raw, THRESHOLDS.return1M.greenAbove, THRESHOLDS.return1M.amberAbove) };
  }

  {
    const calc = (current / prices[0] - 1) * 100;
    const raw  = fallback('return1Y', calc, 5);
    indicators.return1Y = { raw, label: fmtPct(raw), ...scoreLowBad(raw, THRESHOLDS.return1Y.greenAbove, THRESHOLDS.return1Y.amberAbove) };
  }

  {
    const p52 = prices.slice(-252);
    const hi  = Math.max(...p52);
    const lo  = Math.min(...p52);
    const raw = hi !== lo ? (current - lo) / (hi - lo) * 100 : 50;
    indicators.range52W = { raw, label: raw.toFixed(0) + '%', ...scoreLowBad(raw, THRESHOLDS.range52W.greenAbove, THRESHOLDS.range52W.amberAbove) };
  }

  return indicators;
}

/* ── Full enrichment pipeline ────────────────────────────────────────────── */

export function enrichCoin(raw) {
  const indicators = calculateIndicators(raw);
  const mood       = computeMood(indicators);
  return { ...raw, indicators, mood };
}
