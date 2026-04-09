/**
 * GloRisk — Risk Calculation Engine (Shared: build + frontend)
 * ─────────────────────────────────────────────────────────────────────────────
 * All 10 indicators are now derived from a single fundamentals snapshot
 * (data/raw/fundamentals.csv) — see scripts/build-data.js. The frontend just
 * reads the pre-scored indicators out of coin.indicators and runs the match
 * calculation against the user's scorecard.
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
  cagr5Y: {
    greenAbove: 0,
  },
};

/* ── Indicator metadata ──────────────────────────────────────────────────── */

export const IND_META = {
  volatility:  { label: 'Daily Volatility',   desc: 'How wildly the price moves day-to-day, expressed as an annualised figure. Higher volatility means larger and more unpredictable price moves.' },
  volSpike:    { label: 'Volatility Spike',    desc: 'Recent (1-week) volatility compared to the 1-month baseline. A rising ratio means volatility is accelerating — something is changing.' },
  vsPeak:      { label: 'Distance from Peak',  desc: 'How far the price is from its all-time high. Large drawdowns signal sustained weakness.' },
  shortTrend:  { label: '50-Day Trend',        desc: 'Price relative to its 50-day moving average. Positive means the price is trading above its short-term trend (bullish).' },
  longTrend:   { label: '200-Day Trend',       desc: 'Price relative to its 200-day moving average. Positive means the long-term uptrend is intact.' },
  maCross:     { label: 'Trend Direction',     desc: 'Whether the 50-day average is above (Golden Cross) or below (Death Cross) the 200-day average. A key signal of overall trend direction.' },
  return1M:    { label: '30-Day Return',       desc: 'Total price return over the past 30 days.' },
  return1Y:    { label: '12-Month Return',     desc: 'Total price return over the past 12 months of available data.' },
  range52W:    { label: 'Position in Range',   desc: 'Where the price sits within its 52-week high/low band. Near the bottom signals weakness.' },
  cagr5Y:      { label: '5-Year Growth',       desc: 'Compound annual growth rate over 5 years. A negative rate means the asset has lost value over the period.' },
};

