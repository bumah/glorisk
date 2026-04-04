/**
 * DailyFinn — Main Application
 * ─────────────────────────────────────────────────────────────────────────────
 * SPA entry point: landing, browse grid, per-asset report.
 */

'use strict';

import { getMoodBand, IND_META, IND_ORDER, MAX_SCORE } from './riskEngine.js';
import { loadData, searchCoins, fetchAssetData } from './data.js';
import html2canvas from 'html2canvas';
import { getUser, signOut } from './supabase.js';

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
let scoreChartInst = null;
let favourites   = new Set();
let activeType   = 'all';  // 'all', 'Stocks', 'Crypto', 'SectorETFs', 'Index'
let activeSub    = 'all';  // 'all', 'SP500', 'FTSE100', 'Nikkei225', 'HSI', 'Mag7', 'Majors', 'sector:...'
let activeIssuer = 'all';  // 'all', 'Vanguard', 'iShares', 'SPDR'
let browseQuery  = '';     // text filter from browse search

/* ── Init ──────────────────────────────────────────────────────────── */

async function init() {
  const data = await loadData();
  allCoins   = data.coins;

  // Update landing sub — date + market summary link (only on pages with landing)
  const asOfDate = new Date(data.asOf).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const landingSub = document.getElementById('landingSub');
  if (landingSub) landingSub.innerHTML =
    `Data as of ${asOfDate}. <a href="/market.html" style="color:var(--accent);text-decoration:none;opacity:0.7">Read latest market summary \u2192</a>`;
  const landingHint = document.getElementById('landingHint');
  if (landingHint) landingHint.innerHTML =
    `${allCoins.length} assets \u00b7 <a href="/methodology.html" style="color:var(--accent);text-decoration:none;opacity:0.7">GloRisk methodology \u2192</a>`;

  updateCounts();
  renderCards();

  // Handle ?asset= URL parameter (deep link from market summary)
  const params = new URLSearchParams(window.location.search);
  const assetParam = params.get('asset');
  if (assetParam) {
    const coin = allCoins.find(c => c.ticker === assetParam.toUpperCase());
    if (coin) showReport(coin);
  }

  if (document.getElementById('landingInput')) {
    initSearch('landingInput', 'landingDropdown', 'landingBtn');
  }
  initSearch('navInput', 'navDropdown', 'navBtn');

  document.querySelectorAll('.mood-filter').forEach(el =>
    el.addEventListener('change', renderCards));
  document.getElementById('sortSelect').addEventListener('change', renderCards);
  document.getElementById('clearFilters').addEventListener('click', () => {
    document.querySelectorAll('.mood-filter').forEach(el => el.checked = true);
    renderCards();
  });

  // Browse text filter with dropdown suggestions
  const browseFilterEl = document.getElementById('browseFilter');
  const browseDrop = document.getElementById('browseDropdown');
  if (browseFilterEl && browseDrop) {
    let filterTimer;
    browseFilterEl.addEventListener('input', () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        browseQuery = browseFilterEl.value.trim();
        renderCards();
        // Show dropdown suggestions
        const q = browseQuery.toLowerCase();
        if (q.length >= 1) {
          const matches = allCoins.filter(c =>
            c.ticker.toLowerCase().includes(q) || c.company.toLowerCase().includes(q)
          ).slice(0, 6);
          if (matches.length) {
            const b = (label) => getMoodBand(label);
            browseDrop.innerHTML = matches.map((c, i) => {
              const band = b(c.mood.label);
              return `<div class="dd-item" data-idx="${i}" data-ticker="${c.ticker}">
                <div class="dd-ticker">${c.ticker}</div>
                <div class="dd-name">${c.company}</div>
                <div class="dd-mood"><span class="mood-pill ${band.cls}" style="font-size:0.6rem">${band.displayLabel}</span></div>
              </div>`;
            }).join('');
            browseDrop.classList.add('open');
          } else {
            browseDrop.classList.remove('open');
          }
        } else {
          browseDrop.classList.remove('open');
        }
      }, 150);
    });

    browseDrop.addEventListener('click', e => {
      const item = e.target.closest('.dd-item');
      if (!item) return;
      const ticker = item.dataset.ticker;
      const coin = allCoins.find(c => c.ticker === ticker);
      if (coin) {
        browseFilterEl.value = '';
        browseQuery = '';
        browseDrop.classList.remove('open');
        showReport(coin);
      }
    });

    browseFilterEl.addEventListener('focus', () => {
      if (browseQuery.length >= 1 && browseDrop.innerHTML) browseDrop.classList.add('open');
    });

    document.addEventListener('click', e => {
      if (!browseFilterEl.contains(e.target) && !browseDrop.contains(e.target)) {
        browseDrop.classList.remove('open');
      }
    });
  }

  // Asset type tabs
  document.getElementById('typeTabs').addEventListener('click', e => {
    const tab = e.target.closest('.type-tab');
    if (!tab) return;
    document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeType = tab.dataset.type;
    activeSub  = 'all';
    // Show/hide sub-tabs
    activeIssuer = 'all';
    document.getElementById('subTabs').style.display = activeType === 'Stocks' ? 'flex' : 'none';
    document.getElementById('cryptoSubTabs').style.display = activeType === 'Crypto' ? 'flex' : 'none';
    document.getElementById('etfSubWrap').style.display = activeType === 'SectorETFs' ? 'block' : 'none';
    // Reset sub-tab active states
    document.querySelectorAll('#subTabs .sub-tab, #cryptoSubTabs .sub-tab, #etfSectorTabs .sub-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.sub === 'all'));
    document.querySelectorAll('#etfIssuerTabs .sub-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.issuer === 'all'));
    renderCards();
  });

  // Stock sub-tabs
  document.getElementById('subTabs').addEventListener('click', e => {
    const tab = e.target.closest('.sub-tab');
    if (!tab) return;
    document.querySelectorAll('#subTabs .sub-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeSub = tab.dataset.sub;
    renderCards();
  });

  // Crypto sub-tabs
  document.getElementById('cryptoSubTabs').addEventListener('click', e => {
    const tab = e.target.closest('.sub-tab');
    if (!tab) return;
    document.querySelectorAll('#cryptoSubTabs .sub-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeSub = tab.dataset.sub;
    renderCards();
  });

  // ETF sector sub-tabs
  document.getElementById('etfSectorTabs').addEventListener('click', e => {
    const tab = e.target.closest('.sub-tab');
    if (!tab) return;
    document.querySelectorAll('#etfSectorTabs .sub-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeSub = tab.dataset.sub;
    renderCards();
  });

  // ETF issuer sub-tabs
  document.getElementById('etfIssuerTabs').addEventListener('click', e => {
    const tab = e.target.closest('.sub-tab');
    if (!tab) return;
    document.querySelectorAll('#etfIssuerTabs .sub-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeIssuer = tab.dataset.issuer;
    renderCards();
  });
  document.getElementById('backLink').addEventListener('click', showLanding);
  document.getElementById('navLogo').addEventListener('click', showLanding);

  // Update nav sign in/out button
  const gnUser = await getUser();
  const gnBtn = document.getElementById('gnSignIn');
  if (gnBtn && gnUser) {
    gnBtn.textContent = 'Sign Out';
    gnBtn.href = '#';
    gnBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await signOut();
      window.location.reload();
    });
  }
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
const MAG7_TICKERS = ['MSFT', 'META', 'TSLA', 'GOOG', 'NVDA', 'AMZN', 'AAPL'];
const CRYPTO_MAJORS = ['BTC', 'ETH', 'BNB', 'XRP', 'SOL'];

// Detect ETF issuer from company name
function etfIssuer(company) {
  if (company.startsWith('Vanguard')) return 'Vanguard';
  if (company.startsWith('iShares')) return 'iShares';
  if (company.includes('SPDR')) return 'SPDR';
  return 'Other';
}

function matchesTypeFilter(coin) {
  if (activeType === 'all') return true;
  if (activeType === 'Stocks') {
    if (!STOCK_GROUPS.includes(coin.group)) return false;
    if (activeSub === 'Mag7') return MAG7_TICKERS.includes(coin.ticker);
    if (activeSub !== 'all' && coin.group !== activeSub) return false;
    return true;
  }
  if (activeType === 'Crypto') {
    if (coin.group !== 'Crypto') return false;
    if (activeSub === 'Majors') return CRYPTO_MAJORS.includes(coin.ticker);
    return true;
  }
  if (activeType === 'SectorETFs') {
    if (coin.group !== 'SectorETFs') return false;
    // Sector filter
    if (activeSub !== 'all' && activeSub.startsWith('sector:')) {
      if (coin.sector !== activeSub.replace('sector:', '')) return false;
    }
    // Issuer filter
    if (activeIssuer !== 'all') {
      if (etfIssuer(coin.company) !== activeIssuer) return false;
    }
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
  const q = browseQuery.toLowerCase();
  const coins       = getSortedCoins().filter(c =>
    activeMoods.includes(c.mood.label) && matchesTypeFilter(c) &&
    (!q || c.ticker.toLowerCase().includes(q) || c.company.toLowerCase().includes(q))
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
    const g = IND_ORDER.filter(k => c.indicators[k]?.color === 'green').length;
    const a = IND_ORDER.filter(k => c.indicators[k]?.color === 'amber').length;
    const r = IND_ORDER.filter(k => c.indicators[k]?.color === 'red').length;
    return `
      <div class="asset-card mood-${moodKey}" data-ticker="${c.ticker}">
        <div class="card-top">
          <div class="card-identity">
            <div>
              <div class="card-ticker">${c.ticker}</div>
              <div class="card-name">${c.company}</div>
            </div>
          </div>
          <div class="card-score" style="color:${color}">${gloriskScore(c.mood)}${(() => {
            const sh = c.scoreHistory?.['1m'];
            if (!sh) return '';
            const diff = gloriskScore(c.mood) - gloriskScore(sh);
            if (diff === 0) return '';
            return diff > 0
              ? '<span class="card-score-arrow" style="color:var(--green)">\u2191</span>'
              : '<span class="card-score-arrow" style="color:var(--red)">\u2193</span>';
          })()}</div>
        </div>
        <div class="card-mid">
          <div class="card-price">${formatPrice(c.price)}</div>
          <div class="card-change ${changeClass}">${change >= 0 ? '+' : ''}${change.toFixed(2)}% 30D</div>
        </div>
        <div class="card-mood-row">
          ${moodPill(c.mood.label)}
          <span class="card-ind-counts"><span class="cic-g">${g}G</span> <span class="cic-a">${a}A</span> <span class="cic-r">${r}R</span></span>
        </div>
        <div class="card-bottom">
          <div class="score-bar" style="flex:1"><div class="score-fill" style="width:${gloriskScore(c.mood)}%;background:${color}"></div></div>
        </div>
      </div>
    `;
  }).join('');

  // Card click
  grid.querySelectorAll('.asset-card').forEach(card => {
    card.addEventListener('click', () => {
      const coin = allCoins.find(c => c.ticker === card.dataset.ticker);
      if (coin) showReport(coin);
    });
  });
}

/* ── Page transitions ──────────────────────────────────────────────── */

function showLanding() {
  const landing = document.getElementById('landing');
  if (landing) landing.style.display = 'flex';
  document.getElementById('browseSection').style.display  = 'block';
  document.getElementById('report').style.display         = 'none';
  const footer = document.getElementById('siteFooter');
  if (footer) footer.style.display = 'block';
  const solSection = document.querySelector('.solutions-section');
  if (solSection) solSection.style.display = '';
  const landingInput = document.getElementById('landingInput');
  if (landingInput) { landingInput.value = ''; }
  const landingBtn = document.getElementById('landingBtn');
  if (landingBtn) { landingBtn.disabled = true; }
  selectedCoin = null;
  if (chartInst) { chartInst.destroy(); chartInst = null; }
}

function showReport(coin) {
  const landing = document.getElementById('landing');
  if (landing) landing.style.display = 'none';
  document.getElementById('browseSection').style.display  = 'none';
  document.getElementById('report').style.display         = 'block';
  const footer = document.getElementById('siteFooter');
  if (footer) footer.style.display = 'none';
  const solSection = document.querySelector('.solutions-section');
  if (solSection) solSection.style.display = 'none';
  document.getElementById('navInput').value               = '';
  document.getElementById('navBtn').disabled              = true;
  renderReport(coin);
  window.scrollTo(0, 0);
}

/* ── Score history display ─────────────────────────────────────────── */

function buildScoreHistory(coin) {
  const sh = coin.scoreHistory;
  if (!sh || (!sh['1m'] && !sh['1y'])) return '';

  const now = gloriskScore(coin.mood);

  function delta(period) {
    if (!sh[period]) return null;
    const prev = gloriskScore(sh[period]);
    const diff = now - prev;
    return { prev, diff, prevLabel: sh[period].label };
  }

  const m1 = delta('1m');
  const y1 = delta('1y');

  function deltaHtml(d, label) {
    if (!d) return '';
    // Color the previous score based on its band
    const prevBand = getMoodBand(d.prevLabel || 'Unsettled');
    return `
      <div class="sh-item">
        <div class="sh-period">${label}</div>
        <div class="sh-prev" style="color:${prevBand.color}">${d.prev}</div>
      </div>
    `;
  }

  // 12-month average
  const avgHtml = coin.avgScore ? `
    <div class="sh-item">
      <div class="sh-period">12M Average</div>
      <div class="sh-prev" style="color:var(--text)">${coin.avgScore}</div>
    </div>
  ` : '';

  return `
    <div class="score-history">
      ${deltaHtml(m1, '1 month ago')}
      ${deltaHtml(y1, '1 year ago')}
      ${avgHtml}
    </div>
  `;
}

/* ── Score band from numeric score (0-100, high = good) ───────────── */

function getScoreBand(score) {
  if (score >= 90) return { label: 'Very Stable', color: '#60A5FA', cls: 'rsb-blue' };
  if (score >= 75) return { label: 'Stable',      color: '#22c55e', cls: 'rsb-green' };
  if (score >= 50) return { label: 'Unstable',    color: '#f59e0b', cls: 'rsb-amber' };
  if (score >= 30) return { label: 'Stressed',    color: '#f97316', cls: 'rsb-orange' };
  return               { label: 'Critical',    color: '#ef4444', cls: 'rsb-red' };
}

/* ── Triple Summary (Risk Score + SWOT Score + GloRisk Score) ─────── */

function buildTripleSummary(coin) {
  const mood = coin.mood;
  const band = getMoodBand(mood.label);
  const ps   = gloriskScore(mood);
  const greenCount = IND_ORDER.filter(k => coin.indicators[k]?.color === 'green').length;
  const amberCount = IND_ORDER.filter(k => coin.indicators[k]?.color === 'amber').length;
  const redCount   = IND_ORDER.filter(k => coin.indicators[k]?.color === 'red').length;

  return `
    <div class="summary-triple">
      <div class="summary-col summary-tech">
        <div class="sd-label">TECHNICAL</div>
        <div class="sd-title">Risk Score</div>
        <div class="sd-score-row">
          <span class="sd-score" style="color:${band.color}">${ps}</span>
          <span class="sd-max">/ 100</span>
        </div>
        <div class="sd-bar"><div class="sd-bar-fill" style="width:${ps}%;background:${band.color}"></div></div>
        <div class="sd-meta">
          <span class="rsb ${moodRsbClass(mood.label)}" style="font-size:0.68rem;padding:3px 10px">${band.displayLabel ?? mood.label}</span>
        </div>
        <div class="sd-counts"><span class="cic-g">${greenCount}G</span> <span class="cic-a">${amberCount}A</span> <span class="cic-r">${redCount}R</span></div>
      </div>
      <div class="summary-col summary-fund" id="fundCol">
        <div class="sd-label">FUNDAMENTAL</div>
        <div class="sd-fund-empty">
          <div style="color:var(--muted);font-size:0.78rem;font-weight:300">SWOT analysis not yet available.</div>
        </div>
      </div>
      <div class="summary-col summary-composite" id="compositeCol">
        <div class="sd-label">COMPOSITE</div>
        <div class="sd-title">GloRisk Score</div>
        <div class="sd-score-row">
          <span class="sd-score" style="color:${band.color}">${ps}</span>
          <span class="sd-max">/ 100</span>
        </div>
        <div class="sd-bar"><div class="sd-bar-fill" style="width:${ps}%;background:${band.color}"></div></div>
        <div class="sd-meta">
          <span class="rsb ${moodRsbClass(mood.label)}" style="font-size:0.68rem;padding:3px 10px">${band.displayLabel ?? mood.label}</span>
        </div>
        <div class="sd-sub" style="color:var(--muted2);font-size:0.6rem;margin-top:0.25rem">Risk only (no SWOT data)</div>
      </div>
    </div>
  `;
}

/* ── Report rendering ──────────────────────────────────────────────── */

function renderReport(coin) {
  const body = document.getElementById('reportBody');
  body.classList.remove('page-fade');
  void body.offsetWidth;
  body.classList.add('page-fade');

  if (chartInst) { chartInst.destroy(); chartInst = null; }
  if (scoreChartInst) { scoreChartInst.destroy(); scoreChartInst = null; }

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
  const shareText = `${coin.ticker} (${coin.company}) is rated ${displayLabel} with a GloRisk Score of ${ps} on DailyFinn.`;
  const shareUrl = window.location.origin + '/browse.html?asset=' + encodeURIComponent(coin.ticker);

  body.innerHTML = `
    <div class="report-hero">
      <div class="hero-info">
        <div class="hero-ticker">${coin.ticker}</div>
        <div class="hero-name">${coin.company}</div>
        <div class="hero-badges">
          <span class="rsb ${rsbCls}">${band.displayLabel ?? mood.label}</span>
          <span class="rsb" id="heroTierBadge" style="display:none"></span>
        </div>
      </div>
      <div class="hero-price-block">
        <div class="hero-price">${formatPrice(coin.price)}</div>
        <div class="hero-change ${changeCls}">${change >= 0 ? '+' : ''}${change.toFixed(2)}% 30D</div>
        <div class="hero-asof">as of ${asOfDateStr}</div>
      </div>
    </div>

    <!-- Report Actions (icon-only toolbar) -->
    <div class="report-actions-bar">
      <button class="ra-icon" id="btnExportPdf" title="Export PDF">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
      </button>
      <button class="ra-icon" id="btnShareX" title="Share on X">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </button>
      <button class="ra-icon" id="btnShareLi" title="Share on LinkedIn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
      </button>
      <button class="ra-icon" id="btnShareImg" title="Share as Image">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      </button>
      <button class="ra-icon" id="btnCopyLink" title="Copy link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      </button>
      <div class="ra-divider"></div>
      <a href="/compare.html?a=${encodeURIComponent(coin.ticker)}" class="ra-icon ra-icon--accent" title="Add to Compare">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M21 3l-9 9"/><path d="M3 21l9-9"/></svg>
      </a>
      <button class="ra-icon ra-icon--accent" id="btnAddStress" title="Add to Stress Test">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      </button>
    </div>

    <!-- Triple Summary (Risk + SWOT + GloRisk) -->
    ${buildTripleSummary(coin)}

    <!-- Risk Summary -->
    <div class="section-title">Risk Summary</div>
    <div class="ai-box" style="margin-bottom:1rem">
      <div class="ai-badge"><div class="ai-dot"></div> Technical Analysis</div>
      <div class="ai-text" id="aiText"></div>
    </div>

    <!-- SWOT Summary (populated by loadDeepAnalysis) -->
    <div id="swotSummaryWrap" style="display:none">
      <div class="ai-box" style="margin-bottom:2rem">
        <div class="ai-badge"><div class="ai-dot"></div> SWOT Analysis</div>
        <div class="ai-text" id="swotSummaryText"></div>
      </div>
    </div>

    <!-- Score Timeline Chart -->
    <div class="section-title">Score History</div>
    <div class="chart-wrap" style="margin-bottom:2rem">
      <div class="chart-header">
        <div class="chart-title">${coin.ticker} \u00b7 GloRisk Score over 12 months</div>
      </div>
      <canvas id="scoreChart" style="max-height:180px"></canvas>
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

    <!-- Risk Analysis -->
    <div class="section-title" style="margin-top:2rem">
      Risk Analysis
      <span class="section-share" id="btnShareAnalysis" title="Share analysis">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Share
      </span>
    </div>
    <div class="full-analysis" id="fullAnalysis">${buildFullAnalysis(coin)}</div>

    <!-- SWOT Analysis (AI-generated, loaded from static JSON) -->
    <div class="section-title" style="margin-top:2rem">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      SWOT Analysis
    </div>
    <div id="deepAnalysis" class="ai-box" style="display:none">
      <div class="ai-badge"><div class="ai-dot"></div>Investment Research</div>
      <div class="ai-text" id="deepAnalysisText"></div>
      <div style="margin-top:1rem;font-size:0.62rem;color:var(--muted);font-family:var(--font-mono)">
        <span id="deepAnalysisMeta"></span>
      </div>
    </div>
    <div id="deepAnalysisEmpty" style="padding:1rem;color:var(--muted);font-size:0.82rem;display:none">
      SWOT analysis report is not yet available for this asset.
    </div>

    <!-- Indicator Definitions -->
    <div class="section-title" style="margin-top:2rem">Risk Indicator Definitions</div>
    <div class="ind-defs-table">${indDefsHTML}</div>

    <!-- SWOT Rating Definitions -->
    <div class="section-title" style="margin-top:2rem">SWOT Rating Definitions</div>
    <div class="ind-defs-table">
      <div class="ind-def-row">
        <div class="ind-def-name" style="display:flex;align-items:center;gap:6px"><span class="fa-dot" style="background:var(--green)"></span> Tier 1 \u2013 Pack Leader</div>
        <div class="ind-def-desc">High-quality businesses with strong fundamentals and favourable external conditions. Internal \u2265 7, External \u2265 7.</div>
      </div>
      <div class="ind-def-row">
        <div class="ind-def-name" style="display:flex;align-items:center;gap:6px"><span class="fa-dot" style="background:var(--amber)"></span> Tier 2 \u2013 Momentum Stock</div>
        <div class="ind-def-desc">Strong companies facing macro or cyclical pressures. Internal \u2265 7, External < 7.</div>
      </div>
      <div class="ind-def-row">
        <div class="ind-def-name" style="display:flex;align-items:center;gap:6px"><span class="fa-dot" style="background:var(--blue)"></span> Tier 3 \u2013 Defensive Holding</div>
        <div class="ind-def-desc">Stable externally but weaker internal fundamentals. Internal < 7, External \u2265 7.</div>
      </div>
      <div class="ind-def-row">
        <div class="ind-def-name" style="display:flex;align-items:center;gap:6px"><span class="fa-dot" style="background:var(--red)"></span> Tier 4 \u2013 Decliner</div>
        <div class="ind-def-desc">Weak businesses with structural or macro challenges. Internal < 7, External < 7.</div>
      </div>
    </div>

    <!-- Disclaimer -->
    <p class="report-disclaimer">Analysis is based on historical price behaviour. Not investment advice. Conditions can change quickly.</p>
  `;

  // Build charts
  buildScoreChart(coin);
  buildChart(coin);

  // Rule-based summary
  generateSummary(coin);

  // Load deep analysis report (pre-generated static JSON)
  loadDeepAnalysis(coin.ticker);

  // Wire share/export buttons
  wireReportActions(coin, shareText, shareUrl);

  // Wire "Add to Stress Test" button
  document.getElementById('btnAddStress')?.addEventListener('click', () => {
    let portfolio = [];
    try { portfolio = JSON.parse(localStorage.getItem('glorisk-portfolio') || '[]'); } catch {}
    if (!portfolio.find(p => p.ticker === coin.ticker)) {
      portfolio.push({ ticker: coin.ticker, value: Math.round(coin.price * 10), shock: 0 });
      localStorage.setItem('glorisk-portfolio', JSON.stringify(portfolio));
    }
    window.location.href = '/stress-test.html';
  });

  // Update tool bar links with current ticker
  const rtbCompare = document.getElementById('rtbCompare');
  if (rtbCompare) rtbCompare.href = `/compare.html?a=${encodeURIComponent(coin.ticker)}`;
  const rtbStress = document.getElementById('rtbStress');
  if (rtbStress) rtbStress.href = '/stress-test.html';
  const mtbCompare = document.getElementById('mtbCompare');
  if (mtbCompare) mtbCompare.href = `/compare.html?a=${encodeURIComponent(coin.ticker)}`;

  // Add save-as-image buttons to charts
  setTimeout(() => {
    document.querySelectorAll('.chart-wrap .chart-header').forEach(header => {
      if (header.querySelector('.save-img-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'save-img-btn';
      btn.title = 'Save as image';
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wrap = header.closest('.chart-wrap');
        const name = header.querySelector('.chart-title')?.textContent?.trim() || 'glorisk-chart';
        saveElementAsImage(wrap, name.replace(/[^a-zA-Z0-9]/g, '-') + '.png');
      });
      header.appendChild(btn);
    });
  }, 100);
}

/* ── Save any element as image with watermark ─────────────────────── */

// Convert canvas elements to img before html2canvas capture
function convertCanvasesToImages(sourceEl, clonedEl) {
  const origCanvases = sourceEl.querySelectorAll('canvas');
  const clonedCanvases = clonedEl.querySelectorAll('canvas');
  clonedCanvases.forEach((clonedCanvas, i) => {
    const origCanvas = origCanvases[i];
    if (origCanvas) {
      const img = document.createElement('img');
      img.src = origCanvas.toDataURL('image/png');
      img.style.cssText = clonedCanvas.style.cssText || '';
      img.style.width = '100%';
      img.style.maxHeight = clonedCanvas.style.maxHeight || '240px';
      clonedCanvas.replaceWith(img);
    }
  });
}

async function saveElementAsImage(el, filename) {
  const tempDiv = document.createElement('div');
  tempDiv.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:900px;padding:2rem;background:#0a0c0f;color:#e8edf2;font-family:Inter,sans-serif;';
  const clone = el.cloneNode(true);
  convertCanvasesToImages(el, clone);
  tempDiv.appendChild(clone);
  tempDiv.querySelectorAll('.save-img-btn, .section-share').forEach(b => b.remove());
  const wm = document.createElement('div');
  wm.style.cssText = 'font-size:0.75rem;color:#3a4250;text-align:center;padding-top:0.75rem;border-top:1px solid #1e2530;margin-top:1rem;';
  wm.textContent = 'dailyfinn.com';
  tempDiv.appendChild(wm);
  document.body.appendChild(tempDiv);
  try {
    const canvas = await html2canvas(tempDiv, { backgroundColor: '#0a0c0f', scale: 2 });
    document.body.removeChild(tempDiv);
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  } catch { document.body.removeChild(tempDiv); }
}

/* ── Image capture helper ──────────────────────────────────────────── */

async function captureReportImage(coin) {
  const reportBody = document.getElementById('reportBody');
  const elements = reportBody.querySelectorAll('.report-hero, .risk-meter-wrap, .ai-box');
  if (!elements.length) return;

  const tempDiv = document.createElement('div');
  tempDiv.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:900px;padding:2rem;background:#0a0c0f;color:#e8edf2;font-family:Inter,sans-serif;';
  elements.forEach(el => {
    const clone = el.cloneNode(true);
    convertCanvasesToImages(el, clone);
    tempDiv.appendChild(clone);
  });
  tempDiv.querySelectorAll('.report-actions').forEach(el => el.remove());
  const wm = document.createElement('div');
  wm.style.cssText = 'font-size:0.75rem;color:#3a4250;text-align:center;padding-top:1rem;border-top:1px solid #1e2530;margin-top:1.5rem;';
  wm.textContent = 'dailyfinn.com';
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

  // Share on X/Twitter — open compose first (must be sync), then capture image to clipboard
  document.getElementById('btnShareX')?.addEventListener('click', () => {
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText + '\n\n' + shareUrl)}`;
    window.open(url, '_blank', 'width=550,height=420');
    captureReportImage(coin).catch(() => {});
  });

  // Share on LinkedIn
  document.getElementById('btnShareLi')?.addEventListener('click', () => {
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
    window.open(url, '_blank', 'width=550,height=520');
    captureReportImage(coin).catch(() => {});
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
    watermark.textContent = 'dailyfinn.com \u00b7 dailyfinn.com';

    elements.forEach(el => {
      const clone = el.cloneNode(true);
      convertCanvasesToImages(el, clone);
      tempDiv.appendChild(clone);
    });
    tempDiv.appendChild(watermark);
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
    header.textContent = `${coin.ticker} \u2014 Full Analysis (GloRisk Score: ${gloriskScore(coin.mood)})`;
    tempDiv.appendChild(header);
    const analysisClone = analysisEl.cloneNode(true);
    convertCanvasesToImages(analysisEl, analysisClone);
    tempDiv.appendChild(analysisClone);
    // Watermark
    const wm = document.createElement('div');
    wm.style.cssText = 'font-size:0.75rem;color:#3a4250;text-align:center;padding-top:1rem;border-top:1px solid #1e2530;margin-top:1rem;';
    wm.textContent = 'dailyfinn.com';
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

/* ── Score timeline chart ──────────────────────────────────────────── */

async function buildScoreChart(coin) {
  const ctx = document.getElementById('scoreChart')?.getContext('2d');
  if (!ctx) return;

  // Fetch per-asset data which contains scoreTimeline
  let assetData;
  try {
    assetData = await fetchAssetData(coin);
  } catch { return; }

  const timeline = assetData?.scoreTimeline;
  if (!timeline || timeline.length < 2) {
    ctx.canvas.closest('.chart-wrap').style.display = 'none';
    return;
  }

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labels = timeline.map(p => {
    const [,m,d] = p.d.split('-');
    return `${parseInt(d)}-${months[parseInt(m)-1]}`;
  });
  const scores = timeline.map(p => p.s);
  const avg = coin.avgScore || Math.round(scores.reduce((s,v) => s+v, 0) / scores.length);

  if (scoreChartInst) { scoreChartInst.destroy(); scoreChartInst = null; }

  scoreChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'GloRisk Score',
          data: scores,
          borderColor: '#00d4ff',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: {
            target: 'origin',
            above: 'rgba(0,212,255,0.06)',
          },
        },
        {
          label: '12M Average',
          data: scores.map(() => avg),
          borderColor: 'rgba(90,100,112,0.5)',
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
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
        },
      },
      scales: {
        x: { grid: { color: '#1e2530' }, ticks: { color: '#5a6470', font: { family: 'DM Mono', size: 10 }, maxTicksLimit: 8, maxRotation: 0 } },
        y: { min: 0, max: 100, position: 'right', grid: { color: '#1e2530' }, ticks: { color: '#5a6470', font: { family: 'DM Mono', size: 10 }, stepSize: 25 } },
      },
    },
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

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labels = history.map(p => {
    const [,m,d] = p.d.split('-');
    return `${parseInt(d)}-${months[parseInt(m)-1]}`;
  });
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

  function cardHTML(title, v, explanation) {
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

  // Build all indicator cards with their explanations
  const allCards = [];

  const indDefs = {
    volatility: v => ({
      title: 'Daily Volatility',
      text: v.raw < 30
        ? `${ticker} has relatively calm daily price movements. An annualised volatility of ${v.label} means day-to-day price swings are modest and more predictable.`
        : v.raw < 60
        ? `${ticker} shows moderate price swings at ${v.label} annualised. The price can move meaningfully from day to day, which is typical for this type of asset.`
        : `${ticker} has high volatility at ${v.label} annualised. The price swings significantly from day to day, making it harder to predict short-term moves.`,
    }),
    volSpike: v => ({
      title: 'Volatility Spike',
      text: v.raw < 1.0
        ? `Recent volatility is lower than the historical average (${v.label}). Price behaviour has been calmer than usual lately \u2014 a stable sign.`
        : v.raw < 2.0
        ? `Recent volatility is slightly above the historical average at ${v.label}. Something may be shifting, but it\u2019s not extreme.`
        : `Recent volatility is ${v.label} the historical average \u2014 a significant spike. This often precedes larger price moves and indicates heightened uncertainty.`,
    }),
    shortTrend: v => ({
      title: '50-Day Trend',
      text: v.raw > 0
        ? `The price is ${v.label} above its 50-day average. The short-term direction is upward \u2014 buyers have been in control recently.`
        : v.raw > -6
        ? `The price is ${v.label} below its 50-day average. It has slipped slightly below the short-term trend, which could signal early weakness.`
        : `The price is ${v.label} below its 50-day average. This is a clear downtrend signal \u2014 the asset has fallen well below where it was trading recently.`,
    }),
    longTrend: v => ({
      title: '200-Day Trend',
      text: v.raw > 0
        ? `The price sits ${v.label} above its 200-day average \u2014 the long-term trend is intact and pointing upward.`
        : v.raw > -10
        ? `The price is ${v.label} below its 200-day average. The long-term trend is starting to weaken but hasn\u2019t broken down completely.`
        : `The price is ${v.label} below its 200-day average. This is a significant long-term downtrend \u2014 the asset has been losing value over an extended period.`,
    }),
    maCross: v => ({
      title: 'Trend Direction',
      text: v.color === 'green'
        ? `The 50-day average is above the 200-day average \u2014 known as a "Golden Cross." This is a widely-watched bullish signal that suggests the overall trend direction is upward.`
        : `The 50-day average has fallen below the 200-day average \u2014 known as a "Death Cross." This is a bearish signal that suggests the overall trend direction is downward.`,
    }),
    vsPeak: v => ({
      title: 'Distance from Peak',
      text: v.raw < 20
        ? `The price is only ${v.label} below its 3-year high. It has held up well and remains close to its peak value.`
        : v.raw < 30
        ? `The price is ${v.label} below its 3-year high. A noticeable pullback from the peak, though not extreme.`
        : `The price is ${v.label} below its 3-year high. This is a deep drawdown \u2014 the asset has lost a significant portion of its peak value and hasn\u2019t recovered.`,
    }),
    return1M: v => ({
      title: '30-Day Return',
      text: v.raw >= 0
        ? `Over the past 30 days, the price has risen ${v.label}. Short-term direction is positive.`
        : v.raw > -10
        ? `Over the past 30 days, the price has fallen ${v.label}. A modest short-term decline.`
        : `Over the past 30 days, the price has dropped ${v.label}. This is a sharp decline that signals significant selling pressure.`,
    }),
    return1Y: v => ({
      title: '12-Month Return',
      text: v.raw > 0
        ? `Over the past 12 months, the price is up ${v.label}. The asset has gained value over the longer term.`
        : v.raw > -20
        ? `Over the past 12 months, the price is down ${v.label}. A moderate decline over the year.`
        : `Over the past 12 months, the price has fallen ${v.label}. This sustained decline indicates a prolonged period of weakness.`,
    }),
    range52W: v => ({
      title: 'Position in Range',
      text: v.raw > 45
        ? `The price is in the upper half of its 52-week range (${v.label}). It\u2019s closer to its yearly high than its low \u2014 a sign of strength.`
        : v.raw > 25
        ? `The price sits in the middle of its 52-week range (${v.label}). It\u2019s neither near the top nor the bottom of its recent trading band.`
        : `The price is near the bottom of its 52-week range (${v.label}). It has given back most of its gains from the past year.`,
    }),
    cagr3Y: v => ({
      title: '3-Year Growth',
      text: v.raw > 0
        ? `The 3-year annual growth rate is ${v.label}. Over three years, the asset has grown in value on an annualised basis \u2014 a positive long-term sign.`
        : `The 3-year annual growth rate is ${v.label}. Over three years, the asset has lost value on an annualised basis \u2014 meaning it has destroyed long-term value.`,
    }),
  };

  for (const key of IND_ORDER) {
    const v = ind[key];
    const def = indDefs[key];
    if (!v || !def) continue;
    const { title, text } = def(v);
    allCards.push({ color: v.color, title, label: v.label, text });
  }

  // Group by severity: red → amber → green
  const groups = [
    { color: 'red',   label: 'Critical',  cards: allCards.filter(c => c.color === 'red') },
    { color: 'amber', label: 'Concerning', cards: allCards.filter(c => c.color === 'amber') },
    { color: 'green', label: 'Going Well', cards: allCards.filter(c => c.color === 'green') },
  ];

  let html = '';
  for (const g of groups) {
    if (!g.cards.length) continue;
    html += `<div class="fa-group-label fa-gl--${g.color}">${g.label} (${g.cards.length})</div>`;
    html += `<table class="fa-table"><thead><tr><th>Indicator</th><th>Data</th><th>Explanation</th></tr></thead><tbody>`;
    for (const c of g.cards) {
      html += `<tr>
        <td class="fa-t-ind">${dot(c.color)} ${c.title}</td>
        <td class="fa-t-data fa-val--${c.color}">${c.label}</td>
        <td class="fa-t-explain">${c.text}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
  }

  return html;
}

/* ── Risk Summary (rule-based) ─────────────────────────────────────── */

/* ── Deep Analysis — data extraction ───────────────────────────────── */

function extractReportData(report) {
  // 1. Extract factor scores from markdown table
  const scores = [];
  for (const line of report.split('\n')) {
    const m = line.match(/\|\s*\*?\*?\d+\.\s*.+?\*?\*?\s*\|\s*(\d+)\s*\|/);
    if (m) scores.push(parseInt(m[1]));
  }
  const internal = scores.length >= 5 ? scores.slice(0, 5) : [];
  const external = scores.length >= 10 ? scores.slice(5, 10) : [];
  const intAvg = internal.length ? +(internal.reduce((a, b) => a + b, 0) / internal.length).toFixed(1) : null;
  const extAvg = external.length ? +(external.reduce((a, b) => a + b, 0) / external.length).toFixed(1) : null;
  const overall = intAvg !== null && extAvg !== null ? +((intAvg + extAvg) / 2).toFixed(1) : null;

  // 2. Extract tier classification
  const tierMatch = report.match(/([\u{1F7E2}\u{1F7E1}\u{1F535}\u{1F534}])\s*\*?\*?Tier\s+(\d)\s+([^*()\n]+)/u);
  const tier = tierMatch ? { number: parseInt(tierMatch[2]), label: tierMatch[3].trim().replace(/\*\*/g, '') } : null;

  // 3. Extract risk & opportunity items
  const riskSection = report.split(/###\s*Risk\s*&?\s*Opportunity\s*Analysis/i)[1]?.split(/###/)[0] || '';
  const tailwinds = [];
  const risks = [];
  for (const line of riskSection.split('\n').filter(l => l.trim())) {
    const itemMatch = line.match(/(?:^-\s*)?\*\*(.+?)\*\*[:\s]*(.+)/);
    if (!itemMatch) continue;
    const fullTitle = itemMatch[1].trim();
    const rawDesc = itemMatch[2].trim().replace(/\[\d+\]/g, '').replace(/\s{2,}/g, ' ');
    const lower = fullTitle.toLowerCase();
    if (lower.includes('risk') || lower.includes('headwind') || lower.includes('threat')) {
      risks.push({ title: fullTitle.replace(/^key\s+(risks?)[:\s]*/i, ''), desc: rawDesc });
    } else {
      tailwinds.push({ title: fullTitle.replace(/^key\s+(tailwinds?|catalysts?)[:\s]*/i, ''), desc: rawDesc });
    }
  }

  return { intAvg, extAvg, overall, tier, tailwinds, risks, scores };
}

/* ── Deep Analysis — custom components ────────────────────────────── */

function buildScoreCardsHTML(intAvg, extAvg, overall) {
  if (intAvg === null) return '';
  const s = v => Math.round(v * 10); // scale to 100
  const clr = v => v >= 80 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)';
  const card = (label, value) =>
    `<div class="da-score-card">
      <div class="da-score-label">${label}</div>
      <div class="da-score-value" style="color:${clr(value)}">${value}<span class="da-score-max"> / 100</span></div>
    </div>`;
  return `<div class="da-scores">${card('INTERNAL RATING', s(intAvg))}${card('EXTERNAL RATING', s(extAvg))}${card('OVERALL RATING', s(overall))}</div>`;
}

function buildMatrixHTML(tier, ticker, intAvg, extAvg) {
  if (!tier) return '';
  const cells = [
    { num: 3, label: 'Tier 3', sub: 'Defensive Holding', color: 'blue' },
    { num: 1, label: 'Tier 1', sub: 'Pack Leader', color: 'green' },
    { num: 4, label: 'Tier 4', sub: 'Weak/Speculative', color: 'red' },
    { num: 2, label: 'Tier 2', sub: 'Momentum Stock', color: 'amber' },
  ];
  // Compute point position inside active cell (percentage)
  const clamp = (v, lo, hi) => Math.max(10, Math.min(90, ((v - lo) / (hi - lo)) * 100));
  // Grid layout: col0 = low internal (0-7), col1 = high internal (7-10)
  //              row0 = high external (7-10), row1 = low external (0-7)
  let pointStyle = '';
  if (intAvg !== null && extAvg !== null) {
    const inRight = intAvg >= 7;
    const exTop   = extAvg >= 7;
    const xPct = inRight ? clamp(intAvg, 7, 10) : clamp(intAvg, 0, 7);
    const yPct = exTop   ? (100 - clamp(extAvg, 7, 10)) : (100 - clamp(extAvg, 0, 7));
    pointStyle = `left:${xPct}%;top:${yPct}%`;
  }

  let grid = '';
  for (const c of cells) {
    const active = c.num === tier.number;
    grid += `<div class="da-mc ${active ? 'da-mc-active' : ''} da-mc-${c.color}">
      <div class="da-mc-dot da-dot-${c.color}"></div>
      <div class="da-mc-tier">${c.label}</div>
      <div class="da-mc-sub">${c.sub}</div>
      ${active ? `<div class="da-mc-point" style="${pointStyle}">\u25C6 <span>${ticker}</span></div>` : ''}
    </div>`;
  }

  return `<div class="da-matrix">
    <div class="da-matrix-inner">
      <div class="da-matrix-ylabel">E X T E R N A L &ensp; R A T I N G &ensp; \u2192</div>
      <div class="da-matrix-grid">${grid}</div>
    </div>
    <div class="da-matrix-xlabel">I N T E R N A L &ensp; R A T I N G &ensp; \u2192</div>
  </div>`;
}

function buildRiskOpportunityHTML(tailwinds, risks) {
  if (!tailwinds.length && !risks.length) return '';
  const renderItems = items => items.map(item =>
    `<div class="da-ro-item">${item.title ? `<strong>${item.title}:</strong> ` : ''}${item.desc}</div>`
  ).join('');

  return `<div class="da-risk">
    <div class="da-risk-header">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      RISK & OPPORTUNITY ANALYSIS
    </div>
    <div class="da-risk-grid">
      <div class="da-risk-col">
        <div class="da-risk-col-title da-risk-tw">\u25B2 TAILWINDS & CATALYSTS</div>
        ${renderItems(tailwinds)}
      </div>
      <div class="da-risk-col">
        <div class="da-risk-col-title da-risk-rk">\u25BC KEY RISKS</div>
        ${renderItems(risks)}
      </div>
    </div>
  </div>`;
}

/* ── Deep Analysis — main loader ──────────────────────────────────── */

async function loadDeepAnalysis(ticker) {
  const box      = document.getElementById('deepAnalysis');
  const textEl   = document.getElementById('deepAnalysisText');
  const metaEl   = document.getElementById('deepAnalysisMeta');
  const emptyEl  = document.getElementById('deepAnalysisEmpty');
  if (!box || !textEl) return;

  try {
    const res = await fetch(`/data/reports/${encodeURIComponent(ticker)}.json`);
    if (!res.ok) throw new Error('not found');
    const data = await res.json();

    // Extract structured data for custom components
    const rd = extractReportData(data.report);

    // Populate hero tier badge
    const heroTierBadge = document.getElementById('heroTierBadge');
    const tierRsbMap = { 1: 'rsb-green', 2: 'rsb-amber', 3: 'rsb-blue', 4: 'rsb-red' };
    const tierLabels = { 1: 'Pack Leader', 2: 'Momentum Stock', 3: 'Defensive Holding', 4: 'Weak/Speculative' };
    if (heroTierBadge && rd.tier) {
      const tierRsb = tierRsbMap[rd.tier.number] || '';
      heroTierBadge.className = `rsb ${tierRsb}`;
      heroTierBadge.textContent = tierLabels[rd.tier.number] || rd.tier.label;
      heroTierBadge.style.display = '';
    }

    // Populate fundamental column (SWOT Score scaled to /100)
    const fundCol = document.getElementById('fundCol');
    const compositeCol = document.getElementById('compositeCol');
    if (fundCol && rd.overall !== null) {
      const swot100 = Math.round(rd.overall * 10);
      const int100  = Math.round(rd.intAvg * 10);
      const ext100  = Math.round(rd.extAvg * 10);
      const swotBand = getScoreBand(swot100);
      const fundTierRsb = rd.tier ? tierRsbMap[rd.tier.number] || '' : '';
      const fundTierLabel = rd.tier ? (tierLabels[rd.tier.number] || rd.tier.label) : '';

      fundCol.innerHTML = `
        <div class="sd-label">FUNDAMENTAL</div>
        <div class="sd-title">SWOT Score</div>
        <div class="sd-score-row">
          <span class="sd-score" style="color:${swotBand.color}">${swot100}</span>
          <span class="sd-max">/ 100</span>
        </div>
        <div class="sd-bar"><div class="sd-bar-fill" style="width:${swot100}%;background:${swotBand.color}"></div></div>
        ${rd.tier ? `<div class="sd-meta"><span class="rsb ${fundTierRsb}" style="font-size:0.68rem;padding:3px 10px">${fundTierLabel}</span></div>` : ''}
        <div class="sd-sub">Int ${int100} \u00b7 Ext ${ext100}</div>
      `;

      // Compute composite GloRisk Score = average of Risk Score + SWOT Score
      const riskScoreEl = document.querySelector('.summary-tech .sd-score');
      const riskScore = riskScoreEl ? parseInt(riskScoreEl.textContent) : 50;
      const glorisk = Math.round((riskScore + swot100) / 2);
      const gloBand = getScoreBand(glorisk);

      if (compositeCol) {
        compositeCol.innerHTML = `
          <div class="sd-label">COMPOSITE</div>
          <div class="sd-title">GloRisk Score</div>
          <div class="sd-score-row">
            <span class="sd-score" style="color:${gloBand.color}">${glorisk}</span>
            <span class="sd-max">/ 100</span>
          </div>
          <div class="sd-bar"><div class="sd-bar-fill" style="width:${glorisk}%;background:${gloBand.color}"></div></div>
          <div class="sd-meta">
            <span class="rsb ${gloBand.cls}" style="font-size:0.68rem;padding:3px 10px">${gloBand.label}</span>
          </div>
          <div class="sd-sub">Risk ${riskScore} \u00b7 SWOT ${swot100}</div>
        `;
      }
    }

    // Populate SWOT Summary block (executive summary from report)
    const swotWrap = document.getElementById('swotSummaryWrap');
    const swotText = document.getElementById('swotSummaryText');
    if (swotWrap && swotText) {
      const execSection = data.report.split(/###\s*Executive\s+Summary/i)[1]?.split(/###/)[0] || '';
      const execClean = execSection.trim()
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[\d+\]/g, '')
        .replace(/\n{2,}/g, '</p><p>');
      if (execClean) {
        swotText.innerHTML = `<p>${execClean}</p>`;
        swotWrap.style.display = 'block';
      }
    }

    // Parse markdown tables into styled HTML tables
    function parseMarkdownTable(block) {
      const rows = block.trim().split('\n').filter(r => r.trim());
      if (rows.length < 2) return block;
      const parseRow = r => r.split('|').map(c => c.trim()).filter(c => c);
      const headers = parseRow(rows[0]);
      const startIdx = rows[1]?.includes('---') ? 2 : 1;
      const bodyRows = rows.slice(startIdx);
      let t = '<div style="overflow-x:auto;margin:1rem 0"><table style="width:100%;border-collapse:separate;border-spacing:0;font-size:0.78rem;background:var(--bg);border:1px solid var(--border);border-radius:8px;overflow:hidden">';
      t += '<thead><tr>';
      headers.forEach(h => { t += `<th style="padding:10px 12px;text-align:left;font-family:var(--font-mono);font-size:0.62rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);background:var(--surface2);border-bottom:1px solid var(--border)">${h.replace(/\*\*/g,'')}</th>`; });
      t += '</tr></thead><tbody>';
      bodyRows.forEach(r => {
        const cells = parseRow(r);
        t += '<tr>';
        cells.forEach((c, i) => {
          let val = c.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
          if (i === 1 && /^\d+$/.test(c.trim())) {
            const n = parseInt(c);
            const clr = n >= 8 ? 'var(--green)' : n >= 6 ? 'var(--amber)' : 'var(--red)';
            val = `<span style="color:${clr};font-weight:600;font-family:var(--font-display)">${c}</span>`;
          }
          t += `<td style="padding:10px 12px;border-bottom:1px solid var(--border);${i === 0 ? 'font-weight:500;color:var(--text)' : 'color:var(--muted);font-weight:300'}">${val}</td>`;
        });
        t += '</tr>';
      });
      t += '</tbody></table></div>';
      return t;
    }

    // Parse a markdown content block (non-header lines)
    function parseMarkdownBlock(content) {
      const lines = content.split('\n');
      let h = '';
      let tableBuffer = [];
      let inTable = false;
      for (const line of lines) {
        const trimmed = line.trim();
        const isTableRow = trimmed.startsWith('|') && trimmed.endsWith('|');
        if (isTableRow) { inTable = true; tableBuffer.push(trimmed); continue; }
        if (inTable) { h += parseMarkdownTable(tableBuffer.join('\n')); tableBuffer = []; inTable = false; }
        if (!trimmed) { h += '</p><p>'; }
        else if (trimmed.startsWith('- ')) { h += `<div style="display:flex;gap:8px;margin:4px 0;font-size:0.88rem;line-height:1.6"><span style="color:var(--accent);flex-shrink:0">\u2022</span><span>${trimmed.slice(2)}</span></div>`; }
        else { h += trimmed + '<br>'; }
      }
      if (tableBuffer.length) h += parseMarkdownTable(tableBuffer.join('\n'));
      return h;
    }

    // Split report into sections by ### headers
    const sections = [];
    let curSection = { title: '', content: '' };
    for (const line of data.report.split('\n')) {
      const hMatch = line.match(/^###?\s+(.+)/);
      if (hMatch) {
        if (curSection.title || curSection.content.trim()) sections.push(curSection);
        curSection = { title: hMatch[1].trim(), content: '' };
      } else {
        curSection.content += line + '\n';
      }
    }
    if (curSection.title || curSection.content.trim()) sections.push(curSection);

    // Build HTML, replacing structured sections with custom components
    let html = '';
    for (const section of sections) {
      // Skip exec summary — already shown as SWOT Summary above
      if (section.title.match(/executive\s+summary/i)) {
        continue;
      }
      if (section.title.match(/internal\s+vs\.?\s+external/i)) {
        html += buildScoreCardsHTML(rd.intAvg, rd.extAvg, rd.overall);
        continue;
      }
      if (section.title.match(/matrix\s+placement/i)) {
        html += buildMatrixHTML(rd.tier, ticker, rd.intAvg, rd.extAvg);
        continue;
      }
      if (section.title.match(/risk\s*&?\s*opportunity/i)) {
        html += buildRiskOpportunityHTML(rd.tailwinds, rd.risks);
        continue;
      }
      // Regular section — rename legacy "Investment Verdict" to "Overall Verdict"
      if (section.title) {
        const displayTitle = section.title.replace(/investment\s+verdict/i, 'Overall Verdict');
        html += `<h4 style="font-family:var(--font-display);font-size:0.95rem;font-weight:700;margin:1.5rem 0 0.5rem;color:var(--text);display:flex;align-items:center;gap:8px">${displayTitle}</h4>`;
      }
      html += parseMarkdownBlock(section.content);
    }

    // Post-process inline formatting
    html = html
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(\d+)\]/g, '<sup style="color:var(--accent);font-size:0.6rem;cursor:pointer" title="Source $1">[$1]</sup>')
      .replace(/\u{1F7E2}\s*Tier 1[^<]*/gu, m => `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);border-radius:6px;color:var(--green);font-weight:600;font-size:0.82rem;margin:4px 0">\u{1F7E2} ${m.slice(2)}</span>`)
      .replace(/\u{1F7E1}\s*Tier 2[^<]*/gu, m => `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:6px;color:var(--amber);font-weight:600;font-size:0.82rem;margin:4px 0">\u{1F7E1} ${m.slice(2)}</span>`)
      .replace(/\u{1F535}\s*Tier 3[^<]*/gu, m => `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.2);border-radius:6px;color:var(--blue);font-weight:600;font-size:0.82rem;margin:4px 0">\u{1F535} ${m.slice(2)}</span>`)
      .replace(/\u{1F534}\s*Tier 4[^<]*/gu, m => `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:6px;color:var(--red);font-weight:600;font-size:0.82rem;margin:4px 0">\u{1F534} ${m.slice(2)}</span>`);

    html = '<p>' + html + '</p>';
    html = html.replace(/<p>\s*<\/p>/g, '').replace(/<p><br>/g, '<p>').replace(/<br><\/p>/g, '</p>');

    textEl.innerHTML = html;

    // Add clickable sources section
    if (data.citations?.length) {
      let sourcesHTML = '<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border)">';
      sourcesHTML += '<div style="font-family:var(--font-mono);font-size:0.6rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted2);margin-bottom:0.5rem">Sources</div>';
      sourcesHTML += '<div style="display:flex;flex-direction:column;gap:4px">';
      data.citations.forEach((url, i) => {
        const domain = url.replace(/^https?:\/\//, '').split('/')[0];
        sourcesHTML += `<a href="${url}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;font-size:0.72rem;color:var(--muted);text-decoration:none;padding:4px 0;transition:color 0.15s"><span style="color:var(--accent);font-family:var(--font-mono);font-size:0.6rem;min-width:18px">[${i+1}]</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${domain}</span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;opacity:0.4"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`;
      });
      sourcesHTML += '</div></div>';
      textEl.innerHTML += sourcesHTML;
    }

    box.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';

    // Meta line
    const genDate = data.generated ? new Date(data.generated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    if (metaEl) metaEl.textContent = `Generated ${genDate} \u00b7 Powered by Perplexity AI`;
  } catch {
    // No report available for this ticker
    if (box) box.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
  }
}

function generateSummary(coin) {
  const aiText = document.getElementById('aiText');
  if (!aiText) return;

  const ind = coin.indicators;
  const prev = coin.scoreHistory?.['1m']?.indicators; // 1M-ago indicator snapshot
  const displayLabel = getMoodBand(coin.mood.label).displayLabel ?? coin.mood.label;
  const ps = gloriskScore(coin.mood);
  const prevScore = coin.scoreHistory?.['1m'] ? gloriskScore(coin.scoreHistory['1m']) : null;
  const prevLabel = coin.scoreHistory?.['1m'] ? (getMoodBand(coin.scoreHistory['1m'].label).displayLabel ?? coin.scoreHistory['1m'].label) : null;

  // Colour rank for comparison: green=0, amber=1, red=2
  const colorRank = { green: 0, amber: 1, red: 2 };
  const indNames = {
    volatility: 'Daily Volatility', volSpike: 'Volatility Spike', vsPeak: 'Distance from Peak',
    shortTrend: '50-Day Trend', longTrend: '200-Day Trend', maCross: 'Trend Direction',
    return1M: '30-Day Return', return1Y: '12-Month Return', range52W: 'Position in Range', cagr3Y: '3-Year Growth',
  };

  // Opening line with score + direction
  let html = `<p><strong>${coin.company}</strong> is rated <strong>${displayLabel}</strong> with a GloRisk Score of <strong>${ps}</strong>`;
  if (prevScore !== null) {
    const diff = ps - prevScore;
    if (diff > 0) html += ` <span style="color:var(--green)">\u2191${diff} pts</span> from ${prevScore}`;
    else if (diff < 0) html += ` <span style="color:var(--red)">\u2193${Math.abs(diff)} pts</span> from ${prevScore}`;
    else html += `, unchanged from last month`;
    if (prevLabel && prevLabel !== displayLabel) {
      html += ` (was <strong>${prevLabel}</strong>)`;
    }
  }
  html += `.</p>`;

  // Compare current vs 1M-ago indicators
  if (prev) {
    const improved = [], deteriorated = [], unchanged = [];

    for (const key of IND_ORDER) {
      const curr = ind[key];
      const p = prev[key];
      if (!curr || !p) continue;
      const name = indNames[key] || key;
      const currRank = colorRank[curr.color] ?? 1;
      const prevRank = colorRank[p.color] ?? 1;

      if (currRank < prevRank) {
        // Improved (lower rank = healthier)
        improved.push({ name, from: p, to: curr });
      } else if (currRank > prevRank) {
        // Deteriorated
        deteriorated.push({ name, from: p, to: curr });
      } else {
        unchanged.push({ name, color: curr.color, label: curr.label });
      }
    }

    // Deteriorated indicators
    if (deteriorated.length) {
      const lines = deteriorated.map(d =>
        `<strong>${d.name}</strong> moved from ${d.from.label} to ${d.to.label}`
      );
      html += `<p><span style="color:var(--red)">\u25cf Deteriorated (${deteriorated.length}):</span> ${lines.join('; ')}.</p>`;
    }

    // Improved indicators
    if (improved.length) {
      const lines = improved.map(d =>
        `<strong>${d.name}</strong> moved from ${d.from.label} to ${d.to.label}`
      );
      html += `<p><span style="color:var(--green)">\u25cf Improved (${improved.length}):</span> ${lines.join('; ')}.</p>`;
    }

    // Unchanged summary
    if (unchanged.length) {
      const greenCount = unchanged.filter(u => u.color === 'green').length;
      const amberCount = unchanged.filter(u => u.color === 'amber').length;
      const redCount   = unchanged.filter(u => u.color === 'red').length;
      const parts = [];
      if (greenCount) parts.push(`<span style="color:var(--green)">${greenCount} green</span>`);
      if (amberCount) parts.push(`<span style="color:var(--amber)">${amberCount} amber</span>`);
      if (redCount)   parts.push(`<span style="color:var(--red)">${redCount} red</span>`);
      html += `<p><span style="color:var(--muted)">\u25cf Unchanged (${unchanged.length}):</span> ${parts.join(', ')} \u2014 ${unchanged.map(u => u.name).join(', ')}.</p>`;
    }

    // Net assessment
    if (!deteriorated.length && !improved.length) {
      html += `<p>The risk profile is unchanged from last month across all 10 indicators.</p>`;
    } else if (deteriorated.length > improved.length) {
      html += `<p>Overall, the risk profile has <strong>deteriorated</strong> this month with ${deteriorated.length} indicator${deteriorated.length > 1 ? 's' : ''} worsening vs ${improved.length} improving.</p>`;
    } else if (improved.length > deteriorated.length) {
      html += `<p>Overall, the risk profile has <strong>improved</strong> this month with ${improved.length} indicator${improved.length > 1 ? 's' : ''} improving vs ${deteriorated.length} worsening.</p>`;
    } else {
      html += `<p>The risk profile is <strong>mixed</strong> this month \u2014 ${improved.length} indicator${improved.length > 1 ? 's' : ''} improved and ${deteriorated.length} worsened.</p>`;
    }
  } else {
    // No previous data — fall back to current-state summary
    const g = IND_ORDER.filter(k => ind[k]?.color === 'green').length;
    const a = IND_ORDER.filter(k => ind[k]?.color === 'amber').length;
    const r = IND_ORDER.filter(k => ind[k]?.color === 'red').length;
    html += `<p>Currently showing <span style="color:var(--green)">${g} green</span>, <span style="color:var(--amber)">${a} amber</span>, and <span style="color:var(--red)">${r} red</span> indicators across the 10 risk metrics tracked.</p>`;

    if (r === 0 && a === 0) {
      html += `<p>No risk signals are active. The asset is showing stability across all indicators.</p>`;
    } else if (r >= 5) {
      html += `<p>Multiple risk signals are elevated. The asset is under significant stress.</p>`;
    }
  }

  aiText.innerHTML = html;
}

/* ── Boot ──────────────────────────────────────────────────────────── */

init().catch(console.error);
