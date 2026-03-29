/**
 * GloRisk — Main Application
 * ─────────────────────────────────────────────────────────────────────────────
 * SPA entry point: landing, browse grid, per-asset report.
 */

'use strict';

import { getMoodBand, IND_META, IND_ORDER, MAX_SCORE } from './riskEngine.js';
import { loadData, searchCoins, fetchAssetData } from './data.js';
import html2canvas from 'html2canvas';

/* ── Formatting ────────────────────────────────────────────────────── */

function formatPrice(p) {
  if (p == null) return '—';
  if (p < 0.0001) return '$' + p.toFixed(8);
  if (p < 0.01)   return '$' + p.toFixed(6);
  if (p < 1)      return '$' + p.toFixed(4);
  return '$' + p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function moodPill(label) {
  const b = getMoodBand(label);
  return `<span class="mood-pill ${b.cls}">${b.displayLabel ?? label}</span>`;
}

function moodRsbClass(label) {
  const map = {
    'Very Healthy': 'rsb-blue', Healthy: 'rsb-green',
    Unsettled: 'rsb-amber', Stressed: 'rsb-orange', Critical: 'rsb-red',
  };
  return map[label] ?? 'rsb-amber';
}

// Map data group to user-friendly asset type
function assetTypeLabel(group) {
  const STOCK_GROUPS = ['SP500', 'FTSE100', 'Nikkei225', 'HSI'];
  if (group === 'Crypto') return 'Crypto';
  if (STOCK_GROUPS.includes(group)) return 'Stock';
  if (group === 'SectorETFs') return 'ETF';
  if (group === 'Index') return 'Index';
  return group;
}

// GloRisk Score: inverted so high = stable, low = risky
// Raw risk = score * 5 (0-100), then invert. Floor at 10.
function gloriskScore(mood) {
  const raw = mood.score * 5;
  return Math.min(95, Math.max(10, 100 - raw));
}


/* ── State ─────────────────────────────────────────────────────────── */

let allCoins     = [];
let selectedCoin = null;
let chartInst    = null;
let favourites   = new Set();
let activeType   = 'all';  // 'all', 'Stocks', 'Crypto', 'SectorETFs', 'Index'
let activeSub    = 'all';  // 'all', 'SP500', 'FTSE100', 'Nikkei225', 'HSI'

/* ── Init ──────────────────────────────────────────────────────────── */

async function init() {
  const data = await loadData();
  allCoins   = data.coins;

  // Update landing sub — date
  const asOfDate = new Date(data.asOf).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  document.getElementById('landingSub').innerHTML =
    `Data as of ${asOfDate}. <a href="/methodology.html" style="color:var(--accent);text-decoration:none;opacity:0.7">Read GloRisk methodology \u2192</a>`;
  document.getElementById('landingHint').innerHTML =
    `${allCoins.length} assets \u00b7 <a href="#browse">Browse all \u2193</a>`;

  updateCounts();
  renderCards();

  initSearch('landingInput', 'landingDropdown', 'landingBtn');
  initSearch('navInput', 'navDropdown', 'navBtn');

  document.querySelectorAll('.mood-filter').forEach(el =>
    el.addEventListener('change', renderCards));
  document.getElementById('sortSelect').addEventListener('change', renderCards);
  document.getElementById('clearFilters').addEventListener('click', () => {
    document.querySelectorAll('.mood-filter').forEach(el => el.checked = true);
    renderCards();
  });

  // Asset type tabs
  document.getElementById('typeTabs').addEventListener('click', e => {
    const tab = e.target.closest('.type-tab');
    if (!tab) return;
    document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeType = tab.dataset.type;
    activeSub  = 'all';
    // Show/hide sub-tabs
    const subTabs = document.getElementById('subTabs');
    if (activeType === 'Stocks') {
      subTabs.style.display = 'flex';
      document.querySelectorAll('.sub-tab').forEach(t => t.classList.toggle('active', t.dataset.sub === 'all'));
    } else {
      subTabs.style.display = 'none';
    }
    renderCards();
  });

  document.getElementById('subTabs').addEventListener('click', e => {
    const tab = e.target.closest('.sub-tab');
    if (!tab) return;
    document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeSub = tab.dataset.sub;
    renderCards();
  });
  document.getElementById('backLink').addEventListener('click', showLanding);
  document.getElementById('navLogo').addEventListener('click', showLanding);
}

/* ── Search wiring ─────────────────────────────────────────────────── */

function initSearch(inputId, dropdownId, btnId) {
  const input    = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  const btn      = document.getElementById(btnId);
  let results    = [];
  let activeIdx  = -1;
  let timer;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { dropdown.classList.remove('open'); btn.disabled = true; selectedCoin = null; return; }
    timer = setTimeout(async () => {
      results   = await searchCoins(q);
      activeIdx = -1;
      dropdown.innerHTML = buildDropdownHTML(results);
      dropdown.classList.add('open');
    }, 150);
  });

  input.addEventListener('keydown', e => {
    if (!dropdown.classList.contains('open')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, results.length - 1); updateActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); updateActive(); }
    else if (e.key === 'Enter') { const c = results[activeIdx >= 0 ? activeIdx : 0]; if (c) select(c); }
    else if (e.key === 'Escape') dropdown.classList.remove('open');
  });

  dropdown.addEventListener('click', e => {
    const item = e.target.closest('.dd-item');
    if (!item) return;
    const c = results[parseInt(item.dataset.idx, 10)];
    if (c) select(c);
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.classList.remove('open');
  });

  btn.addEventListener('click', () => { if (selectedCoin) showReport(selectedCoin); });

  function updateActive() {
    dropdown.querySelectorAll('.dd-item').forEach((el, i) => el.classList.toggle('active', i === activeIdx));
  }

  function select(coin) {
    selectedCoin         = coin;
    input.value          = `${coin.ticker} \u2014 ${coin.company}`;
    btn.disabled         = false;
    dropdown.classList.remove('open');
    showReport(coin);
  }
}

