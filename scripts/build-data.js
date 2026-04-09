/**
 * GloRisk — Data Build Script v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads data/raw/fundamentals.csv and produces public/data/coins.json with
 * all 36 risk indicators derived from the snapshot.
 *
 * Usage:  node scripts/build-data.js
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  THRESHOLDS,
  CATEGORIES,
  scoreHighBad,
  scoreLowBad,
  scoreLowBadInclusive,
  IND_ORDER,
} from '../src/js/riskEngine.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR     = path.join(__dirname, '../data/raw');
const PUBLIC_DATA = path.join(__dirname, '../public/data');

/* ── CSV parser ──────────────────────────────────────────────────────────── */

function parseCSV(filepath) {
  const text  = fs.readFileSync(filepath, 'utf8');
  const lines = text.split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    if (vals.length >= 2) rows.push(vals);
  }
  return { headers, rows };
}

function parseCSVLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

/* ── Country → region mapping ────────────────────────────────────────────── */

const COUNTRY_REGION = {
  'United States': 'US',
  'Canada': 'CA',
  'United Kingdom': 'UK',
  'Ireland': 'UK',
  'Germany': 'EU',
  'France': 'EU',
  'Netherlands': 'EU',
  'Switzerland': 'EU',
  'Italy': 'EU',
  'Spain': 'EU',
  'Sweden': 'EU',
  'Norway': 'EU',
  'Finland': 'EU',
  'Denmark': 'EU',
  'Belgium': 'EU',
  'Austria': 'EU',
  'Luxembourg': 'EU',
  'Portugal': 'EU',
  'Poland': 'EU',
  'Greece': 'EU',
  'Czech Republic': 'EU',
  'Hungary': 'EU',
  'Japan': 'JP',
  'South Korea': 'KR',
  'Korea': 'KR',
  'China': 'CN',
  'Hong Kong': 'HK',
  'Taiwan': 'TW',
  'India': 'IN',
  'Singapore': 'SG',
  'Australia': 'AU',
  'New Zealand': 'AU',
  'Brazil': 'LATAM',
  'Mexico': 'LATAM',
  'Argentina': 'LATAM',
  'Chile': 'LATAM',
  'Colombia': 'LATAM',
  'Peru': 'LATAM',
  'South Africa': 'AF',
  'Nigeria': 'AF',
  'Kenya': 'AF',
  'Egypt': 'AF',
  'Saudi Arabia': 'ME',
  'United Arab Emirates': 'ME',
  'Israel': 'ME',
  'Turkey': 'ME',
  'Qatar': 'ME',
  'Kuwait': 'ME',
  'Indonesia': 'SEA',
  'Thailand': 'SEA',
  'Malaysia': 'SEA',
  'Philippines': 'SEA',
  'Vietnam': 'SEA',
};

function countryToRegion(country) {
  return COUNTRY_REGION[country] || 'Other';
}

const MAJOR_INDICES = new Set([
  'S&P 500',
  'NASDAQ 100',
  'Dow Jones Industrial Average',
  'Russell 2000',
  'Russell 1000',
  'Russell 3000',
  'FTSE 100',
  'Nikkei 225',
  'Hang Seng Index',
  'DAX',
  'CAC 40',
  'S&P/ASX 200',
  'S&P/TSX Composite',
  'KOSPI',
  'KOSDAQ Composite',
  'Sensex',
  'NIFTY 50',
  'Tadawul All Shares',
]);

// Strip a derived indicator down to { color, raw } for the frontend.
function compactInd(inds) {
  const out = {};
  for (const [k, v] of Object.entries(inds)) {
    out[k] = { color: v.color, raw: +v.raw.toFixed(2) };
  }
  return out;
}

/* ── Fundamentals row parser ─────────────────────────────────────────────── */

function makeFieldGetters(headers) {
  const get = (row, key) => {
    const idx = headers.indexOf(key);
    if (idx === -1) return '';
    return (row[idx] || '').trim();
  };
  const num = (row, key) => {
    const s = get(row, key);
    if (s === '' || s === 'N/A') return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };
  return { get, num };
}

