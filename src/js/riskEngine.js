/**
 * GloRisk — Risk Calculation Engine v2 (Shared: build + frontend)
 * ─────────────────────────────────────────────────────────────────────────────
 * 36 categorised indicators across 6 risk dimensions.
 * See scripts/build-data.js for derivation logic.
 */

'use strict';

/* ── Scoring thresholds ──────────────────────────────────────────────────── */

export const THRESHOLDS = {
  // Market Risk
  beta:            { greenBelow: 1.0,  amberBelow: 1.5 },
  betaDrawdown:    { greenBelow: 3,    amberBelow: 6 },
  range52W:        { greenAbove: 45,   amberAbove: 25 },
  vsPeak:          { greenBelow: 20,   amberBelow: 40 },
  perf6M:          { greenAbove: 0,    amberAbove: -15 },
  perfYTD:         { greenAbove: 0,    amberAbove: -10 },
  // Volatility & Momentum
  volDaily:        { greenBelow: 30,   amberBelow: 60 },
  volWeekly:       { greenBelow: 30,   amberBelow: 60 },
  volMonthly:      { greenBelow: 30,   amberBelow: 60 },
  volAccel:        { greenBelow: 1.0,  amberBelow: 2.0 },
  sharpe1M:        { greenAbove: 0.5,  amberAbove: 0 },
  sharpe1Y:        { greenAbove: 1.0,  amberAbove: 0 },
  gapRisk:         { greenBelow: 2,    amberBelow: 5 },
  rangeWidth:      { greenBelow: 50,   amberBelow: 100 },
  // Trend & Technical
  maCross:         { goldenCrossAt: 1.0 },
  shortTrend:      { greenAbove: 0,    amberAbove: -6 },
  longTrend:       { greenAbove: 0,    amberAbove: -10 },
  momDiv:          { greenAbove: 0,    amberAbove: -2 },
  perf3M:          { greenAbove: 0,    amberAbove: -10 },
  nearHigh1M:      { greenBelow: 3,    amberBelow: 8 },
  nearLow3M:       { greenAbove: 15,   amberAbove: 5 },
  // Fundamental
  debtEquity:      { greenBelow: 0.5,  amberBelow: 1.5 },
  debtRevenue:     { greenBelow: 0.3,  amberBelow: 0.8 },
  ebitdaMargin:    { greenAbove: 0.5,  amberAbove: 0.2 },
  fcfYield:        { greenAbove: 5,    amberAbove: 0 },
  epsDilution:     { greenBelow: 2,    amberBelow: 10 },
  earningsQuality: { greenAbove: 0.5,  amberAbove: 0.2 },
  profitValuation: { greenAbove: 20,   amberAbove: 5 },
  // Liquidity (capTier uses custom tier logic)
  volChg1W:        { greenAbove: 10,   amberAbove: -20 },
  volChg1M:        { greenAbove: 0,    amberAbove: -30 },
  relVolIntra:     { greenAbove: 1.5,  amberAbove: 0.7 },
  relVol1M:        { greenAbove: 1.0,  amberAbove: 0.5 },
  // Sentiment (analystRating, trendHealth, volPriceConfirm use custom logic)
};

/* ── Category structure ──────────────────────────────────────────────────── */

export const CATEGORIES = [
  { id: 'marketRisk',  label: 'Market Risk',           keys: ['beta','betaDrawdown','range52W','vsPeak','perf6M','perfYTD'] },
  { id: 'volMomentum', label: 'Volatility & Momentum', keys: ['volDaily','volWeekly','volMonthly','volAccel','sharpe1M','sharpe1Y','gapRisk','rangeWidth'] },
  { id: 'trendTech',   label: 'Trend & Technical',     keys: ['maCross','shortTrend','longTrend','momDiv','perf3M','nearHigh1M','nearLow3M'] },
  { id: 'fundamental', label: 'Fundamental',            keys: ['debtEquity','debtRevenue','ebitdaMargin','fcfYield','epsDilution','earningsQuality','profitValuation'] },
  { id: 'liquidity',   label: 'Liquidity',              keys: ['volChg1W','volChg1M','relVolIntra','relVol1M','capTier'] },
  { id: 'sentiment',   label: 'Sentiment',              keys: ['analystRating','trendHealth','volPriceConfirm'] },
];