function buildDropdownHTML(coins) {
  if (!coins.length) return `<div class="dd-empty">No assets found</div>`;
  return coins.map((c, i) => `
    <div class="dd-item" data-idx="${i}">
      <div class="dd-ticker">${c.ticker}</div>
      <div class="dd-name">${c.company}</div>
      <div class="dd-mood">${moodPill(c.mood.label)}</div>
    </div>
  `).join('');
}

/* ── Tab-based filter logic ─────────────────────────────────────────── */

const STOCK_GROUPS = ['SP500', 'FTSE100', 'Nikkei225', 'HSI'];

function matchesTypeFilter(coin) {
  if (activeType === 'all') return true;
  if (activeType === 'Stocks') {
    if (!STOCK_GROUPS.includes(coin.group)) return false;
    if (activeSub !== 'all' && coin.group !== activeSub) return false;
    return true;
  }
  return coin.group === activeType;
}

/* ── Browse grid ───────────────────────────────────────────────────── */

function updateCounts() {
  const moodCounts  = { 'Very Healthy': 0, Healthy: 0, Unsettled: 0, Stressed: 0, Critical: 0 };
  const groupCounts = { Crypto: 0, SP500: 0, FTSE100: 0, Nikkei225: 0, HSI: 0, SectorETFs: 0, Index: 0 };
  allCoins.forEach(c => {
    if (moodCounts[c.mood.label]  !== undefined) moodCounts[c.mood.label]++;
    if (groupCounts[c.group] !== undefined) groupCounts[c.group]++;
  });
  document.getElementById('cnt-very-healthy').textContent = moodCounts['Very Healthy'];
  document.getElementById('cnt-healthy').textContent      = moodCounts['Healthy'];
  document.getElementById('cnt-unsettled').textContent    = moodCounts['Unsettled'];
  document.getElementById('cnt-stressed').textContent     = moodCounts['Stressed'];
  document.getElementById('cnt-critical').textContent     = moodCounts['Critical'];
  document.getElementById('cnt-all').textContent           = allCoins.length;
  document.getElementById('cnt-crypto').textContent       = groupCounts['Crypto'];
  document.getElementById('cnt-stocks').textContent       = STOCK_GROUPS.reduce((s, g) => s + (groupCounts[g] || 0), 0);
  document.getElementById('cnt-sp500').textContent        = groupCounts['SP500'];
  document.getElementById('cnt-ftse').textContent         = groupCounts['FTSE100'];
  document.getElementById('cnt-nikkei').textContent       = groupCounts['Nikkei225'];
  document.getElementById('cnt-hsi').textContent          = groupCounts['HSI'];
  document.getElementById('cnt-etfs').textContent         = groupCounts['SectorETFs'];
  document.getElementById('cnt-index').textContent        = groupCounts['Index'];
}