function parseFundamentalsRow(row, headers) {
  const { get, num } = makeFieldGetters(headers);
  const ticker = get(row, 'Symbol');
  const price  = num(row, 'Price');
  if (!ticker || price == null || price <= 0) return null;

  return {
    ticker,
    company:  get(row, 'Description') || ticker,
    sector:   get(row, 'Sector')   || 'Unknown',
    industry: get(row, 'Industry') || null,
    country:  get(row, 'Country or region of registration') || null,
    currency: get(row, 'Price - Currency') || 'USD',
    price,
    priceChange1D: num(row, 'Price Change % 1 day'),
    // Volatility
    volatility1D: num(row, 'Volatility 1 day'),
    volatility1W: num(row, 'Volatility 1 week'),
    volatility1M: num(row, 'Volatility 1 month'),
    // Moving averages
    sma50:  num(row, 'Simple Moving Average (50) 1 day'),
    sma200: num(row, 'Simple Moving Average (200) 1 day'),
    // Performance
    perf1W: num(row, 'Performance % 1 week'),
    perf1M: num(row, 'Performance % 1 month'),
    perf3M: num(row, 'Performance % 3 months'),
    perf6M: num(row, 'Performance % 6 months'),
    perfYTD: num(row, 'Performance % Year to date'),
    perf1Y: num(row, 'Performance % 1 year'),
    perf5Y: num(row, 'Performance % 5 years'),
    perfAT: num(row, 'Performance % All Time'),
    // Highs and lows
    high1M:      num(row, 'High 1 month'),
    high3M:      num(row, 'High 3 months'),
    high6M:      num(row, 'High 6 months'),
    high52w:     num(row, 'High 52 weeks'),
    highAllTime: num(row, 'High All Time'),
    low3M:       num(row, 'Low 3 months'),
    low6M:       num(row, 'Low 6 months'),
    low52w:      num(row, 'Low 52 weeks'),
    lowAllTime:  num(row, 'Low All Time'),
    // Fundamentals
    marketCap:      num(row, 'Market capitalization'),
    beta:           num(row, 'Beta 5 years'),
    debtToEquity:   num(row, 'Debt to equity ratio, Annual'),
    debtToRevenue:  num(row, 'Debt to revenue ratio, Annual'),
    ebitda:         num(row, 'EBITDA, Annual'),
    grossProfit:    num(row, 'Gross profit, Annual'),
    netIncome:      num(row, 'Net income, Annual'),
    fcf:            num(row, 'Free cash flow, Annual'),
    epsBasic:       num(row, 'Earnings per share basic, Annual'),
    epsDiluted:     num(row, 'Earnings per share diluted, Annual'),
    // Volume & liquidity
    gap1M:       num(row, 'Gap % 1 month'),
    volChg1W:    num(row, 'Volume Change % 1 week'),
    volChg1M:    num(row, 'Volume Change % 1 month'),
    relVolIntra: num(row, 'Relative Volume at Time'),
    relVol1M:    num(row, 'Relative Volume 1 month'),
    // Sentiment
    analystRating: get(row, 'Analyst Rating') || null,
    // Index membership
    indicesList: (get(row, 'Index') || '').split(',').map(s => s.trim()).filter(Boolean),
  };
}

/* ── Indicator derivation — all 36 from snapshot fields ──────────────────── */