export const PRO_INDICATORS = new Set([
  'volAccel', 'sharpe1M', 'sharpe1Y',           // Volatility & Momentum
  'momDiv',                                       // Trend & Technical
  'ebitdaMargin', 'earningsQuality', 'profitValuation', // Fundamental
]);

/* ── Indicator metadata ──────────────────────────────────────────────────── */

export const IND_META = {
  // Market Risk
  beta:            { label: 'Market Sensitivity',      desc: 'Beta measures how much a stock moves relative to the overall market. Above 1 means more volatile than the market.', category: 'marketRisk', pro: false },
  betaDrawdown:    { label: 'Downside Risk Score',     desc: 'Combines market sensitivity with distance from peak. High scores indicate elevated downside risk.', category: 'marketRisk', pro: false },
  range52W:        { label: '52W Position',            desc: 'Where the price sits within its 52-week high/low band. Near the bottom signals weakness.', category: 'marketRisk', pro: false },
  vsPeak:          { label: 'Off All-Time High',       desc: 'How far the price is from its all-time high. Large drawdowns signal sustained weakness.', category: 'marketRisk', pro: false },
  perf6M:          { label: '6-Month Return',          desc: 'Total price return over the past 6 months.', category: 'marketRisk', pro: false },
  perfYTD:         { label: 'Year-to-Date Return',     desc: 'Total price return since the start of the current year.', category: 'marketRisk', pro: false },
  // Volatility & Momentum
  volDaily:        { label: 'Daily Volatility',        desc: 'How wildly the price moves day-to-day, annualised. Higher means larger, more unpredictable moves.', category: 'volMomentum', pro: false },
  volWeekly:       { label: 'Weekly Volatility',       desc: 'Price swing level measured over a week, annualised. Smooths out daily noise.', category: 'volMomentum', pro: false },
  volMonthly:      { label: 'Monthly Volatility',      desc: 'Price swing level measured over a month, annualised. The bumpiness score.', category: 'volMomentum', pro: false },
  volAccel:        { label: 'Volatility Acceleration', desc: 'Recent (1-week) vs baseline (1-month) volatility. A rising ratio means volatility is accelerating.', category: 'volMomentum', pro: true },
  sharpe1M:        { label: 'Risk-Adj Return (1M)',    desc: '1-month return divided by annualised volatility. Higher means better return per unit of risk.', category: 'volMomentum', pro: true },
  sharpe1Y:        { label: 'Risk-Adj Return (1Y)',    desc: '1-year return divided by annualised volatility. Higher means better return per unit of risk.', category: 'volMomentum', pro: true },
  gapRisk:         { label: 'Overnight Gap Risk',      desc: 'How much the stock jumps between close and open. Larger gaps mean more overnight risk.', category: 'volMomentum', pro: false },
  rangeWidth:      { label: 'Annual Swing Width',      desc: 'Width of the 52-week trading range relative to the low. Wider ranges indicate more volatile stocks.', category: 'volMomentum', pro: false },
  // Trend & Technical
  maCross:         { label: 'Trend Signal',            desc: 'Whether the 50-day average is above (Golden Cross) or below (Death Cross) the 200-day average.', category: 'trendTech', pro: false },
  shortTrend:      { label: 'Short-Term Trend',        desc: 'Price relative to its 50-day moving average. Positive means trading above the short-term trend.', category: 'trendTech', pro: false },
  longTrend:       { label: 'Long-Term Trend',         desc: 'Price relative to its 200-day moving average. Positive means the long-term uptrend is intact.', category: 'trendTech', pro: false },
  momDiv:          { label: 'Momentum Divergence',     desc: 'Whether short-term momentum is accelerating or decelerating vs the medium-term trend.', category: 'trendTech', pro: true },
  perf3M:          { label: '3-Month Return',          desc: 'Total price return over the past 3 months.', category: 'trendTech', pro: false },
  nearHigh1M:      { label: 'From Recent High',        desc: 'How far the price is from its 1-month high. Close to the high suggests strength.', category: 'trendTech', pro: false },
  nearLow3M:       { label: 'From 3-Month Low',        desc: 'How far the price has recovered from its 3-month low. Higher means more recovery.', category: 'trendTech', pro: false },
  // Fundamental
  debtEquity:      { label: 'Debt Level',              desc: 'Total debt relative to shareholder equity. Lower is generally safer.', category: 'fundamental', pro: false },
  debtRevenue:     { label: 'Debt vs Sales',           desc: 'Total debt relative to annual revenue. Lower means the company can service debt more easily.', category: 'fundamental', pro: false },
  ebitdaMargin:    { label: 'EBITDA Efficiency',       desc: 'EBITDA as a fraction of gross profit. Higher means more operational profit is retained.', category: 'fundamental', pro: true },
  fcfYield:        { label: 'Cash Generation',         desc: 'Free cash flow relative to market cap. Higher means more cash generated relative to valuation.', category: 'fundamental', pro: false },
  epsDilution:     { label: 'Share Dilution Risk',     desc: 'Gap between basic and diluted EPS. Larger gaps mean more potential dilution from options/convertibles.', category: 'fundamental', pro: false },
  earningsQuality: { label: 'Earnings Quality',        desc: 'Net income as a fraction of EBITDA. Higher means more earnings flow to the bottom line.', category: 'fundamental', pro: true },
  profitValuation: { label: 'Profit vs Valuation',     desc: 'Gross profit relative to market cap — a "gross profit yield". Higher means cheaper relative to profitability.', category: 'fundamental', pro: true },
  // Liquidity
  volChg1W:        { label: 'Trading Interest (1W)',   desc: 'Week-over-week change in trading volume. Rising volume confirms price moves.', category: 'liquidity', pro: false },
  volChg1M:        { label: 'Trading Interest (1M)',   desc: 'Month-over-month change in trading volume. Persistent declines signal fading interest.', category: 'liquidity', pro: false },
  relVolIntra:     { label: "Today's Activity",        desc: 'Current volume relative to typical volume at this time of day. Higher means unusual activity.', category: 'liquidity', pro: false },
  relVol1M:        { label: 'Monthly Activity',        desc: 'Average monthly volume relative to the longer-term baseline. Higher means sustained interest.', category: 'liquidity', pro: false },
  capTier:         { label: 'Company Size',            desc: 'Market cap tier: Mega (>$200B), Large (>$10B), Mid (>$2B), Small (>$300M), Micro (\u2264$300M).', category: 'liquidity', pro: false },
  // Sentiment
  analystRating:   { label: 'Analyst View',            desc: 'Consensus analyst recommendation from Strong Buy to Strong Sell.', category: 'sentiment', pro: false },
  trendHealth:     { label: 'Trend Health',            desc: 'Whether short-term and long-term performance trends are aligned. Alignment gives clearer signals.', category: 'sentiment', pro: false },
  volPriceConfirm: { label: 'Move Confirmation',       desc: 'Whether volume confirms the price direction. Rising price + rising volume = strong confirmation.', category: 'sentiment', pro: false },
};

