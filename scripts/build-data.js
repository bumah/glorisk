/**
 * GloRisk — Data Build Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads all closing price CSVs + ticker metadata and produces:
 *   public/data/coins.json          — lightweight catalog (no price arrays)
 *   public/data/assets/{TICKER}.json — per-asset price history + MAs
 *
 * Usage:  node scripts/build-data.js
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  computeCategoryA,
  computeIndicatorsFromPrices,
  computeMood,
  sma,
  IND_ORDER,
  IND_META,
  MOOD_BANDS,
} from '../src/js/riskEngine.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR    = path.join(__dirname, '../data/raw');
const PUBLIC_DATA = path.join(__dirname, '../public/data');
const ASSETS_DIR  = path.join(PUBLIC_DATA, 'assets');

/* ── Crypto name lookup ──────────────────────────────────────────────────── */

const CRYPTO_NAMES = {
  AAVE:'Aave', ADA:'Cardano', ALGO:'Algorand', APT:'Aptos', AR:'Arweave',
  ARB:'Arbitrum', ATOM:'Cosmos', AVAX:'Avalanche', BCH:'Bitcoin Cash',
  BNB:'BNB', BONK:'Bonk', BTC:'Bitcoin', CFX:'Conflux', DOGE:'Dogecoin',
  DOT:'Polkadot', EGLD:'MultiversX', ETH:'Ethereum', FET:'Fetch.ai',
  FIL:'Filecoin', FLOKI:'Floki', FTM:'Fantom', GRT:'The Graph',
  HBAR:'Hedera', ICP:'Internet Computer', IMX:'Immutable X', INJ:'Injective',
  KAVA:'Kava', LINK:'Chainlink', LTC:'Litecoin', MKR:'Maker', NEAR:'NEAR Protocol',
  OP:'Optimism', PEPE:'Pepe', QNT:'Quant', RNDR:'Render', RUNE:'THORChain',
  SEI:'Sei', SHIB:'Shiba Inu', SOL:'Solana', STX:'Stacks', SUI:'Sui',
  TAO:'Bittensor', THETA:'Theta Network', TON:'Toncoin', TRX:'TRON',
  UNI:'Uniswap', VET:'VeChain', WIF:'dogwifhat', WLD:'Worldcoin',
  XLM:'Stellar', XMR:'Monero', XRP:'XRP', ZEC:'Zcash',
  '1INCH':'1inch', ANKR:'Ankr', APE:'ApeCoin', AXS:'Axie Infinity',
  BAL:'Balancer', BAND:'Band Protocol', BAT:'Basic Attention Token',
  BLUR:'Blur', CELO:'Celo', CELR:'Celer Network', CHZ:'Chiliz',
  COMP:'Compound', CRV:'Curve DAO', CVX:'Convex Finance', DASH:'Dash',
  DYDX:'dYdX', ENJ:'Enjin Coin', ETC:'Ethereum Classic', FLOW:'Flow',
  GALA:'Gala', GMT:'STEPN', GMX:'GMX', ID:'SPACE ID', IOTA:'IOTA',
  JASMY:'JasmyCoin', KSM:'Kusama', LDO:'Lido DAO', LQTY:'Liquity',
  LRC:'Loopring', MAGIC:'Magic', MANA:'Decentraland', MASK:'Mask Network',
  MINA:'Mina Protocol', NEO:'NEO', OCEAN:'Ocean Protocol', ROSE:'Oasis Network',
  RPL:'Rocket Pool', SAND:'The Sandbox', SKL:'SKALE', SNX:'Synthetix',
  STORJ:'Storj', SUSHI:'SushiSwap', UMA:'UMA', WAVES:'Waves', WOO:'WOO Network',
  YFI:'yearn.finance', ZIL:'Zilliqa', ZRX:'0x Protocol',
  ACH:'Alchemy Pay', AGIX:'SingularityNET', AKT:'Akash Network', ALT:'AltLayer',
  AUDIO:'Audius', BEAM:'Beam', BNT:'Bancor', BOME:'Book of Meme', CHR:'Chromia',
  CKB:'Nervos Network', CTSI:'Cartesi', DCR:'Decred', DYM:'Dymension',
  EOS:'EOS', FXS:'Frax Share', GLMR:'Moonbeam', GNO:'Gnosis', HIGH:'Highstreet',
  HIVE:'Hive', HOOK:'Hooked Protocol', ICX:'ICON', JTO:'Jito', JUP:'Jupiter',
  KNC:'Kyber Network', MANTA:'Manta Network', MOVR:'Moonriver', NMR:'Numeraire',
  NTRN:'Neutron', ONT:'Ontology', ORDI:'ORDI', PENDLE:'Pendle', PIXEL:'Pixels',
  PORTAL:'Portal', POWR:'Power Ledger', PRIME:'Echelon Prime', PUNDIX:'Pundi X',
  PYTH:'Pyth Network', QTUM:'Qtum', REN:'Ren', SC:'Siacoin', SSV:'SSV Network',
  STEEM:'Steem', STRK:'Stark', SUPER:'SuperVerse', TIA:'Celestia',
  XDC:'XDC Network', XTZ:'Tezos', AION:'Aion', ALCX:'Alchemix',
  ALPACA:'Alpaca Finance', ARPA:'ARPA', BADGER:'Badger DAO', BEL:'Bella Protocol',
  BETA:'Beta Finance', BICO:'Biconomy', BOND:'BarnBridge', BTRST:'Braintrust',
  BURGER:'BurgerCities', CHESS:'Tranchess', COCOS:'Cocos-BCX', CYBER:'CyberConnect',
  DODO:'DODO', DUSK:'Dusk Network', ERN:'Ethernity Chain', FARM:'Harvest Finance',
  FIO:'FIO Protocol', FOR:'ForTube', FORTH:'Ampleforth Governance', IDEX:'IDEX',
  IRIS:'IRISnet', KLAY:'Klaytn', LSK:'Lisk', LTO:'LTO Network', MDT:'Measurable Data',
  MDX:'Mdex', MIR:'Mirror Protocol', NKN:'NKN', NULS:'NULS', OGN:'Origin Protocol',
  ORN:'Orion Protocol', PERP:'Perpetual Protocol', PLA:'PlayDapp', POLS:'Polkastarter',
  RLY:'Rally', SCRT:'Secret', SLP:'Smooth Love Potion', SPELL:'Spell Token',
  STPT:'STP', SXP:'Solar', TOMO:'TomoChain', TORN:'Tornado Cash',
  VELO:'Velo', VRA:'Verasity', WAXP:'WAX', XCN:'Chain',
  NEXO:'Nexo', ENA:'Ethena', ONDO:'Ondo Finance', GT:'Gate Token', MNT:'Mantle',
  KAS:'Kaspa', RENDER:'Render', POL:'Polygon',
};