export const IND_ORDER = [
  'volatility', 'volSpike', 'vsPeak',
  'shortTrend', 'longTrend', 'maCross',
  'return1M', 'return1Y',
  'range52W', 'cagr5Y',
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

/* ── Label reconstruction ────────────────────────────────────────────────
 *
 * coins.json only stores { color, raw } per indicator to cut the file size
 * in half. The display label is rebuilt on demand — signed percentages for
 * return-style indicators, magnitudes for volatility, text labels for
 * categorical indicators like maCross.
 */

function fmtSignedPct(v, d = 1) {
  if (v == null || !isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
}

export function labelFor(key, raw, color) {
  if (raw == null || !isFinite(raw)) return '—';
  switch (key) {
    case 'volatility': return raw.toFixed(1) + '%';
    case 'volSpike':   return raw.toFixed(2) + '\u00d7';
    case 'vsPeak':     return '-' + raw.toFixed(1) + '%';
    case 'shortTrend':
    case 'longTrend':
    case 'return1M':
    case 'return1Y':
    case 'cagr5Y':
      return fmtSignedPct(raw);
    case 'range52W':   return raw.toFixed(0) + '%';
    case 'maCross':    return color === 'green' ? 'Golden Cross' : 'Death Cross';
    default:           return String(raw);
  }
}

// Convenience: resolve a label from a coin's indicator object (or return fallback).
export function indLabel(ind, key) {
  if (!ind) return '—';
  if (ind.label) return ind.label;  // legacy format
  return labelFor(key, ind.raw, ind.color);
}

/* ── GloRisk Fit Score — personalised scoring engine ───────────────────── */

// Scoring matrices per answer type
// Standard: A=strict, B=lenient, C=neutral
const SCORE_MATRIX = {
  A: { green: 1, amber: 0.5, red: 0 },
  B: { green: 1, amber: 1,   red: 0 },
  C: { green: 1, amber: 1,   red: 1 },
};

// Q9 (range52W) is inverted: A=buy winners, B=anytime, C=buy dips
const SCORE_MATRIX_Q9 = {
  A: { green: 1, amber: 0.5, red: 0 },
  B: { green: 1, amber: 1,   red: 1 },
  C: { green: 0, amber: 0.5, red: 1 },
};

// Risk appetite questions — each question maps 1:1 to exactly one indicator.
// The `key` matches the indicator key in coin.indicators, and `indicator` is
// the human-readable label shown in the UI so the mapping is explicit.
// Answer A → scores a green indicator as 1.0 and penalises amber/red
// Answer B → middle ground (see SCORE_MATRIX)
// Answer C → accepts all colours (most permissive)
export const FIT_QUESTIONS = [
  { key: 'volatility', indicator: 'Daily Volatility',    q: 'How much price movement are you comfortable with?',                    a: 'I prefer steady, stable stocks',         b: "I'm okay with some ups and downs",  c: "I'm comfortable with big swings" },
  { key: 'volSpike',   indicator: 'Volatility Spike',    q: 'If a stock suddenly becomes more unstable, what would you do?',       a: "I'd avoid it or sell",                   b: "I'd keep an eye on it",             c: "I'd stay invested" },
  { key: 'vsPeak',     indicator: 'Distance from Peak',  q: 'If a stock drops from its peak, how much is acceptable to you?',      a: 'Only small drops',                       b: 'Some decline is fine',              c: "Big drops don't bother me" },
  { key: 'shortTrend', indicator: '50-Day Trend',        q: 'What do you want to see in the short term?',                          a: 'The price going up',                     b: 'Moving sideways is fine',           c: "I'm okay if it drops short term" },
  { key: 'longTrend',  indicator: '200-Day Trend',       q: 'Over time, what kind of trend do you prefer?',                        a: 'Clear upward growth',                    b: 'Mixed or uncertain trend',          c: "I'm okay taking risks for potential upside" },
  { key: 'maCross',    indicator: 'Trend Direction',     q: 'How important is it that the stock is clearly trending upward?',      a: 'Very important',                         b: 'Somewhat important',                c: 'Not important' },
  { key: 'return1M',   indicator: '30-Day Return',       q: 'Over the past month, what would you prefer?',                         a: 'Gains',                                  b: 'Flat performance',                  c: "I'm okay with losses" },
  { key: 'return1Y',   indicator: '12-Month Return',     q: 'Over the past year, what are you aiming for?',                        a: 'Steady, reliable growth',                b: 'Moderate growth',                   c: 'High returns even if risky' },
  { key: 'range52W',   indicator: 'Position in Range',   q: 'When do you prefer to buy a stock?',                                   a: "When it's already doing well",           b: 'Anytime',                           c: "When it's dropped (cheap but risky)", inverted: true },
  { key: 'cagr5Y',     indicator: '5-Year Growth',       q: 'What matters more to you?',                                            a: 'Protecting my money',                    b: 'A balance of safety and growth',    c: 'Maximising growth' },
];

/* ── Context questions — asset types, markets, horizon, philosophy ──────── */

// Context questions steer WHICH assets we rank (scope) and HOW we weight indicators.
// These live at the top of the questionnaire, before the risk indicator questions.
export const CONTEXT_QUESTIONS = {
  assetTypes: {
    key: 'assetTypes',
    q: 'What types of assets are you interested in?',
    multi: true,
    options: [
      { value: 'stocks',  label: 'Individual stocks' },
      { value: 'etfs',    label: 'ETFs (sector, index, thematic)' },
      { value: 'crypto',  label: 'Crypto' },
      { value: 'indices', label: 'Market indices' },
    ],
  },
  markets: {
    key: 'markets',
    q: 'Which markets do you want to track?',
    multi: true,
    options: [
      { value: 'sp500',   label: 'US \u2014 S&P 500' },
      { value: 'nasdaq',  label: 'US \u2014 NASDAQ 100' },
      { value: 'ftse',    label: 'UK \u2014 FTSE 100' },
      { value: 'nikkei',  label: 'Japan \u2014 Nikkei 225' },
      { value: 'hsi',     label: 'Hong Kong \u2014 Hang Seng' },
    ],
  },
  horizon: {
    key: 'horizon',
    q: "What's your typical holding period?",
    options: [
      { value: 'A', label: 'Short-term',     desc: 'days to a few weeks \u2014 I\u2019m in and out quickly' },
      { value: 'B', label: 'Medium-term',    desc: 'a few months to a year \u2014 I ride moves but don\u2019t marry positions' },
      { value: 'C', label: 'Long-term',      desc: '1 to 5 years \u2014 I\u2019m building positions, not trading them' },
      { value: 'D', label: 'Very long-term', desc: '5+ years \u2014 I\u2019m buying for the decade' },
    ],
  },
  philosophy: {
    key: 'philosophy',
    q: 'Which of these best describes how you invest?',
    options: [
      { value: 'A', label: 'Buy the dips',        desc: 'I prefer assets that have pulled back \u2014 cheaper entry, contrarian bets' },
      { value: 'B', label: 'Back the winners',    desc: 'I follow momentum \u2014 strength attracts more strength' },
      { value: 'C', label: 'Dollar-cost average', desc: 'I buy a fixed amount regularly \u2014 I don\u2019t try to time anything' },
      { value: 'D', label: 'Growth at any price', desc: 'I back the highest-potential assets even if they\u2019re expensive or volatile' },
    ],
  },
};

// Horizon + Philosophy are CURRENTLY stored but do NOT affect the fit score.
// They're captured for future "investment archetype" derivation — the scoring
// logic that uses them will be defined later. For now, the fit score is computed
// purely from the 10 explicit risk questions in FIT_QUESTIONS.
//
// Kept as exported constants so the UI can show them and the archetype logic
// (when added) can reference them.

// Human-readable labels for context answers (used in summaries)
export const HORIZON_LABELS = { A: 'Short-term', B: 'Medium-term', C: 'Long-term', D: 'Very long-term' };
export const PHILOSOPHY_LABELS = {
  A: 'Buy the dips',
  B: 'Back winners',
  C: 'Dollar-cost average',
  D: 'Growth at any price',
};

// Map profile.markets values → the region codes that should match.
// The new-style keys are us/uk/jp/hk/row (region-wide). The legacy index
// keys (sp500/nasdaq/ftse/nikkei/hsi) are kept here for backward-compat
// so users who answered the old questionnaire don't suddenly see zero
// results — their answers get rewritten to the closest region match.
const MARKET_REGION_MAP = {
  us:  ['US'],
  uk:  ['UK'],
  jp:  ['JP'],
  hk:  ['HK'],
  row: ['CA', 'EU', 'KR', 'CN', 'TW', 'IN', 'SG', 'AU', 'ME', 'LATAM', 'AF', 'SEA', 'Other'],
  // Legacy index-level keys — mapped to the equivalent region
  sp500:  ['US'],
  nasdaq: ['US'],
  ftse:   ['UK'],
  nikkei: ['JP'],
  hsi:    ['HK'],
};

/**
 * Determine whether a coin is within the user's stated scope (asset types + markets).
 * Returns true if the coin matches the user's interests, false otherwise.
 * Backward compat: if profile has no context answers, everything is in scope.
 *
 * Now that the catalog is fundamentals-only (stocks), the only asset type
 * currently present is 'stocks'. Crypto / ETFs / indices are returning in
 * follow-up commits via dedicated input files.
 */
export function isAssetInScope(coin, profile) {
  if (!profile || !coin) return true;
  const types = profile.assetTypes || [];
  const markets = profile.markets || [];
  const hasTypes = types.length > 0;
  const hasMarkets = markets.length > 0;
  if (!hasTypes && !hasMarkets) return true; // no scope set

  // Today's catalog is stocks-only. If the user explicitly excluded stocks
  // (only selected crypto/etfs/indices), nothing is in scope yet.
  if (hasTypes && !types.includes('stocks')) return false;

  if (hasMarkets) {
    const allowed = new Set();
    for (const m of markets) {
      const regions = MARKET_REGION_MAP[m] || [];
      for (const r of regions) allowed.add(r);
    }
    if (allowed.size === 0) return true; // unknown markets — don't filter
    return allowed.has(coin.region);
  }
  return true;
}

/**
 * Compute the GloRisk Fit Score for a coin against a user profile.
 *
 * Scoring is a simple average of the 10 risk questions — each question maps
 * to exactly one indicator (see FIT_QUESTIONS). Context answers (horizon,
 * philosophy, asset types, markets) do NOT affect the fit score; they're
 * used separately for scope filtering and future archetype derivation.
 *
 * @param {object} indicators — coin.indicators (keyed by IND_ORDER)
 * @param {object} profile — { volatility: 'A'|'B'|'C', volSpike: 'A'|'B'|'C', ... }
 * @returns {number} 0–100 fit score
 */
// Read an answer from the profile with backward-compat for renamed keys.
// cagr3Y was renamed to cagr5Y — accept either.
function readAnswer(profile, key) {
  if (profile[key]) return profile[key];
  if (key === 'cagr5Y' && profile.cagr3Y) return profile.cagr3Y;
  return null;
}

export function computeFitScore(indicators, profile) {
  if (!indicators || !profile) return null;
  let sum = 0;
  let count = 0;
  for (const q of FIT_QUESTIONS) {
    const ind = indicators[q.key];
    const answer = readAnswer(profile, q.key);
    if (!ind || !answer) continue;
    const matrix = q.inverted ? SCORE_MATRIX_Q9 : SCORE_MATRIX;
    const scores = matrix[answer];
    if (!scores) continue;
    sum += scores[ind.color] ?? 0;
    count++;
  }
  if (!count) return null;
  return Math.round((sum / count) * 100);
}

/**
 * Get fit label from score.
 */
export function getFitLabel(score) {
  if (score >= 85) return 'Very Strong';
  if (score >= 65) return 'Strong';
  if (score >= 40) return 'Borderline';
  if (score >= 20) return 'Poor';
  return 'Very Poor';
}

/**
 * Get fit color from score.
 */
export function getFitColor(score) {
  if (score >= 85) return '#1D9E75';
  if (score >= 65) return '#5DCAA5';
  if (score >= 40) return '#EF9F27';
  if (score >= 20) return '#F09595';
  return '#E24B4A';
}

/**
 * Get fit CSS class for badge styling.
 */
export function getFitClass(score) {
  if (score >= 85) return 'vs';
  if (score >= 65) return 's';
  if (score >= 40) return 'b';
  if (score >= 20) return 'p';
  return 'vp';
}

/**
 * Derive profile summary from answers.
 * Returns { riskLevel, horizon, philosophy, assetTypes, markets } where each is a display label.
 */
export function getProfileSummary(profile) {
  if (!profile) return null;
  // Risk level: count how many C (aggressive) answers among the 10 risk questions
  const riskAnswers = FIT_QUESTIONS.map(q => readAnswer(profile, q.key)).filter(Boolean);
  const cCount = riskAnswers.filter(a => a === 'C').length;
  const riskLevel = cCount >= 5 ? 'Aggressive' : cCount >= 3 ? 'Moderate' : 'Conservative';

  const horizon = profile.horizon ? HORIZON_LABELS[profile.horizon] : null;
  const philosophy = profile.philosophy ? PHILOSOPHY_LABELS[profile.philosophy] : null;

  return { riskLevel, horizon, philosophy, assetTypes: profile.assetTypes || [], markets: profile.markets || [] };
}

/**
 * Load/save profile from localStorage.
 */
export function getProfile() {
  try { return JSON.parse(localStorage.getItem('glorisk-profile')); } catch { return null; }
}
export function saveProfile(profile) {
  localStorage.setItem('glorisk-profile', JSON.stringify(profile));
}