function deriveIndicators(f) {
  const inds = {};
  const T = THRESHOLDS;

  /* ═══════════════════════════════════════════════════════════════════════
   * CATEGORY 1: Market Risk (6 indicators)
   * ═══════════════════════════════════════════════════════════════════════ */

  // 1. beta — market sensitivity
  if (f.beta != null) {
    inds.beta = {
      raw: +f.beta.toFixed(4),
      ...scoreHighBad(f.beta, T.beta.greenBelow, T.beta.amberBelow),
    };
  }

  // 3. range52W — position in 52-week band
  if (f.high52w != null && f.low52w != null && f.high52w > f.low52w) {
    const rng = (f.price - f.low52w) / (f.high52w - f.low52w) * 100;
    const clamped = Math.max(0, Math.min(100, rng));
    inds.range52W = {
      raw: +clamped.toFixed(4),
      ...scoreLowBad(clamped, T.range52W.greenAbove, T.range52W.amberAbove),
    };
  }

  // 4. vsPeak — distance from all-time high
  if (f.highAllTime != null && f.highAllTime > 0) {
    const drawdown = Math.max(0, (1 - f.price / f.highAllTime) * 100);
    inds.vsPeak = {
      raw: +drawdown.toFixed(4),
      ...scoreHighBad(drawdown, T.vsPeak.greenBelow, T.vsPeak.amberBelow),
    };
  }

  // 2. betaDrawdown — downside risk score (depends on beta + vsPeak)
  if (inds.beta && inds.vsPeak) {
    const raw = f.beta * (inds.vsPeak.raw / 100);
    const scaled = Math.min(10, Math.max(1, raw * 10));
    inds.betaDrawdown = {
      raw: +scaled.toFixed(4),
      ...scoreHighBad(scaled, T.betaDrawdown.greenBelow, T.betaDrawdown.amberBelow),
    };
  }

  // 5. perf6M — 6-month return
  if (f.perf6M != null) {
    inds.perf6M = {
      raw: +f.perf6M.toFixed(4),
      ...scoreLowBad(f.perf6M, T.perf6M.greenAbove, T.perf6M.amberAbove),
    };
  }

  // 6. perfYTD — year-to-date return
  if (f.perfYTD != null) {
    inds.perfYTD = {
      raw: +f.perfYTD.toFixed(4),
      ...scoreLowBad(f.perfYTD, T.perfYTD.greenAbove, T.perfYTD.amberAbove),
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * CATEGORY 2: Volatility & Momentum (8 indicators)
   * ═══════════════════════════════════════════════════════════════════════ */

  // 7. volDaily — annualised daily volatility
  const volDailyRaw = f.volatility1D ?? f.volatility1M;
  if (volDailyRaw != null && volDailyRaw >= 0) {
    const annual = volDailyRaw * Math.sqrt(252);
    inds.volDaily = {
      raw: +annual.toFixed(4),
      ...scoreHighBad(annual, T.volDaily.greenBelow, T.volDaily.amberBelow),
    };
  }

  // 8. volWeekly — annualised weekly volatility
  if (f.volatility1W != null && f.volatility1W >= 0) {
    const annual = f.volatility1W * Math.sqrt(52);
    inds.volWeekly = {
      raw: +annual.toFixed(4),
      ...scoreHighBad(annual, T.volWeekly.greenBelow, T.volWeekly.amberBelow),
    };
  }

  // 9. volMonthly — annualised monthly volatility
  if (f.volatility1M != null && f.volatility1M >= 0) {
    const annual = f.volatility1M * Math.sqrt(12);
    inds.volMonthly = {
      raw: +annual.toFixed(4),
      ...scoreHighBad(annual, T.volMonthly.greenBelow, T.volMonthly.amberBelow),
    };
  }

  // 10. volAccel — volatility acceleration (1W vs 1M)
  if (f.volatility1W != null && f.volatility1M != null && f.volatility1M > 0) {
    const ratio = f.volatility1W / f.volatility1M;
    inds.volAccel = {
      raw: +ratio.toFixed(4),
      ...scoreHighBad(ratio, T.volAccel.greenBelow, T.volAccel.amberBelow),
    };
  }

  // 11. sharpe1M — risk-adjusted return proxy (1 month)
  if (f.perf1M != null && f.volatility1M != null && f.volatility1M > 0) {
    const annualisedVol = f.volatility1M * Math.sqrt(12);
    if (annualisedVol > 0) {
      const sharpe = f.perf1M / annualisedVol;
      inds.sharpe1M = {
        raw: +sharpe.toFixed(4),
        ...scoreLowBad(sharpe, T.sharpe1M.greenAbove, T.sharpe1M.amberAbove),
      };
    }
  }

  // 12. sharpe1Y — risk-adjusted return proxy (1 year)
  if (f.perf1Y != null && f.volatility1M != null && f.volatility1M > 0) {
    const annualisedVol = f.volatility1M * Math.sqrt(12);
    if (annualisedVol > 0) {
      const sharpe = f.perf1Y / annualisedVol;
      inds.sharpe1Y = {
        raw: +sharpe.toFixed(4),
        ...scoreLowBad(sharpe, T.sharpe1Y.greenAbove, T.sharpe1Y.amberAbove),
      };
    }
  }

  // 13. gapRisk — overnight gap risk
  if (f.gap1M != null) {
    const absGap = Math.abs(f.gap1M);
    inds.gapRisk = {
      raw: +absGap.toFixed(4),
      ...scoreHighBad(absGap, T.gapRisk.greenBelow, T.gapRisk.amberBelow),
    };
  }

  // 14. rangeWidth — annual swing width
  if (f.high52w != null && f.low52w != null && f.low52w > 0) {
    const width = (f.high52w - f.low52w) / f.low52w * 100;
    inds.rangeWidth = {
      raw: +width.toFixed(4),
      ...scoreHighBad(width, T.rangeWidth.greenBelow, T.rangeWidth.amberBelow),
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * CATEGORY 3: Trend & Technical (7 indicators)
   * ═══════════════════════════════════════════════════════════════════════ */

  // 15. maCross — trend signal (Golden vs Death Cross)
  if (f.sma50 != null && f.sma200 != null && f.sma200 > 0) {
    const ratio = f.sma50 / f.sma200;
    const isGolden = ratio >= T.maCross.goldenCrossAt;
    inds.maCross = {
      raw: +ratio.toFixed(4),
      color: isGolden ? 'green' : 'red',
      pts: isGolden ? 0 : 2,
    };
  }

  // 16. shortTrend — price vs 50-day MA
  if (f.sma50 != null && f.sma50 > 0) {
    const st = (f.price / f.sma50 - 1) * 100;
    inds.shortTrend = {
      raw: +st.toFixed(4),
      ...scoreLowBad(st, T.shortTrend.greenAbove, T.shortTrend.amberAbove),
    };
  }

  // 17. longTrend — price vs 200-day MA
  if (f.sma200 != null && f.sma200 > 0) {
    const lt = (f.price / f.sma200 - 1) * 100;
    inds.longTrend = {
      raw: +lt.toFixed(4),
      ...scoreLowBad(lt, T.longTrend.greenAbove, T.longTrend.amberAbove),
    };
  }

  // 18. momDiv — momentum divergence (weekly vs monthly annualised)
  if (f.perf1W != null && f.perf1M != null) {
    const div = f.perf1W - f.perf1M / 4.33;
    inds.momDiv = {
      raw: +div.toFixed(4),
      ...scoreLowBad(div, T.momDiv.greenAbove, T.momDiv.amberAbove),
    };
  }

  // 19. perf3M — 3-month return
  if (f.perf3M != null) {
    inds.perf3M = {
      raw: +f.perf3M.toFixed(4),
      ...scoreLowBad(f.perf3M, T.perf3M.greenAbove, T.perf3M.amberAbove),
    };
  }

  // 20. nearHigh1M — distance from recent (1-month) high
  if (f.high1M != null && f.high1M > 0) {
    const dist = Math.max(0, (1 - f.price / f.high1M) * 100);
    inds.nearHigh1M = {
      raw: +dist.toFixed(4),
      ...scoreHighBad(dist, T.nearHigh1M.greenBelow, T.nearHigh1M.amberBelow),
    };
  }

  // 21. nearLow3M — distance from 3-month low
  if (f.low3M != null && f.low3M > 0) {
    const dist = (f.price / f.low3M - 1) * 100;
    inds.nearLow3M = {
      raw: +dist.toFixed(4),
      ...scoreLowBad(dist, T.nearLow3M.greenAbove, T.nearLow3M.amberAbove),
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * CATEGORY 4: Fundamental (7 indicators)
   * ═══════════════════════════════════════════════════════════════════════ */

  // 22. debtEquity — debt to equity ratio
  if (f.debtToEquity != null && f.debtToEquity >= 0) {
    inds.debtEquity = {
      raw: +f.debtToEquity.toFixed(4),
      ...scoreHighBad(f.debtToEquity, T.debtEquity.greenBelow, T.debtEquity.amberBelow),
    };
  }

  // 23. debtRevenue — debt to revenue ratio
  if (f.debtToRevenue != null && f.debtToRevenue >= 0) {
    inds.debtRevenue = {
      raw: +f.debtToRevenue.toFixed(4),
      ...scoreHighBad(f.debtToRevenue, T.debtRevenue.greenBelow, T.debtRevenue.amberBelow),
    };
  }

  // 24. ebitdaMargin — EBITDA / gross profit
  if (f.ebitda != null && f.grossProfit != null && f.grossProfit > 0) {
    const margin = f.ebitda / f.grossProfit;
    inds.ebitdaMargin = {
      raw: +margin.toFixed(4),
      ...scoreLowBad(margin, T.ebitdaMargin.greenAbove, T.ebitdaMargin.amberAbove),
    };
  }

  // 25. fcfYield — free cash flow / market cap × 100
  if (f.fcf != null && f.marketCap != null && f.marketCap > 0) {
    const yld = f.fcf / f.marketCap * 100;
    inds.fcfYield = {
      raw: +yld.toFixed(4),
      ...scoreLowBad(yld, T.fcfYield.greenAbove, T.fcfYield.amberAbove),
    };
  }

  // 26. epsDilution — (basic - diluted) / abs(basic) × 100
  if (f.epsBasic != null && f.epsDiluted != null && f.epsBasic !== 0) {
    const dilution = (f.epsBasic - f.epsDiluted) / Math.abs(f.epsBasic) * 100;
    inds.epsDilution = {
      raw: +dilution.toFixed(4),
      ...scoreHighBad(dilution, T.epsDilution.greenBelow, T.epsDilution.amberBelow),
    };
  }

  // 27. earningsQuality — net income / EBITDA
  if (f.netIncome != null && f.ebitda != null && f.ebitda !== 0) {
    const eq = f.netIncome / f.ebitda;
    inds.earningsQuality = {
      raw: +eq.toFixed(4),
      ...scoreLowBad(eq, T.earningsQuality.greenAbove, T.earningsQuality.amberAbove),
    };
  }

  // 28. profitValuation — gross profit / market cap × 100
  if (f.grossProfit != null && f.marketCap != null && f.marketCap > 0) {
    const pv = f.grossProfit / f.marketCap * 100;
    inds.profitValuation = {
      raw: +pv.toFixed(4),
      ...scoreLowBad(pv, T.profitValuation.greenAbove, T.profitValuation.amberAbove),
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * CATEGORY 5: Liquidity (5 indicators)
   * ═══════════════════════════════════════════════════════════════════════ */

  // 29. volChg1W — weekly volume change
  if (f.volChg1W != null) {
    inds.volChg1W = {
      raw: +f.volChg1W.toFixed(4),
      ...scoreLowBad(f.volChg1W, T.volChg1W.greenAbove, T.volChg1W.amberAbove),
    };
  }

  // 30. volChg1M — monthly volume change
  if (f.volChg1M != null) {
    inds.volChg1M = {
      raw: +f.volChg1M.toFixed(4),
      ...scoreLowBad(f.volChg1M, T.volChg1M.greenAbove, T.volChg1M.amberAbove),
    };
  }

  // 31. relVolIntra — relative volume at time (intraday)
  if (f.relVolIntra != null) {
    inds.relVolIntra = {
      raw: +f.relVolIntra.toFixed(4),
      ...scoreLowBad(f.relVolIntra, T.relVolIntra.greenAbove, T.relVolIntra.amberAbove),
    };
  }

  // 32. relVol1M — relative volume 1 month
  if (f.relVol1M != null) {
    inds.relVol1M = {
      raw: +f.relVol1M.toFixed(4),
      ...scoreLowBad(f.relVol1M, T.relVol1M.greenAbove, T.relVol1M.amberAbove),
    };
  }

  // 33. capTier — market cap tier (encoded as 1–5 for compact storage)
  if (f.marketCap != null && f.marketCap > 0) {
    let tier, color;
    if (f.marketCap >= 200e9)      { tier = 5; color = 'green'; }  // Mega
    else if (f.marketCap >= 10e9)  { tier = 4; color = 'green'; }  // Large
    else if (f.marketCap >= 2e9)   { tier = 3; color = 'amber'; }  // Mid
    else if (f.marketCap >= 300e6) { tier = 2; color = 'red'; }    // Small
    else                           { tier = 1; color = 'red'; }    // Micro
    inds.capTier = { raw: tier, color, pts: color === 'green' ? 0 : color === 'amber' ? 1 : 2 };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * CATEGORY 6: Sentiment (3 indicators)
   * ═══════════════════════════════════════════════════════════════════════ */

  // 34. analystRating — map string to numeric code + color
  if (f.analystRating) {
    const ratingMap = {
      'Strong buy': { raw: 5, color: 'green' },
      'Buy':        { raw: 4, color: 'green' },
      'Hold':       { raw: 3, color: 'amber' },
      'Sell':       { raw: 2, color: 'red' },
      'Strong sell': { raw: 1, color: 'red' },
    };
    const m = ratingMap[f.analystRating];
    if (m) {
      inds.analystRating = { raw: m.raw, color: m.color, pts: m.color === 'green' ? 0 : m.color === 'amber' ? 1 : 2 };
    }
  }

  // 35. trendHealth — alignment of 1Y and 5Y performance
  if (f.perf1Y != null && f.perf5Y != null) {
    const totalRet5Y = f.perf5Y / 100;
    let cagr5Y;
    if (totalRet5Y <= -1) { cagr5Y = -100; }
    else { cagr5Y = (Math.pow(1 + totalRet5Y, 1 / 5) - 1) * 100; }

    let color, raw;
    if (f.perf1Y > 0 && cagr5Y > 0) { color = 'green'; raw = 1; }       // aligned positive
    else if (f.perf1Y < 0 && cagr5Y < 0) { color = 'red'; raw = -1; }   // aligned negative
    else { color = 'amber'; raw = 0; }                                     // mixed
    inds.trendHealth = { raw, color, pts: color === 'green' ? 0 : color === 'amber' ? 1 : 2 };
  }

  // 36. volPriceConfirm — volume confirms price direction
  if (f.perf1W != null && f.volChg1W != null) {
    const priceUp = f.perf1W > 0;
    const volUp   = f.volChg1W > 0;
    let color;
    if (priceUp && volUp)   color = 'green';  // confirmed rally
    else if (!priceUp && !volUp) color = 'green';  // confirmed decline (clear signal)
    else if (priceUp && !volUp)  color = 'amber';  // rally on declining volume (weak)
    else                         color = 'red';     // selling on rising volume (bearish)
    const raw = color === 'green' ? 1 : color === 'amber' ? 0 : -1;
    inds.volPriceConfirm = { raw, color, pts: color === 'green' ? 0 : color === 'amber' ? 1 : 2 };
  }

  return inds;
}

/* ── Main build ──────────────────────────────────────────────────────────── */

function main() {
  console.log('GloRisk build v2 — reading fundamentals.csv\u2026\n');

  fs.mkdirSync(PUBLIC_DATA, { recursive: true });

  const filepath = path.join(RAW_DIR, 'fundamentals.csv');
  if (!fs.existsSync(filepath)) {
    console.error('  fundamentals.csv not found \u2014 aborting build');
    process.exit(1);
  }

  const { headers, rows } = parseCSV(filepath);
  console.log(`  Loaded ${rows.length} rows, ${headers.length} columns`);

  const coins = [];
  let skipped = 0;

  for (const row of rows) {
    const f = parseFundamentalsRow(row, headers);
    if (!f) { skipped++; continue; }

    const indicators = deriveIndicators(f);
    // Require at least 12 of 36 indicators (~33%) — otherwise the row is too thin
    if (Object.keys(indicators).length < 12) { skipped++; continue; }

    coins.push({
      ticker: f.ticker,
      company: f.company,
      sector: f.sector,
      industry: f.industry,
      country: f.country,
      region: countryToRegion(f.country),
      currency: f.currency,
      price: +f.price.toFixed(4),
      priceChange: f.priceChange1D != null ? +f.priceChange1D.toFixed(2) : 0,
      marketCap: f.marketCap != null ? +f.marketCap.toFixed(0) : null,
      beta: f.beta != null ? +f.beta.toFixed(2) : null,
      analystRating: f.analystRating,
      indices: (f.indicesList || []).filter(i => MAJOR_INDICES.has(i)),
      high52w: f.high52w != null ? +f.high52w.toFixed(4) : null,
      low52w:  f.low52w  != null ? +f.low52w.toFixed(4)  : null,
      highAllTime: f.highAllTime != null ? +f.highAllTime.toFixed(4) : null,
      lowAllTime:  f.lowAllTime  != null ? +f.lowAllTime.toFixed(4)  : null,
      indicators: compactInd(indicators),
    });
  }

  console.log(`  Built ${coins.length} stocks, ${skipped} skipped (bad price / insufficient indicators)\n`);

  const output = {
    asOf:  new Date().toISOString().split('T')[0] + 'T00:00:00Z',
    built: new Date().toISOString(),
    total: coins.length,
    coins,
  };

  const catalogPath = path.join(PUBLIC_DATA, 'coins.json');
  fs.writeFileSync(catalogPath, JSON.stringify(output));
  const sizeMB = (fs.statSync(catalogPath).size / 1024 / 1024).toFixed(1);
  console.log(`\u2713 Built ${coins.length} assets \u2192 public/data/coins.json (${sizeMB} MB)\n`);

  // Region breakdown
  const regions = {};
  for (const c of coins) {
    regions[c.region] = (regions[c.region] || 0) + 1;
  }
  console.log('Region breakdown:');
  for (const [r, n] of Object.entries(regions).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r.padEnd(8)} ${n}`);
  }

  // Indicator completeness
  const total36 = IND_ORDER.length;
  const completeCount = coins.filter(c =>
    IND_ORDER.every(k => c.indicators[k])
  ).length;
  const avgCount = coins.length > 0
    ? (coins.reduce((s, c) => s + Object.keys(c.indicators).length, 0) / coins.length).toFixed(1)
    : 0;
  console.log(`\nIndicator coverage (${total36} indicators):`);
  console.log(`  Complete (${total36}/${total36}): ${completeCount}/${coins.length} (${coins.length ? ((completeCount/coins.length)*100).toFixed(0) : 0}%)`);
  console.log(`  Average indicators per stock: ${avgCount}`);

  // Category coverage
  for (const cat of CATEGORIES) {
    const catComplete = coins.filter(c =>
      cat.keys.every(k => c.indicators[k])
    ).length;
    console.log(`  ${cat.label.padEnd(24)} ${catComplete}/${coins.length} complete (${coins.length ? ((catComplete/coins.length)*100).toFixed(0) : 0}%)`);
  }

  // Clean up stale artefacts
  const stalePaths = [
    path.join(PUBLIC_DATA, 'universe.json'),
    path.join(PUBLIC_DATA, 'changes.json'),
  ];
  for (const p of stalePaths) {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log(`  Removed stale ${path.basename(p)}`);
    }
  }
  const assetsDir = path.join(PUBLIC_DATA, 'assets');
  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir);
    for (const f of files) fs.unlinkSync(path.join(assetsDir, f));
    fs.rmdirSync(assetsDir);
    console.log(`  Removed stale assets/ (${files.length} files)`);
  }
}

main();