/* ── Index name lookup ───────────────────────────────────────────────────── */

const INDEX_NAMES = {
  SP500:     'S&P 500 Index',
  FTSE100:   'FTSE 100 Index',
  HSI:       'Hang Seng Index',
  Nikkei225: 'Nikkei 225 Index',
};

/* ── Group/exchange detection from filename ──────────────────────────────── */

const FILE_OVERRIDES = {
  '00_INDEX': { group: 'Index',      exchange: 'Global' },
  'Crypto':   { group: 'Crypto',     exchange: 'Crypto' },
  'SP500':    { group: 'SP500',      exchange: 'US' },
  'FTSE100':  { group: 'FTSE100',    exchange: 'UK' },
  'Nikkei225':{ group: 'Nikkei225',  exchange: 'JP' },
  'HSI':      { group: 'HSI',        exchange: 'HK' },
  'ETFs':     { group: 'SectorETFs', exchange: 'US' },
};

function detectGroupAndExchange(filename) {
  const base = filename.replace('_closing_prices.csv', '');
  return FILE_OVERRIDES[base] || { group: base, exchange: 'Unknown' };
}

/* ── CSV parser ──────────────────────────────────────────────────────────── */

function parseCSV(filepath) {
  const text    = fs.readFileSync(filepath, 'utf8');
  const lines   = text.split('\n').filter(l => l.trim());
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

/* ── Extract one ticker's price series from a parsed CSV ─────────────────── */

function extractSeries(parsed, ticker) {
  const colIdx = parsed.headers.indexOf(ticker);
  if (colIdx === -1) return null;

  const prices = [];
  for (const row of parsed.rows) {
    const date = row[0];
    const val  = parseFloat(row[colIdx]);
    if (!date) continue;
    if (!isNaN(val) && val > 0) {
      prices.push({ d: date, p: val });
    }
  }
  return prices.length > 0 ? prices : null;
}

/* ── 30D price change ────────────────────────────────────────────────────── */

function compute30DChange(prices) {
  const n = prices.length;
  if (n < 32) return 0;
  const last = prices[n - 1].p;
  const prev = prices[n - 31].p;
  return prev > 0 ? +((last / prev - 1) * 100).toFixed(2) : 0;
}

/* ── Name resolver factory ───────────────────────────────────────────────── */

function makeNameResolver(group, tickerNames) {
  if (group === 'Crypto') {
    return (rawTicker) => {
      const clean = rawTicker.replace('-USD', '');
      return {
        ticker: clean,
        name: CRYPTO_NAMES[clean] || clean,
        sector: 'Cryptocurrency',
      };
    };
  }
  if (group === 'Index') {
    return (rawTicker) => {
      const named = tickerNames[rawTicker];
      return {
        ticker: rawTicker,
        name: INDEX_NAMES[rawTicker] || named?.name || rawTicker,
        sector: named?.sector || 'Broad Market Index',
      };
    };
  }
  // Default: stock/ETF resolver
  return (rawTicker) => {
    const entry = tickerNames[rawTicker];
    return {
      ticker: rawTicker,
      name: entry?.name || rawTicker,
      sector: entry?.sector || 'Unknown',
    };
  };
}

/* ── Process one CSV file ────────────────────────────────────────────────── */

function processFile(csvFile, group, exchange, nameResolver, usedTickers) {
  console.log(`  Processing ${csvFile}...`);
  const parsed  = parseCSV(path.join(RAW_DIR, csvFile));
  const tickers = parsed.headers.slice(1); // skip Date column
  const coins   = [];
  let skipped   = 0;

  for (const rawTicker of tickers) {
    const prices = extractSeries(parsed, rawTicker);
    if (!prices || prices.length < 252) { skipped++; continue; }

    const { ticker, name, sector } = nameResolver(rawTicker);

    // Handle ticker collision for asset filenames
    let assetFile = `${ticker}.json`;
    if (usedTickers.has(ticker)) {
      assetFile = `${ticker}_${group}.json`;
      console.log(`    ⚠ Ticker collision: ${ticker} — using ${assetFile}`);
    }
    usedTickers.add(ticker);

    // Category A from full history
    const catA = computeCategoryA(prices);

    // Category B from last 252 days
    const prices252 = prices.slice(-252);
    const { indicators, ma50History, ma200History } = computeIndicatorsFromPrices(prices252, catA);
    const mood = computeMood(indicators);

    // Historical scores — 1 month ago (T-30) and 1 year ago (T-252)
    const scoreHistory = {};

    // Score 30 days ago
    if (prices.length >= 252 + 30) {
      const pricesT30 = prices.slice(-(252 + 30), -30);
      const catAT30   = computeCategoryA(prices.slice(0, -30));
      const { indicators: indT30 } = computeIndicatorsFromPrices(pricesT30, catAT30);
      const moodT30 = computeMood(indT30);
      scoreHistory['1m'] = { score: moodT30.score, pct: moodT30.pct, label: moodT30.label };
    }

    // Score 252 days ago (1 year)
    if (prices.length >= 252 + 252) {
      const pricesT252 = prices.slice(-(252 + 252), -252);
      const catAT252   = computeCategoryA(prices.slice(0, -252));
      const { indicators: indT252 } = computeIndicatorsFromPrices(pricesT252, catAT252);
      const moodT252 = computeMood(indT252);
      scoreHistory['1y'] = { score: moodT252.score, pct: moodT252.pct, label: moodT252.label };
    }

    // Weekly score timeline — compute score every 5 trading days going back
    const scoreTimeline = [];
    const maxWeeks = Math.min(52, Math.floor((prices.length - 252) / 5));
    for (let w = 0; w <= maxWeeks; w++) {
      const offset = w * 5; // 5 trading days per week
      if (prices.length < 252 + offset) break;
      const sliceEnd = prices.length - offset;
      const slicePrices = prices.slice(sliceEnd - 252, sliceEnd);
      const sliceCatA   = computeCategoryA(prices.slice(0, sliceEnd));
      const { indicators: sliceInd } = computeIndicatorsFromPrices(slicePrices, sliceCatA);
      const sliceMood = computeMood(sliceInd);
      const gs = Math.min(95, Math.max(10, 100 - sliceMood.score * 5));
      scoreTimeline.unshift({
        d: slicePrices.at(-1).d,
        s: gs,
      });
    }

    // 12-month average score
    const avgScore = scoreTimeline.length > 0
      ? Math.round(scoreTimeline.reduce((sum, p) => sum + p.s, 0) / scoreTimeline.length)
      : Math.min(95, Math.max(10, 100 - mood.score * 5));
    const price       = prices.at(-1).p;
    const priceChange = compute30DChange(prices);
    const lastDate    = prices.at(-1).d;

    // Write per-asset JSON
    const assetData = {
      ticker,
      priceHistory: prices252,
      ma50History,
      ma200History,
      scoreTimeline,
    };
    fs.writeFileSync(path.join(ASSETS_DIR, assetFile), JSON.stringify(assetData));

    // Catalog entry (no price arrays)
    coins.push({
      ticker,
      company: name,
      exchange,
      group,
      sector,
      price: +price.toFixed(6),
      priceChange,
      lastDate,
      mood,
      indicators,
      scoreHistory,
      avgScore,
      assetFile,
    });
  }

  console.log(`    → ${coins.length} assets processed, ${skipped} skipped (insufficient data)`);
  return coins;
}

/* ── Change detection — compare current vs previous build ────────────── */

function detectChanges(newCoins, previousCatalog) {
  if (!previousCatalog?.coins?.length) return null;

  const prevMap = {};
  for (const c of previousCatalog.coins) {
    prevMap[c.ticker] = c;
  }

  const changes = {};
  let changeCount = 0;

  for (const curr of newCoins) {
    const prev = prevMap[curr.ticker];
    if (!prev) continue; // new asset, skip

    const assetChanges = {};

    // 1. Status (mood label) change
    if (prev.mood?.label && curr.mood?.label && prev.mood.label !== curr.mood.label) {
      const prevBand = MOOD_BANDS.find(b => b.label === prev.mood.label) || MOOD_BANDS[2];
      const currBand = MOOD_BANDS.find(b => b.label === curr.mood.label) || MOOD_BANDS[2];
      assetChanges.statusChange = {
        from: prevBand.displayLabel,
        to:   currBand.displayLabel,
      };
    }

    // 2. GloRisk score change (only if >= 5 point shift)
    const prevScore = Math.min(95, Math.max(10, 100 - (prev.mood?.score ?? 0) * 5));
    const currScore = Math.min(95, Math.max(10, 100 - (curr.mood?.score ?? 0) * 5));
    if (Math.abs(currScore - prevScore) >= 5) {
      assetChanges.scoreChange = { from: prevScore, to: currScore };
    }

    // 3. Indicator color changes (green->red, red->green, etc.)
    const indChanges = [];
    for (const key of IND_ORDER) {
      const prevInd = prev.indicators?.[key];
      const currInd = curr.indicators?.[key];
      if (prevInd?.color && currInd?.color && prevInd.color !== currInd.color) {
        indChanges.push({
          key,
          name: IND_META[key]?.label || key,
          fromColor: prevInd.color,
          toColor:   currInd.color,
          fromLabel: prevInd.label || '',
          toLabel:   currInd.label || '',
        });
      }
    }
    if (indChanges.length) assetChanges.indicatorChanges = indChanges;

    // Only record if something actually changed
    if (Object.keys(assetChanges).length > 0) {
      changes[curr.ticker] = {
        company: curr.company,
        group:   curr.group,
        ...assetChanges,
      };
      changeCount++;
    }
  }

  return changeCount > 0 ? changes : null;
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

function main() {
  console.log('GloRisk build — reading data...\n');

  // Ensure output directories exist
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  // Load previous catalog for change detection
  const catalogPath = path.join(PUBLIC_DATA, 'coins.json');
  let previousCatalog = null;
  if (fs.existsSync(catalogPath)) {
    try {
      previousCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      console.log(`  Loaded previous build (${previousCatalog.total} assets, as of ${previousCatalog.asOf})`);
    } catch { previousCatalog = null; }
  }

  // Clean previous asset files
  const existingAssets = fs.readdirSync(ASSETS_DIR).filter(f => f.endsWith('.json'));
  for (const f of existingAssets) {
    fs.unlinkSync(path.join(ASSETS_DIR, f));
  }

  // Load ticker name lookup
  const tickerNamesPath = path.join(RAW_DIR, 'ticker_names.json');
  let tickerNames = {};
  if (fs.existsSync(tickerNamesPath)) {
    tickerNames = JSON.parse(fs.readFileSync(tickerNamesPath, 'utf8'));
    console.log(`  Loaded ${Object.keys(tickerNames).length} ticker names`);
  }

  // Auto-discover CSV files
  const csvFiles = fs.readdirSync(RAW_DIR)
    .filter(f => f.endsWith('_closing_prices.csv'))
    .sort();

  console.log(`  Found ${csvFiles.length} CSV files: ${csvFiles.join(', ')}\n`);

  const allCoins    = [];
  const usedTickers = new Set();
  let latestDate    = '';

  for (const csvFile of csvFiles) {
    const { group, exchange } = detectGroupAndExchange(csvFile);
    const nameResolver = makeNameResolver(group, tickerNames);
    const coins = processFile(csvFile, group, exchange, nameResolver, usedTickers);
    allCoins.push(...coins);

    // Track latest date across all files
    for (const c of coins) {
      if (c.lastDate > latestDate) latestDate = c.lastDate;
    }
  }

  // Write catalog
  const output = {
    asOf:  latestDate ? `${latestDate}T00:00:00Z` : new Date().toISOString(),
    built: new Date().toISOString(),
    total: allCoins.length,
    coins: allCoins,
  };

  fs.writeFileSync(catalogPath, JSON.stringify(output));

  // Detect and write changes
  const changes = detectChanges(allCoins, previousCatalog);
  const changesPath = path.join(PUBLIC_DATA, 'changes.json');
  const changesOutput = {
    asOf:         output.asOf,
    previousAsOf: previousCatalog?.asOf || null,
    built:        output.built,
    changes:      changes || {},
  };
  fs.writeFileSync(changesPath, JSON.stringify(changesOutput));
  const numChanges = changes ? Object.keys(changes).length : 0;
  console.log(`\n✓ Change detection: ${numChanges} asset(s) with changes → public/data/changes.json`);

  const sizeKB     = (fs.statSync(catalogPath).size / 1024).toFixed(0);
  const assetCount = fs.readdirSync(ASSETS_DIR).filter(f => f.endsWith('.json')).length;

  console.log(`✓ Built ${allCoins.length} assets → public/data/coins.json (${sizeKB} KB)`);
  console.log(`✓ ${assetCount} per-asset JSON files → public/data/assets/`);

  // Summary by group
  const groups = {};
  for (const c of allCoins) {
    groups[c.group] = (groups[c.group] || 0) + 1;
  }
  console.log('\nBreakdown:');
  for (const [g, n] of Object.entries(groups)) {
    console.log(`  ${g.padEnd(14)} ${n}`);
  }
}

main();