function getSortedCoins() {
  const sort = document.getElementById('sortSelect').value;
  let coins  = [...allCoins];
  if (sort === 'risk-high') coins.sort((a,b) => b.mood.pct - a.mood.pct);
  else if (sort === 'risk-low') coins.sort((a,b) => a.mood.pct - b.mood.pct);
  else if (sort === 'price-high') coins.sort((a,b) => b.price - a.price);
  else if (sort === 'price-low')  coins.sort((a,b) => a.price - b.price);
  else if (sort === 'change') coins.sort((a,b) => Math.abs(b.priceChange||0) - Math.abs(a.priceChange||0));
  return coins;
}

function renderCards() {
  const grid        = document.getElementById('cardsGrid');
  const countEl     = document.getElementById('cardsCount');
  const activeMoods = [...document.querySelectorAll('.mood-filter:checked')].map(el => el.value);
  const coins       = getSortedCoins().filter(c =>
    activeMoods.includes(c.mood.label) && matchesTypeFilter(c)
  );

  countEl.innerHTML = `Showing <span>${coins.length}</span> of ${allCoins.length} assets`;

  if (!coins.length) {
    grid.innerHTML = `<div class="no-results">No assets match your filters.</div>`;
    return;
  }

  const moodColorMap = { 'Very Healthy': '#60a5fa', Healthy: '#22c55e', Unsettled: '#f59e0b', Stressed: '#f97316', Critical: '#ef4444' };

  grid.innerHTML = coins.map(c => {
    const moodKey   = c.mood.label.toLowerCase().replace(' ', '-');
    const color     = moodColorMap[c.mood.label] || '#f59e0b';
    const change    = c.priceChange || 0;
    const changeClass = change >= 0 ? 'pos' : 'neg';
    const isFav    = favourites.has(c.ticker);
    return `
      <div class="asset-card mood-${moodKey}" data-ticker="${c.ticker}">
        <div class="card-top">
          <div class="card-identity">
            <div>
              <div class="card-ticker">${c.ticker}</div>
              <div class="card-name">${c.company}</div>
            </div>
          </div>
          <button class="card-fav ${isFav ? 'active' : ''}" data-fav="${c.ticker}" title="Watchlist">\u2665</button>
        </div>
        <div class="card-mid">
          <div class="card-price">${formatPrice(c.price)}</div>
          <div class="card-change ${changeClass}">${change >= 0 ? '+' : ''}${change.toFixed(2)}% 30D</div>
        </div>
        ${moodPill(c.mood.label)}
        <div class="card-bottom">
          <div class="score-bar" style="flex:1"><div class="score-fill" style="width:${gloriskScore(c.mood)}%;background:${color}"></div></div>
          <div class="card-score-label">${gloriskScore(c.mood)}</div>
        </div>
      </div>
    `;
  }).join('');

  // Card click
  grid.querySelectorAll('.asset-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.card-fav')) return;
      const coin = allCoins.find(c => c.ticker === card.dataset.ticker);
      if (coin) showReport(coin);
    });
  });

  // Fav click
  grid.querySelectorAll('.card-fav').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const ticker = btn.dataset.fav;
      if (favourites.has(ticker)) { favourites.delete(ticker); btn.classList.remove('active'); }
      else { favourites.add(ticker); btn.classList.add('active'); }
    });
  });
}

/* ── Page transitions ──────────────────────────────────────────────── */

function showLanding() {
  document.getElementById('landing').style.display        = 'flex';
  document.getElementById('browseSection').style.display  = 'block';
  document.getElementById('report').style.display         = 'none';
  document.getElementById('siteFooter').style.display     = 'block';
  document.getElementById('landingInput').value           = '';
  document.getElementById('landingBtn').disabled          = true;
  selectedCoin = null;
  if (chartInst) { chartInst.destroy(); chartInst = null; }
}

function showReport(coin) {
  document.getElementById('landing').style.display        = 'none';
  document.getElementById('browseSection').style.display  = 'none';
  document.getElementById('report').style.display         = 'block';
  document.getElementById('siteFooter').style.display     = 'none';
  document.getElementById('navInput').value               = '';
  document.getElementById('navBtn').disabled              = true;
  renderReport(coin);
  window.scrollTo(0, 0);
}

/* ── Report rendering ──────────────────────────────────────────────── */