export const IND_ORDER = [
  // Market Risk
  'beta', 'betaDrawdown', 'range52W', 'vsPeak', 'perf6M', 'perfYTD',
  // Volatility & Momentum
  'volDaily', 'volWeekly', 'volMonthly', 'volAccel', 'sharpe1M', 'sharpe1Y', 'gapRisk', 'rangeWidth',
  // Trend & Technical
  'maCross', 'shortTrend', 'longTrend', 'momDiv', 'perf3M', 'nearHigh1M', 'nearLow3M',
  // Fundamental
  'debtEquity', 'debtRevenue', 'ebitdaMargin', 'fcfYield', 'epsDilution', 'earningsQuality', 'profitValuation',
  // Liquidity
  'volChg1W', 'volChg1M', 'relVolIntra', 'relVol1M', 'capTier',
  // Sentiment
  'analystRating', 'trendHealth', 'volPriceConfirm',
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
 * coins.json stores { color, raw } per indicator. The display label is
 * rebuilt on demand.
 */

function fmtSignedPct(v, d = 1) {
  if (v == null || !isFinite(v)) return '\u2014';
  return (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
}

export function labelFor(key, raw, color) {
  if (raw == null) return '\u2014';
  switch (key) {
    // Volatility — unsigned %
    case 'volDaily':
    case 'volWeekly':
    case 'volMonthly':
      return isFinite(raw) ? raw.toFixed(1) + '%' : '\u2014';
    // Multiplier ×
    case 'volAccel':
    case 'relVolIntra':
    case 'relVol1M':
      return isFinite(raw) ? raw.toFixed(2) + '\u00d7' : '\u2014';
    // Drawdown — negative prefix
    case 'vsPeak':
    case 'nearHigh1M':
      return isFinite(raw) ? '-' + raw.toFixed(1) + '%' : '\u2014';
    // Signed %
    case 'shortTrend':
    case 'longTrend':
    case 'perf3M':
    case 'perf6M':
    case 'perfYTD':
    case 'nearLow3M':
    case 'momDiv':
      return fmtSignedPct(raw);
    // Unsigned %
    case 'range52W':
    case 'rangeWidth':
      return isFinite(raw) ? raw.toFixed(0) + '%' : '\u2014';
    // Ratio (2dp)
    case 'beta':
    case 'sharpe1M':
    case 'sharpe1Y':
    case 'debtEquity':
    case 'debtRevenue':
    case 'ebitdaMargin':
    case 'earningsQuality':
      return isFinite(raw) ? raw.toFixed(2) : '\u2014';
    // Yield / dilution / gap %
    case 'fcfYield':
    case 'profitValuation':
    case 'epsDilution':
    case 'gapRisk':
      return isFinite(raw) ? raw.toFixed(1) + '%' : '\u2014';
    // Score (1–10)
    case 'betaDrawdown':
      return isFinite(raw) ? raw.toFixed(1) + ' / 10' : '\u2014';
    // Volume changes — signed %
    case 'volChg1W':
    case 'volChg1M':
      return fmtSignedPct(raw, 0);
    // Categorical — text from raw code
    case 'maCross':
      return color === 'green' ? 'Golden Cross' : 'Death Cross';
    case 'capTier': {
      const tiers = { 5: 'Mega', 4: 'Large', 3: 'Mid', 2: 'Small', 1: 'Micro' };
      return tiers[raw] || '\u2014';
    }
    case 'analystRating': {
      const ratings = { 5: 'Strong Buy', 4: 'Buy', 3: 'Hold', 2: 'Sell', 1: 'Strong Sell' };
      return ratings[raw] || '\u2014';
    }
    case 'trendHealth':
      return raw > 0 ? 'Aligned \u2191' : raw < 0 ? 'Aligned \u2193' : 'Mixed';
    case 'volPriceConfirm':
      return color === 'green' ? 'Confirmed' : color === 'amber' ? 'Weak' : 'Diverging';
    default:
      return isFinite(raw) ? String(raw) : '\u2014';
  }
}

// Convenience: resolve a label from a coin's indicator object.
export function indLabel(ind, key) {
  if (!ind) return '\u2014';
  if (ind.label) return ind.label;  // legacy format
  return labelFor(key, ind.raw, ind.color);
}

/* ── Sector grouping (replaces asset types for stocks-only catalog) ──────── */

export const SECTOR_GROUP_MAP = {
  tech:          ['Electronic technology', 'Technology services'],
  finance:       ['Finance'],
  healthcare:    ['Health technology', 'Health services'],
  manufacturing: ['Producer manufacturing', 'Industrial services'],
  consumer:      ['Consumer non-durables', 'Consumer durables', 'Consumer services', 'Retail trade'],
  energy:        ['Process industries', 'Non-energy minerals', 'Energy minerals'],
  services:      ['Commercial services', 'Distribution services', 'Transportation'],
  utilities:     ['Utilities', 'Communications'],
};

/* ── GloRisk Fit Score — personalised scoring engine ───────────────────── */

// Scoring matrices: A=strict, B=moderate, C=permissive
const SCORE_MATRIX = {
  A: { green: 1, amber: 0.5, red: 0 },
  B: { green: 1, amber: 1,   red: 0 },
  C: { green: 1, amber: 1,   red: 1 },
};

// Risk appetite questions — each maps to one or more indicators in the same
// category. The user's A/B/C answer applies to ALL mapped indicators.
export const FIT_QUESTIONS = [
  // Market Risk (3 questions)
  { key: 'catMarketSens', indicators: ['beta', 'betaDrawdown'], category: 'marketRisk',
    q: 'How sensitive should the stock be to overall market moves?',
    a: 'Low sensitivity \u2014 I prefer stable stocks', b: 'Some sensitivity is fine', c: 'High sensitivity is OK \u2014 I want to ride the market' },
  { key: 'catPeakDraw', indicators: ['range52W', 'vsPeak'], category: 'marketRisk',
    q: 'How far from its peak are you comfortable buying?',
    a: 'Only near the top \u2014 I want proven winners', b: 'Some decline is fine', c: "Big drops don\u2019t bother me" },
  { key: 'catRecentPerf', indicators: ['perf6M', 'perfYTD'], category: 'marketRisk',
    q: 'What recent performance matters to you?',
    a: 'Positive returns over 6 months and year-to-date', b: 'Small losses are acceptable', c: "I don\u2019t mind significant recent losses" },
  // Volatility & Momentum (3 questions)
  { key: 'catVolSwing', indicators: ['volDaily', 'volWeekly', 'volMonthly'], category: 'volMomentum',
    q: 'How much daily/weekly price swing can you handle?',
    a: 'I prefer steady, stable stocks', b: "I\u2019m okay with some ups and downs", c: "I\u2019m comfortable with big swings" },
  { key: 'catRiskAdj', indicators: ['sharpe1M', 'sharpe1Y', 'volAccel'], category: 'volMomentum',
    q: 'Do you care about risk-adjusted returns or raw returns?',
    a: 'Risk-adjusted is key \u2014 returns per unit of risk', b: 'A balance of both', c: 'Raw returns matter most \u2014 I accept the risk' },
  { key: 'catRangeWidth', indicators: ['gapRisk', 'rangeWidth'], category: 'volMomentum',
    q: 'How wide a trading range is acceptable?',
    a: 'Tight ranges \u2014 I want predictability', b: 'Moderate swings are fine', c: 'Wide ranges are OK \u2014 more opportunity' },
  // Trend & Technical (3 questions)
  { key: 'catTrendDir', indicators: ['maCross', 'shortTrend', 'longTrend'], category: 'trendTech',
    q: 'How important is the overall trend direction?',
    a: 'Very important \u2014 I only want uptrending stocks', b: 'Somewhat important', c: 'Not important \u2014 I buy regardless of trend' },
  { key: 'catHighLow', indicators: ['nearHigh1M', 'nearLow3M'], category: 'trendTech',
    q: 'Do you prefer stocks near recent highs or recovering from lows?',
    a: 'Near highs \u2014 momentum matters', b: 'Either is fine', c: 'Recovering from lows \u2014 I like the upside potential' },
  { key: 'catDecline', indicators: ['perf3M', 'momDiv'], category: 'trendTech',
    q: 'How much recent price decline is acceptable?',
    a: 'Very little \u2014 I want consistent performance', b: 'Some pullback is fine', c: "Significant declines don\u2019t worry me" },
  // Fundamental (3 questions)
  { key: 'catDebt', indicators: ['debtEquity', 'debtRevenue'], category: 'fundamental',
    q: 'How much debt are you comfortable with?',
    a: 'Low debt only \u2014 financial safety first', b: 'Moderate debt is fine', c: "Debt level doesn\u2019t concern me" },
  { key: 'catCashGen', indicators: ['fcfYield', 'epsDilution'], category: 'fundamental',
    q: 'How important is cash generation?',
    a: 'Very \u2014 I want cash-rich, low-dilution companies', b: 'Somewhat important', c: "I\u2019m focused on growth, not current cash flow" },
  { key: 'catEarnings', indicators: ['ebitdaMargin', 'earningsQuality', 'profitValuation'], category: 'fundamental',
    q: 'Do you care about earnings quality and valuation?',
    a: 'Yes \u2014 I want high-quality, fairly valued companies', b: 'Somewhat \u2014 a balance', c: "I\u2019m willing to pay up for growth" },
  // Liquidity (2 questions)
  { key: 'catLiquidity', indicators: ['volChg1W', 'volChg1M', 'relVolIntra', 'relVol1M'], category: 'liquidity',
    q: 'How important is trading activity and liquidity?',
    a: 'Very \u2014 I want actively traded stocks', b: 'Some activity is enough', c: "I don\u2019t mind thinly traded stocks" },
  { key: 'catCompSize', indicators: ['capTier'], category: 'liquidity',
    q: 'What company size are you comfortable investing in?',
    a: 'Large & mega-cap only', b: 'Mid-cap and above', c: 'Any size \u2014 including small & micro-cap' },
  // Sentiment (2 questions)
  { key: 'catAnalyst', indicators: ['analystRating'], category: 'sentiment',
    q: 'How much do analyst opinions matter to you?',
    a: 'A lot \u2014 I follow consensus recommendations', b: 'Somewhat \u2014 one factor among many', c: "Not at all \u2014 I make my own decisions" },
  { key: 'catTrendConfirm', indicators: ['trendHealth', 'volPriceConfirm'], category: 'sentiment',
    q: 'Do you prefer stocks where volume confirms the trend?',
    a: 'Yes \u2014 confirmed moves only', b: 'Nice to have but not essential', c: "I don\u2019t look at volume signals" },
];

/* ── Context questions — sectors, markets, horizon, philosophy ──────────── */

export const CONTEXT_QUESTIONS = {
  sectors: {
    key: 'sectors',
    q: 'Which sectors are you interested in?',
    multi: true,
    options: [
      { value: 'tech',          label: 'Technology',                  desc: 'Electronics, software, semiconductors, IT services' },
      { value: 'finance',       label: 'Finance',                     desc: 'Banks, insurance, asset management, fintech' },
      { value: 'healthcare',    label: 'Healthcare',                  desc: 'Pharma, biotech, medical devices, health services' },
      { value: 'manufacturing', label: 'Manufacturing & Industrials', desc: 'Aerospace, machinery, automotive, industrial services' },
      { value: 'consumer',      label: 'Consumer',                    desc: 'Food, beverages, apparel, retail, leisure, household' },
      { value: 'energy',        label: 'Energy & Materials',          desc: 'Oil, gas, mining, metals, chemicals' },
      { value: 'services',      label: 'Business Services',           desc: 'Logistics, distribution, transport, consulting' },
      { value: 'utilities',     label: 'Utilities & Telecom',         desc: 'Power, water, gas utilities, telecoms' },
    ],
  },
  markets: {
    key: 'markets',
    q: 'Which markets do you want to track?',
    multi: true,
    options: [
      { value: 'us',  label: 'United States' },
      { value: 'uk',  label: 'United Kingdom' },
      { value: 'jp',  label: 'Japan' },
      { value: 'hk',  label: 'Hong Kong' },
      { value: 'row', label: 'Rest of World' },
    ],
  },
  horizon: {
    key: 'horizon',
    q: "What\u2019s your typical holding period?",
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

export const HORIZON_LABELS = { A: 'Short-term', B: 'Medium-term', C: 'Long-term', D: 'Very long-term' };
export const PHILOSOPHY_LABELS = {
  A: 'Buy the dips',
  B: 'Back winners',
  C: 'Dollar-cost average',
  D: 'Growth at any price',
};

/* ── Market region mapping ──────────────────────────────────────────────── */

const MARKET_REGION_MAP = {
  us:  ['US'],
  uk:  ['UK'],
  jp:  ['JP'],
  hk:  ['HK'],
  row: ['CA', 'EU', 'KR', 'CN', 'TW', 'IN', 'SG', 'AU', 'ME', 'LATAM', 'AF', 'SEA', 'Other'],
  // Legacy index-level keys for backward compat
  sp500:  ['US'],
  nasdaq: ['US'],
  ftse:   ['UK'],
  nikkei: ['JP'],
  hsi:    ['HK'],
};

/* ── Scope filtering ──────────────────────────────────────────────────── */

export function isAssetInScope(coin, profile) {
  if (!profile || !coin) return true;

  // Sector filter (new in v2 — replaces asset types)
  const sectors = profile.sectors || [];
  if (sectors.length > 0) {
    const allowed = new Set();
    for (const g of sectors) {
      const names = SECTOR_GROUP_MAP[g] || [];
      for (const s of names) allowed.add(s);
    }
    if (allowed.size > 0 && !allowed.has(coin.sector)) return false;
  }

  // Legacy asset types — stocks-only catalog
  const types = profile.assetTypes || [];
  if (types.length > 0 && !types.includes('stocks')) return false;

  // Market region filter
  const markets = profile.markets || [];
  if (markets.length > 0) {
    const allowed = new Set();
    for (const m of markets) {
      const regions = MARKET_REGION_MAP[m] || [];
      for (const r of regions) allowed.add(r);
    }
    if (allowed.size === 0) return true;
    return allowed.has(coin.region);
  }
  return true;
}

/* ── Question \u2192 indicator map (pre-built for scoring) ─────────────────── */

const IND_TO_QUESTION = {};
for (const q of FIT_QUESTIONS) {
  for (const indKey of q.indicators) {
    IND_TO_QUESTION[indKey] = q.key;
  }
}

/* ── Profile migration detection ─────────────────────────────────────────── */

function isOldProfile(profile) {
  // Old profiles stored answers keyed by indicator name (volatility, volSpike, etc.)
  const oldKeys = ['volatility', 'volSpike', 'return1M', 'return1Y', 'cagr5Y', 'cagr3Y'];
  return oldKeys.some(k => profile[k] != null);
}

function readAnswer(profile, key) {
  return profile[key] || null;
}

/* ── Fit score — category-weighted averaging ─────────────────────────── */

/**
 * Compute GloRisk Fit Score for a coin against a user profile.
 *
 * Each of the 6 categories gets an independent score (avg of RAG match for
 * its indicators). The final score is the average of the 6 category scores.
 * This ensures equal weight per risk dimension regardless of indicator count.
 *
 * Old-format profiles (keyed by indicator name) return null to force re-setup.
 */
export function computeFitScore(indicators, profile) {
  if (!indicators || !profile) return null;
  if (isOldProfile(profile)) return null;

  const categoryScores = [];

  for (const cat of CATEGORIES) {
    let catSum = 0;
    let catCount = 0;
    for (const indKey of cat.keys) {
      const ind = indicators[indKey];
      if (!ind) continue;
      const qKey = IND_TO_QUESTION[indKey];
      if (!qKey) continue;
      const answer = readAnswer(profile, qKey);
      if (!answer) continue;
      const scores = SCORE_MATRIX[answer];
      if (!scores) continue;
      catSum += scores[ind.color] ?? 0;
      catCount++;
    }
    if (catCount > 0) {
      categoryScores.push(catSum / catCount);
    }
  }

  if (categoryScores.length === 0) return null;
  const avg = categoryScores.reduce((a, b) => a + b, 0) / categoryScores.length;
  return Math.round(avg * 100);
}

/* ── Fit label / color / class ──────────────────────────────────────────── */

export function getFitLabel(score) {
  if (score >= 85) return 'Very Low';
  if (score >= 70) return 'Low';
  if (score >= 55) return 'Moderate';
  if (score >= 40) return 'High';
  return 'Very High';
}

export function getFitColor(score) {
  if (score >= 85) return '#1D9E75';
  if (score >= 70) return '#5DCAA5';
  if (score >= 55) return '#EF9F27';
  if (score >= 40) return '#F09595';
  return '#E24B4A';
}

export function getFitClass(score) {
  if (score >= 85) return 'vl';
  if (score >= 70) return 'l';
  if (score >= 55) return 'm';
  if (score >= 40) return 'h';
  return 'vh';
}

/* ── Profile summary ──────────────────────────────────────────────────── */

export function getProfileSummary(profile) {
  if (!profile) return null;
  const riskAnswers = FIT_QUESTIONS.map(q => readAnswer(profile, q.key)).filter(Boolean);
  const cCount = riskAnswers.filter(a => a === 'C').length;
  const riskLevel = cCount >= 8 ? 'Aggressive' : cCount >= 4 ? 'Moderate' : 'Conservative';

  const horizon = profile.horizon ? HORIZON_LABELS[profile.horizon] : null;
  const philosophy = profile.philosophy ? PHILOSOPHY_LABELS[profile.philosophy] : null;

  return {
    riskLevel,
    horizon,
    philosophy,
    sectors: profile.sectors || [],
    markets: profile.markets || [],
    assetTypes: profile.assetTypes || [],  // backward compat
  };
}

/* ── Profile persistence ──────────────────────────────────────────────── */

export function getProfile() {
  try { return JSON.parse(localStorage.getItem('glorisk-profile')); } catch { return null; }
}
export function saveProfile(profile) {
  localStorage.setItem('glorisk-profile', JSON.stringify(profile));
}
