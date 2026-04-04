/**
 * GloRisk — AI Investment Report Generator
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads coins.json catalog and generates investment research reports
 * for each asset using the Perplexity API (sonar model).
 *
 * Usage:
 *   PERPLEXITY_API_KEY=pplx-xxx node scripts/build-reports.js
 *   PERPLEXITY_API_KEY=pplx-xxx node scripts/build-reports.js --ticker AAPL
 *   PERPLEXITY_API_KEY=pplx-xxx node scripts/build-reports.js --limit 10
 *
 * Output: public/data/reports/{TICKER}.json
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DATA  = path.join(__dirname, '../public/data');
const REPORTS_DIR  = path.join(PUBLIC_DATA, 'reports');
const CATALOG_PATH = path.join(PUBLIC_DATA, 'coins.json');

const API_KEY = process.env.PERPLEXITY_API_KEY;
if (!API_KEY) {
  console.error('Error: PERPLEXITY_API_KEY environment variable is required.');
  console.error('Usage: PERPLEXITY_API_KEY=pplx-xxx node scripts/build-reports.js');
  process.exit(1);
}

const API_URL = 'https://api.perplexity.ai/chat/completions';
const MODEL   = 'sonar'; // cheapest: ~$0.005/query. Use 'sonar-pro' for deeper reports (~$0.03)
const DELAY   = 1500;    // ms between API calls (rate limiting)

/* ── System prompt ─────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are a long-term, research-driven investment analyst built for evaluating assets across equities, ETFs, and crypto. Your analysis must be clear, structured, and professional — like a Goldman Sachs, BlackRock, or Fidelity research note.

Your Core Objective: When given a company, ETF, or crypto, you will:
1. Evaluate it as a potential long-term compounder (3–10 year horizon).
2. Score it using the Internal vs External Strength Framework.
3. Classify it in a 2×2 matrix: Pack Leader, Momentum Stock, Defensive Holding, or Decliner.
4. Provide a neutral overall verdict summarising the SWOT position (never recommend buy, sell, or hold).

Framework: Evaluate every asset on 10 factors, scored 1–10 (10 = exceptional).

INTERNAL STRENGTH (Business Quality):
1. Moat & Competitive Advantage – brand, IP, switching costs, scale, or network effects.
2. Financial Performance – profitability, margins, ROE/ROIC, growth trends.
3. Balance Sheet Strength – leverage, liquidity, capital efficiency.
4. Earnings Quality & Trajectory – stability, predictability, secular growth.
5. Leadership & Governance – management quality, capital allocation, credibility.

EXTERNAL STRENGTH (Resilience & Exposure):
6. Market Position & Competition – pricing power, share stability, barriers to entry.
7. Regulatory & Political Exposure – legal, ESG, or policy risk.
8. Supply Chain & Geographic Resilience – diversification, input stability, geopolitics.
9. Macroeconomic Sensitivity – cyclical exposure to rates, inflation, or demand shocks.
10. Industry Growth Outlook – sector tailwinds or structural decline risk.

Classification:
- 🟢 Pack Leader: Internal ≥ 7, External ≥ 7 — Strong fundamentals + favourable conditions
- 🟡 Momentum Stock: Internal ≥ 7, External < 7 — Strong business facing macro pressures
- 🔵 Defensive Holding: Internal < 7, External ≥ 7 — Stable externally, weaker fundamentals
- 🔴 Decliner: Internal < 7, External < 7 — Weak fundamentals + challenging conditions

Output Format:
1. Executive Summary (2–3 sentences). Core thesis and classification.
2. Detailed Scoring Table (10 factors, each scored 1–10 with one-line reasoning).
3. Internal vs External Summary (averages for each category).
4. Matrix Placement (classification with emoji).
5. Risk & Opportunity Analysis — use EXACTLY this format with separate bullet points:
   - **Bold Title**: one-sentence description (for each tailwind)
   - **Bold Title**: one-sentence description (for each risk)
   Group under "**Key Tailwinds**" and "**Key Risks**" only (no catalysts).
   Provide 3–5 separate bullet-point items for tailwinds and 3–5 for risks. Each on its own line starting with "- ".
6. Overall Verdict (2–3 sentences. State the classification, highlight the key strength and the key risk. Do NOT recommend buy, sell, or hold. Example tone: "X is classified as a [label], reflecting [key strength]. The primary headwind is [key risk].").

IMPORTANT: Never make investment recommendations. Never say "buy", "sell", "hold", "conviction buy", "overweight", or similar. You are providing an objective SWOT assessment, not investment advice.

Tone: Analytical, concise, data-driven. No hype or retail bias. Use structured formatting.`;

/* ── API call ──────────────────────────────────────────────────────────── */

async function generateReport(ticker, companyName, assetType) {
  const userPrompt = `Analyze ${companyName} (${ticker}) as a ${assetType} investment. Provide a full research report using the Internal vs External Strength Framework.`;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from API');

  return {
    ticker,
    company: companyName,
    type: assetType,
    report: content,
    citations: data.citations || [],
    model: MODEL,
    generated: new Date().toISOString(),
  };
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function getAssetType(group) {
  if (group === 'Crypto') return 'cryptocurrency';
  if (group === 'SectorETFs') return 'ETF';
  if (group === 'Index') return 'index';
  return 'stock'; // SP500, FTSE100, Nikkei225, HSI
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ── Main ──────────────────────────────────────────────────────────────── */

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  const tickerFlag = args.indexOf('--ticker');
  const limitFlag  = args.indexOf('--limit');
  const singleTicker = tickerFlag >= 0 ? args[tickerFlag + 1]?.toUpperCase() : null;
  const limit = limitFlag >= 0 ? parseInt(args[limitFlag + 1]) : Infinity;
  const skipExisting = !singleTicker; // skip existing reports unless targeting a specific ticker

  // Load catalog
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error('Error: coins.json not found. Run build-data.js first.');
    process.exit(1);
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  let assets = catalog.coins;

  // Filter to single ticker if specified
  if (singleTicker) {
    assets = assets.filter(c => c.ticker === singleTicker);
    if (!assets.length) {
      console.error(`Error: Ticker ${singleTicker} not found in catalog.`);
      process.exit(1);
    }
  }

  // Apply limit
  if (limit < assets.length) {
    assets = assets.slice(0, limit);
  }

  // Ensure reports directory exists
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  console.log(`GloRisk AI Report Generator`);
  console.log(`Model: ${MODEL} | Assets: ${assets.length} | Delay: ${DELAY}ms\n`);

  let generated = 0;
  let skipped   = 0;
  let errors    = 0;

  for (let i = 0; i < assets.length; i++) {
    const coin = assets[i];
    const reportPath = path.join(REPORTS_DIR, `${coin.ticker}.json`);

    // Skip existing reports (unless regenerating a specific ticker)
    if (skipExisting && fs.existsSync(reportPath)) {
      skipped++;
      continue;
    }

    const assetType = getAssetType(coin.group);
    const progress  = `[${i + 1}/${assets.length}]`;

    try {
      process.stdout.write(`${progress} ${coin.ticker} (${coin.company})... `);
      const report = await generateReport(coin.ticker, coin.company, assetType);
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      generated++;
      console.log('✓');

      // Rate limit delay
      if (i < assets.length - 1) await sleep(DELAY);
    } catch (err) {
      errors++;
      console.log(`✗ ${err.message}\n${err.stack?.split('\n').slice(1,3).join('\n')}`);
    }
  }

  console.log(`\n✓ Generated: ${generated} | Skipped: ${skipped} | Errors: ${errors}`);
  console.log(`  Reports → public/data/reports/`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