function renderReport(coin) {
  const body = document.getElementById('reportBody');
  body.classList.remove('page-fade');
  void body.offsetWidth;
  body.classList.add('page-fade');

  if (chartInst) { chartInst.destroy(); chartInst = null; }

  const mood       = coin.mood;
  const band       = getMoodBand(mood.label);
  const rsbCls     = moodRsbClass(mood.label);
  const change     = coin.priceChange || 0;
  const changeCls  = change >= 0 ? 'pos' : 'neg';

  // Indicator definition rows (glossary — no values, just name + definition)
  const indDefsHTML = IND_ORDER.map(key => {
    const meta = IND_META[key];
    return `
      <div class="ind-def-row">
        <div class="ind-def-name">${meta.label}</div>
        <div class="ind-def-desc">${meta.desc}</div>
      </div>
    `;
  }).join('');

  const asOfDateStr = coin.lastDate
    ? new Date(coin.lastDate).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
    : '';

  const displayLabel = band.displayLabel ?? mood.label;
  const ps = gloriskScore(mood);
  const shareText = `${coin.ticker} (${coin.company}) is rated ${displayLabel} with a GloRisk Score of ${ps}/100 on GloRisk.`;
  const shareUrl = window.location.origin + '/?asset=' + encodeURIComponent(coin.ticker);

  body.innerHTML = `
    <div class="report-hero">
      <div class="hero-info">
        <div class="hero-ticker">${coin.ticker}</div>
        <div class="hero-name">${coin.company}</div>
        <div class="hero-badges">
          <span class="rsb ${rsbCls}">${band.displayLabel ?? mood.label}</span>
          <span class="rsb" style="background:var(--surface2);color:var(--muted);border-color:var(--border2)">${assetTypeLabel(coin.group)}</span>
        </div>
      </div>
      <div class="hero-price-block">
        <div class="hero-price">${formatPrice(coin.price)}</div>
        <div class="hero-change ${changeCls}">${change >= 0 ? '+' : ''}${change.toFixed(2)}% 30D</div>
        <div class="hero-asof">as of ${asOfDateStr}</div>
      </div>
    </div>

    <!-- Report Actions -->
    <div class="report-actions">
      <button class="ra-btn" id="btnExportPdf" title="Export as PDF">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        Export PDF
      </button>
      <button class="ra-btn" id="btnShareX" title="Share on X">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        Share on X
      </button>
      <button class="ra-btn" id="btnShareLi" title="Share on LinkedIn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
        LinkedIn
      </button>
      <button class="ra-btn" id="btnShareImg" title="Share as Image">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        Share as Image
      </button>
      <button class="ra-btn" id="btnCopyLink" title="Copy link">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        Copy Link
      </button>
    </div>

    <!-- GloRisk Score -->
    <div class="risk-meter-wrap">
      <div class="rm-header">
        <div class="rm-label">GloRisk Score</div>
        <div class="rm-score-value" style="color:${band.color}">${gloriskScore(mood)}</div>
      </div>
      <div class="rm-track">
        <div class="rm-fill" style="width:${gloriskScore(mood)}%;background:${band.color}"></div>
      </div>
      <div class="rm-ticks">
        <span>Critical</span><span>Very Stable</span>
      </div>
    </div>

    <!-- Risk Summary -->
    <div class="section-title">Risk Summary</div>
    <div class="ai-box" style="margin-bottom:2rem">
      <div class="ai-badge"><div class="ai-dot"></div> GloRisk Analysis</div>
      <div class="ai-text" id="aiText"></div>
    </div>

    <!-- Price Chart -->
    <div class="section-title">Price History</div>
    <div class="chart-wrap">
      <div class="chart-header">
        <div class="chart-title">${coin.ticker} \u00b7 loading price data\u2026</div>
        <div class="chart-legend">
          <div class="cl-item"><div class="cl-line" style="background:var(--accent)"></div>Price</div>
          <div class="cl-item"><div class="cl-line" style="background:rgba(96,165,250,0.5);border-top:1px dashed"></div>14D MA</div>
        </div>
      </div>
      <canvas id="priceChart" style="max-height:240px"></canvas>
    </div>

    <!-- Full Analysis -->
    <div class="section-title" style="margin-top:2rem">
      Full Analysis
      <span class="section-share" id="btnShareAnalysis" title="Share analysis">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Share
      </span>
    </div>
    <div class="full-analysis" id="fullAnalysis">${buildFullAnalysis(coin)}</div>

    <!-- Indicator Definitions -->
    <div class="section-title" style="margin-top:2rem">Risk Indicator Definitions</div>
    <div class="ind-defs-table">${indDefsHTML}</div>

    <!-- Disclaimer -->
    <p class="report-disclaimer">Analysis is based on historical price behaviour. Not investment advice. Conditions can change quickly.</p>
  `;

  // Build chart
  buildChart(coin);

  // Rule-based summary
  generateSummary(coin);

  // Wire share/export buttons
  wireReportActions(coin, shareText, shareUrl);
}

