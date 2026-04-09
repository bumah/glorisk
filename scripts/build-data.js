/**
 * GloRisk — Data Build Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads data/raw/fundamentals.csv (a 30k-stock snapshot from TradingView-style
 * providers) and produces a single public/data/coins.json catalog with all
 * 10 risk indicators derived from the snapshot.
 *
 * Assets without closing-price history (crypto, ETFs, indices) will be added
 * back via their own input files in future commits — they're not in scope now.
 *
 * Usage:  node scripts/build-data.js
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  THRESHOLDS,
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

// Only these indices are ever used for filtering in the frontend. Everything
// else gets dropped to save ~1.7 MB in coins.json.
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

// Strip a derived indicator object down to the minimum the frontend needs.
// label is rebuilt from raw at display time; pts is unused in frontend.
function compactInd(inds) {
  const out = {};
  for (const [k, v] of Object.entries(inds)) {
    out[k] = { color: v.color, raw: +v.raw.toFixed(2) };
  }
  return out;
}

/* ── Formatters ──────────────────────────────────────────────────────────── */

function fmtPctLabel(v, d = 1) {
  if (!isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
}

/* ── Fundamentals row parser ─────────────────────────────────────────────── */

// Pick the first (lowest-index) column matching a header name — some exported
// CSVs have duplicate column names; we always use the first occurrence.
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
    // Volatility fields — prefer the daily one for our main vol indicator
    volatility1D: num(row, 'Volatility 1 day'),
    volatility1W: num(row, 'Volatility 1 week'),
    volatility1M: num(row, 'Volatility 1 month'),
    // Moving averages
    sma50:  num(row, 'Simple Moving Average (50) 1 day'),
    sma200: num(row, 'Simple Moving Average (200) 1 day'),
    // Performance horizons
    perf1M: num(row, 'Performance % 1 month'),
    perf3M: num(row, 'Performance % 3 months'),
    perf6M: num(row, 'Performance % 6 months'),
    perf1Y: num(row, 'Performance % 1 year'),
    perf5Y: num(row, 'Performance % 5 years'),
    perfAT: num(row, 'Performance % All Time'),
    // 52-week + all-time highs and lows
    high52w:   num(row, 'High 52 weeks'),
    low52w:    num(row, 'Low 52 weeks'),
    highAllTime: num(row, 'High All Time'),
    lowAllTime:  num(row, 'Low All Time'),
    high3M:    num(row, 'High 3 months'),
    low3M:     num(row, 'Low 3 months'),
    high6M:    num(row, 'High 6 months'),
    low6M:     num(row, 'Low 6 months'),
    // Fundamentals strip
    marketCap:     num(row, 'Market capitalization'),
    beta:          num(row, 'Beta 5 years'),
    analystRating: get(row, 'Analyst Rating') || null,
    // Index membership
    indicesList: (get(row, 'Index') || '').split(',').map(s => s.trim()).filter(Boolean),
  };
}

/* ── Indicator derivation — all 10 from snapshot fields ──────────────────── */

