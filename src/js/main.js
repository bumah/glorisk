/**
 * GloRisk — Main Application
 * ─────────────────────────────────────────────────────────────────────────────
 * SPA entry point: landing, browse grid, per-asset report.
 */

'use strict';

import { getMoodBand, IND_META, IND_ORDER, MAX_SCORE } from './riskEngine.js';
import { loadData, searchCoins, fetchAssetData } from './data.js';

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

// Panda Score: inverted so high = stable, low = risky
// Raw risk = score * 5 (0-100), then invert. Floor at 10.
function pandaScore(mood) {
  const raw = mood.score * 5;
  return Math.min(95, Math.max(10, 100 - raw));
}


/* ── State ─────────────────────────────────────────────────────────── */

let allCoins     = [];
let selectedCoin = null;
let chartInst    = null;
let favourites   = new Set();

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
  document.querySelectorAll('.group-filter').forEach(el =>
    el.addEventListener('change', onGroupFilterChange));
  document.querySelectorAll('.sub-filter').forEach(el =>
    el.addEventListener('change', onSubFilterChange));
  document.getElementById('sortSelect').addEventListener('change', renderCards);
  document.getElementById('clearFilters').addEventListener('click', () => {
    document.querySelectorAll('.mood-filter, .group-filter, .sub-filter').forEach(el => el.checked = true);
    document.querySelectorAll('.filter-sub').forEach(el => el.classList.remove('collapsed'));
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

/* ── Hierarchical filter logic ──────────────────────────────────────── */

// Which data groups belong to the "Stocks" parent
const STOCK_GROUPS = ['SP500', 'FTSE100', 'Nikkei225', 'HSI'];

function onGroupFilterChange(e) {
  const checkbox = e.target;

  // If this is the "Stocks" parent, toggle all sub-filters + collapse/expand
  if (checkbox.value === 'Stocks') {
    const subEl = document.getElementById('stocksSub');
    document.querySelectorAll('.sub-filter[data-parent="Stocks"]').forEach(el => {
      el.checked = checkbox.checked;
    });
    if (checkbox.checked) {
      subEl.classList.remove('collapsed');
    } else {
      subEl.classList.add('collapsed');
    }
  }

  renderCards();
}

function onSubFilterChange() {
  // If any sub-filter is checked, make sure the parent is checked too
  const subs = [...document.querySelectorAll('.sub-filter[data-parent="Stocks"]')];
  const anyChecked = subs.some(el => el.checked);
  const parent = document.querySelector('.group-filter[value="Stocks"]');
  if (parent) parent.checked = anyChecked;

  renderCards();
}

// Get the set of active data-level groups from the filter UI
function getActiveGroups() {
  const groups = new Set();

  // Direct group filters (Crypto, SectorETFs, Index)
  document.querySelectorAll('.group-filter:checked').forEach(el => {
    if (el.value !== 'Stocks') {
      groups.add(el.value);
    }
  });

  // Stock sub-filters (SP500, FTSE100, Nikkei225, HSI)
  document.querySelectorAll('.sub-filter:checked').forEach(el => {
    groups.add(el.value);
  });

  return groups;
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
  const activeGroups = getActiveGroups();
  const coins       = getSortedCoins().filter(c =>
    activeMoods.includes(c.mood.label) && activeGroups.has(c.group)
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
          <div class="score-bar" style="flex:1"><div class="score-fill" style="width:${pandaScore(c.mood)}%;background:${color}"></div></div>
          <div class="card-score-label">${pandaScore(c.mood)}</div>
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

  // Indicator rows
  const indRowsHTML = IND_ORDER.map(key => {
    const ind  = coin.indicators[key];
    if (!ind) return '';
    const meta = IND_META[key];
    return `
      <div class="ind-row" title="${meta.desc}">
        <div class="ind-signal ind-signal--${ind.color}"></div>
        <div class="ind-info">
          <div class="ind-name">${meta.label}</div>
          <div class="ind-desc">${meta.desc}</div>
        </div>
        <div class="ind-val ind-val--${ind.color}">${ind.label}</div>
      </div>
    `;
  }).join('');

  const asOfDateStr = coin.lastDate
    ? new Date(coin.lastDate).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
    : '';

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

    <!-- Panda Score -->
    <div class="risk-meter-wrap">
      <div class="rm-header">
        <div class="rm-label">Panda Score</div>
        <div class="rm-score-value" style="color:${band.color}">${pandaScore(mood)}</div>
      </div>
      <div class="rm-track">
        <div class="rm-fill" style="width:${pandaScore(mood)}%;background:${band.color}"></div>
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

    <!-- Indicators -->
    <div class="section-title" style="margin-top:2rem">Risk Indicators</div>
    <div class="ind-table">${indRowsHTML}</div>

    <!-- Disclaimer -->
    <p class="report-disclaimer">Analysis is based on historical price behaviour. Not investment advice. Conditions can change quickly.</p>
  `;

  // Build chart
  buildChart(coin);

  // Rule-based summary
  generateSummary(coin);
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
  const ps = pandaScore(coin.mood);

  let verdict = '';
  if (coin.mood.label === 'Very Healthy' || coin.mood.label === 'Healthy') {
    verdict = `${coin.company} is currently rated <strong>${displayLabel}</strong> with a Panda Score of ${ps}/100. A higher score indicates greater stability. This asset is showing few warning signals across the indicators tracked.`;
  } else if (coin.mood.label === 'Unsettled') {
    verdict = `${coin.company} is currently rated <strong>${displayLabel}</strong> with a Panda Score of ${ps}/100. A higher score indicates greater stability. The asset is showing a mix of positive and negative signals that warrant monitoring.`;
  } else {
    verdict = `${coin.company} is currently rated <strong>${displayLabel}</strong> with a Panda Score of ${ps}/100. A higher score indicates greater stability. This is a low-stability reading, with multiple warning signals active.`;
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