/* ── Image capture helper ──────────────────────────────────────────── */

async function captureReportImage(coin) {
  const reportBody = document.getElementById('reportBody');
  const elements = reportBody.querySelectorAll('.report-hero, .risk-meter-wrap, .ai-box');
  if (!elements.length) return;

  const tempDiv = document.createElement('div');
  tempDiv.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:900px;padding:2rem;background:#0a0c0f;color:#e8edf2;font-family:Inter,sans-serif;';
  elements.forEach(el => tempDiv.appendChild(el.cloneNode(true)));
  tempDiv.querySelectorAll('.report-actions').forEach(el => el.remove());
  const wm = document.createElement('div');
  wm.style.cssText = 'font-size:0.75rem;color:#3a4250;text-align:center;padding-top:1rem;border-top:1px solid #1e2530;margin-top:1.5rem;';
  wm.textContent = 'glorisk.com';
  tempDiv.appendChild(wm);
  document.body.appendChild(tempDiv);

  try {
    const canvas = await html2canvas(tempDiv, { backgroundColor: '#0a0c0f', scale: 2 });
    document.body.removeChild(tempDiv);
    // Copy to clipboard
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {}
  } catch {
    document.body.removeChild(tempDiv);
  }
}

/* ── Report actions (share + PDF) ───────────────────────────────────── */