function deriveIndicators(f) {
  const inds = {};

  // 1. volatility — annualise daily vol (more accurate than 1-month)
  const volDaily = f.volatility1D ?? f.volatility1M;  // fallback to monthly if daily missing
  if (volDaily != null && volDaily >= 0) {
    const annual = volDaily * Math.sqrt(252);
    inds.volatility = {
      raw: +annual.toFixed(4),
      label: annual.toFixed(1) + '%',
      ...scoreHighBad(annual, THRESHOLDS.volatility.greenBelow, THRESHOLDS.volatility.amberBelow),
    };
  }

  // 2. volSpike — recent (1-week) vol vs baseline (1-month)
  if (f.volatility1W != null && f.volatility1M != null && f.volatility1M > 0) {
    const ratio = f.volatility1W / f.volatility1M;
    inds.volSpike = {
      raw: +ratio.toFixed(4),
      label: ratio.toFixed(2) + '×',
      ...scoreHighBad(ratio, THRESHOLDS.volSpike.greenBelow, THRESHOLDS.volSpike.amberBelow),
    };
  }

  // 3. vsPeak — distance from all-time high (was "3-year peak", now uses AT high)
  if (f.highAllTime != null && f.highAllTime > 0) {
    const drawdown = Math.max(0, (1 - f.price / f.highAllTime) * 100);
    inds.vsPeak = {
      raw: +drawdown.toFixed(4),
      label: '-' + drawdown.toFixed(1) + '%',
      ...scoreHighBad(drawdown, THRESHOLDS.vsPeak.greenBelow, THRESHOLDS.vsPeak.amberBelow),
    };
  }

  // 4. shortTrend — price vs 50-day MA
  if (f.sma50 != null && f.sma50 > 0) {
    const st = (f.price / f.sma50 - 1) * 100;
    inds.shortTrend = {
      raw: +st.toFixed(4),
      label: fmtPctLabel(st),
      ...scoreLowBad(st, THRESHOLDS.shortTrend.greenAbove, THRESHOLDS.shortTrend.amberAbove),
    };
  }

  // 5. longTrend — price vs 200-day MA
  if (f.sma200 != null && f.sma200 > 0) {
    const lt = (f.price / f.sma200 - 1) * 100;
    inds.longTrend = {
      raw: +lt.toFixed(4),
      label: fmtPctLabel(lt),
      ...scoreLowBad(lt, THRESHOLDS.longTrend.greenAbove, THRESHOLDS.longTrend.amberAbove),
    };
  }

  // 6. maCross — SMA50 vs SMA200
  if (f.sma50 != null && f.sma200 != null && f.sma200 > 0) {
    const ratio = f.sma50 / f.sma200;
    const isGolden = ratio >= THRESHOLDS.maCross.goldenCrossAt;
    inds.maCross = {
      raw: +ratio.toFixed(4),
      label: isGolden ? 'Golden Cross' : 'Death Cross',
      color: isGolden ? 'green' : 'red',
      pts: isGolden ? 0 : 2,
    };
  }

  // 7. return1M — Performance % 1 month
  if (f.perf1M != null) {
    inds.return1M = {
      raw: +f.perf1M.toFixed(4),
      label: fmtPctLabel(f.perf1M),
      ...scoreLowBadInclusive(f.perf1M, THRESHOLDS.return1M.greenAbove, THRESHOLDS.return1M.amberAbove),
    };
  }

  // 8. return1Y — Performance % 1 year
  if (f.perf1Y != null) {
    inds.return1Y = {
      raw: +f.perf1Y.toFixed(4),
      label: fmtPctLabel(f.perf1Y),
      ...scoreLowBad(f.perf1Y, THRESHOLDS.return1Y.greenAbove, THRESHOLDS.return1Y.amberAbove),
    };
  }

  // 9. range52W — position in 52-week high/low band
  if (f.high52w != null && f.low52w != null && f.high52w > f.low52w) {
    const rng = (f.price - f.low52w) / (f.high52w - f.low52w) * 100;
    const clamped = Math.max(0, Math.min(100, rng));
    inds.range52W = {
      raw: +clamped.toFixed(4),
      label: clamped.toFixed(0) + '%',
      ...scoreLowBad(clamped, THRESHOLDS.range52W.greenAbove, THRESHOLDS.range52W.amberAbove),
    };
  }

  // 10. cagr5Y — annualise Performance % 5 years (was cagr3Y, renamed)
  if (f.perf5Y != null) {
    // total return over 5 years → CAGR: (1 + r)^(1/5) - 1
    const totalRet = f.perf5Y / 100;
    let cagr;
    if (totalRet <= -1) {
      // Catastrophic loss: can't take a real root, flag as -100%
      cagr = -100;
    } else {
      cagr = (Math.pow(1 + totalRet, 1 / 5) - 1) * 100;
    }
    inds.cagr5Y = {
      raw: +cagr.toFixed(4),
      label: fmtPctLabel(cagr),
      color: cagr > THRESHOLDS.cagr5Y.greenAbove ? 'green' : 'red',
      pts: cagr > THRESHOLDS.cagr5Y.greenAbove ? 0 : 2,
    };
  }

  return inds;
}

/* ── Main build ──────────────────────────────────────────────────────────── */

function main() {
  console.log('GloRisk build — reading fundamentals.csv…\n');

  // Ensure output directory exists
  fs.mkdirSync(PUBLIC_DATA, { recursive: true });

  const filepath = path.join(RAW_DIR, 'fundamentals.csv');
  if (!fs.existsSync(filepath)) {
    console.error('  fundamentals.csv not found — aborting build');
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
    // Require at least 6 of 10 indicators — otherwise the row is too thin
    if (Object.keys(indicators).length < 6) { skipped++; continue; }

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
  const sizeKB = (fs.statSync(catalogPath).size / 1024).toFixed(0);
  console.log(`✓ Built ${coins.length} assets → public/data/coins.json (${sizeKB} KB)\n`);

  // Summary by region
  const regions = {};
  for (const c of coins) {
    regions[c.region] = (regions[c.region] || 0) + 1;
  }
  console.log('Region breakdown:');
  for (const [r, n] of Object.entries(regions).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r.padEnd(8)} ${n}`);
  }

  // Indicator completeness — how many stocks have all 10 indicators
  const completeCount = coins.filter(c => {
    return IND_ORDER.every(k => k === 'momentum' ? true : c.indicators[k]);
  }).length;
  console.log(`\nIndicator coverage:`);
  console.log(`  Complete (10/10): ${completeCount}/${coins.length} (${((completeCount/coins.length)*100).toFixed(0)}%)`);

  // Clean up stale build artefacts from the retired core pipeline
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