function wireReportActions(coin, shareText, shareUrl) {
  // PDF export via browser print
  document.getElementById('btnExportPdf')?.addEventListener('click', () => {
    window.print();
  });

  // Share on X/Twitter — capture image to clipboard, then open compose
  document.getElementById('btnShareX')?.addEventListener('click', async () => {
    await captureReportImage(coin);
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText + '\n\n' + shareUrl)}`;
    window.open(url, '_blank', 'width=550,height=420');
  });

  // Share on LinkedIn
  document.getElementById('btnShareLi')?.addEventListener('click', async () => {
    await captureReportImage(coin);
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
    window.open(url, '_blank', 'width=550,height=520');
  });

  // Copy link
  document.getElementById('btnCopyLink')?.addEventListener('click', (e) => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      const btn = e.target.closest('.ra-btn');
      const orig = btn.innerHTML;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    });
  });

  // Share as image — capture hero + GloRisk Score + summary
  document.getElementById('btnShareImg')?.addEventListener('click', async () => {
    const reportBody = document.getElementById('reportBody');
    // Capture the top portion: hero, panda score, summary
    const elements = reportBody.querySelectorAll('.report-hero, .risk-meter-wrap, .ai-box');
    if (!elements.length) return;

    // Create a temporary container with the key sections
    const tempDiv = document.createElement('div');
    tempDiv.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:900px;padding:2rem;background:#0a0c0f;color:#e8edf2;font-family:Inter,sans-serif;';
    // Add a GloRisk watermark
    const watermark = document.createElement('div');
    watermark.style.cssText = 'font-family:Bricolage Grotesque,sans-serif;font-size:0.75rem;color:#3a4250;text-align:center;padding-top:1rem;border-top:1px solid #1e2530;margin-top:1.5rem;';
    watermark.textContent = 'glorisk.com \u00b7 glorisk.com';

    elements.forEach(el => tempDiv.appendChild(el.cloneNode(true)));
    tempDiv.appendChild(watermark);
    // Remove action buttons from the clone
    tempDiv.querySelectorAll('.report-actions').forEach(el => el.remove());
    document.body.appendChild(tempDiv);

    try {
      const canvas = await html2canvas(tempDiv, {
        backgroundColor: '#0a0c0f',
        scale: 2,
        useCORS: true,
      });
      document.body.removeChild(tempDiv);

      canvas.toBlob(async (blob) => {
        const file = new File([blob], `${coin.ticker}-glorisk-report.png`, { type: 'image/png' });

        // Try Web Share API with image (mobile)
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: `${coin.ticker} Risk Report`, text: shareText });
            return;
          } catch {}
        }

        // Fallback: download the image
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${coin.ticker}-glorisk-report.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch {
      document.body.removeChild(tempDiv);
    }
  });

  // Share analysis section as image
  document.getElementById('btnShareAnalysis')?.addEventListener('click', async () => {
    const analysisEl = document.getElementById('fullAnalysis');
    if (!analysisEl) return;

    const tempDiv = document.createElement('div');
    tempDiv.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:900px;padding:2rem;background:#0a0c0f;color:#e8edf2;font-family:Inter,sans-serif;';
    // Header
    const header = document.createElement('div');
    header.style.cssText = 'font-family:Bricolage Grotesque,sans-serif;font-size:1.2rem;font-weight:800;margin-bottom:1rem;color:#e8edf2;';
    header.textContent = `${coin.ticker} \u2014 Full Analysis (GloRisk Score: ${gloriskScore(coin.mood)}/100)`;
    tempDiv.appendChild(header);
    tempDiv.appendChild(analysisEl.cloneNode(true));
    // Watermark
    const wm = document.createElement('div');
    wm.style.cssText = 'font-size:0.75rem;color:#3a4250;text-align:center;padding-top:1rem;border-top:1px solid #1e2530;margin-top:1rem;';
    wm.textContent = 'glorisk.com';
    tempDiv.appendChild(wm);
    document.body.appendChild(tempDiv);

    try {
      const canvas = await html2canvas(tempDiv, { backgroundColor: '#0a0c0f', scale: 2 });
      document.body.removeChild(tempDiv);

      canvas.toBlob(async (blob) => {
        const file = new File([blob], `${coin.ticker}-analysis.png`, { type: 'image/png' });
        const summaryText = shareText;

        if (navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title: `${coin.ticker} Analysis`, text: summaryText }); return; } catch {}
        }
        // Fallback: download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${coin.ticker}-analysis.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch { document.body.removeChild(tempDiv); }
  });
}

/* ── Price chart ───────────────────────────────────────────────────── */

async function buildChart(coin) {
  const ctx = document.getElementById('priceChart')?.getContext('2d');
  if (!ctx) return;

  const chartWrap  = ctx.canvas.closest('.chart-wrap');
  const chartTitle = chartWrap?.querySelector('.chart-title');

  let assetData;
  try {
    assetData = await fetchAssetData(coin);
  } catch(e) {
    if (chartTitle) chartTitle.textContent = `${coin.ticker} \u00b7 price data unavailable`;
    return;
  }

  if (!assetData?.priceHistory?.length) {
    if (chartTitle) chartTitle.textContent = `${coin.ticker} \u00b7 price data unavailable`;
    return;
  }

  const history = assetData.priceHistory.slice(-60);
  if (chartTitle) chartTitle.textContent = `${coin.ticker} \u00b7 60-day price`;

  const labels = history.map(p => p.d.slice(5));
  const prices = history.map(p => p.p);
  const ma14   = prices.map((_, i) => {
    if (i < 13) return null;
    return prices.slice(i - 13, i + 1).reduce((s, v) => s + v, 0) / 14;
  });

  if (chartInst) { chartInst.destroy(); chartInst = null; }

  chartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Price',
          data: prices,
          borderColor: '#00d4ff',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: { target: 'origin', above: 'rgba(0,212,255,0.04)' },
        },
        {
          label: '14D MA',
          data: ma14,
          borderColor: 'rgba(96,165,250,0.6)',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0.3,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#111418',
          borderColor: '#252d38',
          borderWidth: 1,
          titleColor: '#5a6470',
          bodyColor: '#e8edf2',
          bodyFont: { family: 'DM Mono' },
          callbacks: { label: ctx => `  ${ctx.dataset.label}: ${formatPrice(ctx.raw)}` },
        },
      },
      scales: {
        x: { grid: { color: '#1e2530' }, ticks: { color: '#5a6470', font: { family: 'DM Mono', size: 10 }, maxTicksLimit: 8, maxRotation: 0 } },
        y: { position: 'right', grid: { color: '#1e2530' }, ticks: { color: '#5a6470', font: { family: 'DM Mono', size: 10 }, callback: v => formatPrice(v) } },
      },
    },
  });
}

/* ── Full Analysis — beginner-friendly breakdown ───────────────────── */

function buildFullAnalysis(coin) {
  const ind = coin.indicators;
  const ticker = coin.ticker;

  function dot(color) {
    return `<span class="fa-dot" style="background:var(--${color})"></span>`;
  }

  function card(title, v, explanation) {
    return `
      <div class="fa-card">
        <div class="fa-card-header">
          ${dot(v.color)}
          <span class="fa-card-title">${title}</span>
          <span class="fa-card-value fa-val--${v.color}">${v.label}</span>
        </div>
        <p class="fa-explain">${explanation}</p>
      </div>
    `;
  }

  const sections = [];

  // --- VOLATILITY ---
  sections.push(`<div class="fa-group-label">Volatility</div>`);

  if (ind.volatility) {
    const v = ind.volatility;
    const text = v.raw < 30
      ? `${ticker} has relatively calm daily price movements. An annualised volatility of ${v.label} means day-to-day price swings are modest and more predictable.`
      : v.raw < 60
      ? `${ticker} shows moderate price swings at ${v.label} annualised. The price can move meaningfully from day to day, which is typical for this type of asset.`
      : `${ticker} has high volatility at ${v.label} annualised. The price swings significantly from day to day, making it harder to predict short-term moves.`;
    sections.push(card('Daily Volatility', v, text));
  }

  if (ind.volSpike) {
    const v = ind.volSpike;
    const text = v.raw < 1.0
      ? `Recent volatility is lower than the historical average (${v.label}). Price behaviour has been calmer than usual lately \u2014 a stable sign.`
      : v.raw < 2.0
      ? `Recent volatility is slightly above the historical average at ${v.label}. Something may be shifting, but it\u2019s not extreme.`
      : `Recent volatility is ${v.label} the historical average \u2014 a significant spike. This often precedes larger price moves and indicates heightened uncertainty.`;
    sections.push(card('Volatility Spike', v, text));
  }

  // --- TREND ---
  sections.push(`<div class="fa-group-label">Trend</div>`);

  if (ind.shortTrend) {
    const v = ind.shortTrend;
    const text = v.raw > 0
      ? `The price is ${v.label} above its 50-day average. The short-term direction is upward \u2014 buyers have been in control recently.`
      : v.raw > -6
      ? `The price is ${v.label} below its 50-day average. It has slipped slightly below the short-term trend, which could signal early weakness.`
      : `The price is ${v.label} below its 50-day average. This is a clear downtrend signal \u2014 the asset has fallen well below where it was trading recently.`;
    sections.push(card('50-Day Trend', v, text));
  }

  if (ind.longTrend) {
    const v = ind.longTrend;
    const text = v.raw > 0
      ? `The price sits ${v.label} above its 200-day average \u2014 the long-term trend is intact and pointing upward.`
      : v.raw > -10
      ? `The price is ${v.label} below its 200-day average. The long-term trend is starting to weaken but hasn\u2019t broken down completely.`
      : `The price is ${v.label} below its 200-day average. This is a significant long-term downtrend \u2014 the asset has been losing value over an extended period.`;
    sections.push(card('200-Day Trend', v, text));
  }

  if (ind.maCross) {
    const v = ind.maCross;
    const text = v.color === 'green'
      ? `The 50-day average is above the 200-day average \u2014 known as a "Golden Cross." This is a widely-watched bullish signal that suggests the overall trend direction is upward.`
      : `The 50-day average has fallen below the 200-day average \u2014 known as a "Death Cross." This is a bearish signal that suggests the overall trend direction is downward.`;
    sections.push(card('Trend Direction', v, text));
  }

  // --- RETURNS ---
  sections.push(`<div class="fa-group-label">Returns</div>`);

  if (ind.vsPeak) {
    const v = ind.vsPeak;
    const text = v.raw < 20
      ? `The price is only ${v.label} below its 3-year high. It has held up well and remains close to its peak value.`
      : v.raw < 30
      ? `The price is ${v.label} below its 3-year high. A noticeable pullback from the peak, though not extreme.`
      : `The price is ${v.label} below its 3-year high. This is a deep drawdown \u2014 the asset has lost a significant portion of its peak value and hasn\u2019t recovered.`;
    sections.push(card('Distance from Peak', v, text));
  }

  if (ind.return1M) {
    const v = ind.return1M;
    const text = v.raw >= 0
      ? `Over the past 30 days, the price has risen ${v.label}. Short-term direction is positive.`
      : v.raw > -10
      ? `Over the past 30 days, the price has fallen ${v.label}. A modest short-term decline.`
      : `Over the past 30 days, the price has dropped ${v.label}. This is a sharp decline that signals significant selling pressure.`;
    sections.push(card('30-Day Return', v, text));
  }

  if (ind.return1Y) {
    const v = ind.return1Y;
    const text = v.raw > 0
      ? `Over the past 12 months, the price is up ${v.label}. The asset has gained value over the longer term.`
      : v.raw > -20
      ? `Over the past 12 months, the price is down ${v.label}. A moderate decline over the year.`
      : `Over the past 12 months, the price has fallen ${v.label}. This sustained decline indicates a prolonged period of weakness.`;
    sections.push(card('12-Month Return', v, text));
  }

  if (ind.range52W) {
    const v = ind.range52W;
    const text = v.raw > 45
      ? `The price is in the upper half of its 52-week range (${v.label}). It\u2019s closer to its yearly high than its low \u2014 a sign of strength.`
      : v.raw > 25
      ? `The price sits in the middle of its 52-week range (${v.label}). It\u2019s neither near the top nor the bottom of its recent trading band.`
      : `The price is near the bottom of its 52-week range (${v.label}). It has given back most of its gains from the past year.`;
    sections.push(card('Position in Range', v, text));
  }

  if (ind.cagr3Y) {
    const v = ind.cagr3Y;
    const text = v.raw > 0
      ? `The 3-year annual growth rate is ${v.label}. Over three years, the asset has grown in value on an annualised basis \u2014 a positive long-term sign.`
      : `The 3-year annual growth rate is ${v.label}. Over three years, the asset has lost value on an annualised basis \u2014 meaning it has destroyed long-term value.`;
    sections.push(card('3-Year Growth', v, text));
  }

  return sections.join('');
}

/* ── Risk Summary (rule-based) ─────────────────────────────────────── */

function generateSummary(coin) {
  const aiText = document.getElementById('aiText');
  if (!aiText) return;

  const redCount   = IND_ORDER.filter(k => coin.indicators[k]?.color === 'red').length;
  const greenCount = IND_ORDER.filter(k => coin.indicators[k]?.color === 'green').length;
  const amberCount = IND_ORDER.length - redCount - greenCount;

  // Build a more specific summary based on actual indicator states
  const redIndicators = IND_ORDER
    .filter(k => coin.indicators[k]?.color === 'red')
    .map(k => IND_META[k].label);

  const greenIndicators = IND_ORDER
    .filter(k => coin.indicators[k]?.color === 'green')
    .map(k => IND_META[k].label);

  const displayLabel = getMoodBand(coin.mood.label).displayLabel ?? coin.mood.label;
  const ps = gloriskScore(coin.mood);

  let verdict = '';
  if (coin.mood.label === 'Very Healthy' || coin.mood.label === 'Healthy') {
    verdict = `${coin.company} is currently rated <strong>${displayLabel}</strong> with a GloRisk Score of ${ps}/100. A higher score indicates greater stability. This asset is showing few warning signals across the indicators tracked.`;
  } else if (coin.mood.label === 'Unsettled') {
    verdict = `${coin.company} is currently rated <strong>${displayLabel}</strong> with a GloRisk Score of ${ps}/100. A higher score indicates greater stability. The asset is showing a mix of positive and negative signals that warrant monitoring.`;
  } else {
    verdict = `${coin.company} is currently rated <strong>${displayLabel}</strong> with a GloRisk Score of ${ps}/100. A higher score indicates greater stability. This is a low-stability reading, with multiple warning signals active.`;
  }

  let drivers = `Of the ${IND_ORDER.length} indicators tracked, ${redCount} are showing red signals, ${amberCount} amber, and ${greenCount} green.`;
  if (redIndicators.length > 0) {
    drivers += ` Key pressure points: ${redIndicators.slice(0, 3).join(', ')}.`;
  }
  if (greenIndicators.length > 0) {
    drivers += ` Positive signals: ${greenIndicators.slice(0, 3).join(', ')}.`;
  }

  const context = `For the risk rating to improve, ${coin.ticker} would need to recover above its key moving averages, show sustained positive momentum, and reduce its drawdown from the historical peak. Until those conditions are met, the current rating reflects the asset\u2019s price-based risk profile at this point in time.`;

  aiText.innerHTML = `<p>${verdict}</p><p>${drivers}</p><p>${context}</p>`;
}

/* ── Boot ──────────────────────────────────────────────────────────── */

init().catch(console.error);
