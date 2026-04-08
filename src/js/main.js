/**
 * DailyFinn — Main Application
 * ─────────────────────────────────────────────────────────────────────────────
 * SPA entry point: landing, browse grid, per-asset report.
 */

'use strict';

import { getMoodBand, IND_META, IND_ORDER, MAX_SCORE, computeFitScore, getFitLabel, getFitColor, getFitClass, getProfile, getProfileSummary, FIT_QUESTIONS, isAssetInScope } from './riskEngine.js';
import { isWatched, addToWatchlistWithPrompt, removeFromWatchlist, showToast } from './lists.js';
import { loadData, searchCoins, fetchAssetData } from './data.js';
import html2canvas from 'html2canvas';
import { getUser, signOut } from './supabase.js';

/* ── Formatting ────────────────────────────────────────────────────── */

const CURRENCY_MAP = { FTSE100: 'p', Nikkei225: '¥', HSI: 'HK$' };
function getCurrencySymbol(group) { return CURRENCY_MAP[group] || '$'; }

function formatPrice(p, group) {
  const sym = getCurrencySymbol(group);
  if (p == null) return '—';
  const suffix = group === 'FTSE100';
  if (suffix) {
    return p.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + 'p';
  }
  if (p < 0.0001) return sym + p.toFixed(8);
  if (p < 0.01)   return sym + p.toFixed(6);
  if (p < 1)      return sym + p.toFixed(4);
  return sym + p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const STOCK_GROUPS = ['SP500', 'FTSE100', 'Nikkei225', 'HSI', 'NASDAQ100'];
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
let browseQuery  = '';     // text filter from browse search
let activeScoreTab = 'performance'; // 'performance', 'position', 'glorisk'
let wizardFilters = {
  markets: [],
  perfRating: 'any',
  posClass: [],
  indicators: {},
  priceChange: 'any',
};
let wizardOpen = false;
let activeView = 'table';

function getSavedFilters() {
  try { return JSON.parse(localStorage.getItem('glorisk-saved-filters') || '[]'); } catch { return []; }
}
function saveFilter(name, filters) {
  const saved = getSavedFilters();
  saved.push({ name, filters: JSON.parse(JSON.stringify(filters)), created: Date.now() });
  localStorage.setItem('glorisk-saved-filters', JSON.stringify(saved));
}
function deleteFilter(idx) {
  const saved = getSavedFilters();
  saved.splice(idx, 1);
  localStorage.setItem('glorisk-saved-filters', JSON.stringify(saved));
}

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

  document.getElementById('sortSelect').addEventListener('change', renderCards);

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

  // View toggle (Table / Cards)
  document.getElementById('viewToggle')?.querySelectorAll('.vt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeView = btn.dataset.view;
      renderCards();
    });
  });

  // Score tabs (Performance | Position | GloRisk)
  const scoreTabsEl = document.getElementById('scoreTabs');
  if (scoreTabsEl) {
    scoreTabsEl.addEventListener('click', e => {
      const tab = e.target.closest('.score-tab');
      if (!tab) return;
      scoreTabsEl.querySelectorAll('.score-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeScoreTab = tab.dataset.scoreTab;
      renderCards();
    });
  }

  document.getElementById('backLink')?.addEventListener('click', showLanding);
  document.getElementById('navLogo')?.addEventListener('click', showLanding);

  // Read wizard params from URL (set by home page wizard redirect)
  const wizToggle = document.getElementById('wizardToggle');
  const wizPanel = document.getElementById('wizardPanel');
  if (wizToggle && wizPanel) {
    const urlParams = new URLSearchParams(window.location.search);
      // If screener=1, just open the wizard
      if (urlParams.get('screener') === '1' && !urlParams.has('markets') && !urlParams.has('perf')) {
        wizardOpen = true;
        wizPanel.style.display = '';
        wizToggle.classList.add('active');
      }
    if (urlParams.has('markets') || urlParams.has('perf') || urlParams.has('pos') || urlParams.has('ind') || urlParams.has('price')) {
      // Open wizard and apply params
      wizardOpen = true;
      wizPanel.style.display = '';
      wizToggle.classList.add('active');
      if (urlParams.has('markets')) {
        const m = urlParams.get('markets').split(',');
        wizardFilters.markets = m;
        m.forEach(v => { const cb = wizPanel.querySelector(`.wiz-market[value="${v}"]`); if (cb) cb.checked = true; });
      }
      if (urlParams.has('perf')) {
        wizardFilters.perfRating = urlParams.get('perf');
        wizPanel.querySelectorAll('[data-perf]').forEach(b => b.classList.toggle('active', b.dataset.perf === wizardFilters.perfRating));
      }
      if (urlParams.has('pos')) {
        const p = urlParams.get('pos').split(',');
        wizardFilters.posClass = p;
        p.forEach(v => { const btn = wizPanel.querySelector(`[data-pos="${v}"]`); if (btn) btn.classList.add('active'); });
      }
      if (urlParams.has('ind')) {
        try { wizardFilters.indicators = JSON.parse(urlParams.get('ind')); } catch {}
        for (const [k, v] of Object.entries(wizardFilters.indicators)) {
          const sel = wizPanel.querySelector(`.wiz-ind[data-ind="${k}"]`); if (sel) sel.value = v;
        }
      }
      if (urlParams.has('price')) {
        wizardFilters.priceChange = urlParams.get('price');
        wizPanel.querySelectorAll('[data-price]').forEach(b => b.classList.toggle('active', b.dataset.price === wizardFilters.priceChange));
      }
    }

  // Wizard toggle
    wizToggle.addEventListener('click', () => {
      wizardOpen = !wizardOpen;
      wizPanel.style.display = wizardOpen ? '' : 'none';
      wizToggle.classList.toggle('active', wizardOpen);
    });

    // Market checkboxes
    wizPanel.querySelectorAll('.wiz-market').forEach(cb => {
      cb.addEventListener('change', () => {
        wizardFilters.markets = [...wizPanel.querySelectorAll('.wiz-market:checked')].map(el => el.value);
        renderCards();
      });
    });

    // Performance rating pills (single select)
    wizPanel.querySelectorAll('[data-perf]').forEach(btn => {
      btn.addEventListener('click', () => {
        wizPanel.querySelectorAll('[data-perf]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        wizardFilters.perfRating = btn.dataset.perf;
        renderCards();
      });
    });

    // Position classification pills (multi-select toggle)
    wizPanel.querySelectorAll('[data-pos]').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        wizardFilters.posClass = [...wizPanel.querySelectorAll('[data-pos].active')].map(b => b.dataset.pos);
        renderCards();
      });
    });

    // Indicator dropdowns
    wizPanel.querySelectorAll('.wiz-ind').forEach(sel => {
      sel.addEventListener('change', () => {
        const key = sel.dataset.ind;
        if (sel.value === 'any') delete wizardFilters.indicators[key];
        else wizardFilters.indicators[key] = sel.value;
        renderCards();
      });
    });

    // Price change pills (single select)
    wizPanel.querySelectorAll('[data-price]').forEach(btn => {
      btn.addEventListener('click', () => {
        wizPanel.querySelectorAll('[data-price]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        wizardFilters.priceChange = btn.dataset.price;
        renderCards();
      });
    });

    // Reset
    document.getElementById('wizardReset')?.addEventListener('click', () => {
      wizardFilters = { markets: [], perfRating: 'any', posClass: [], indicators: {}, priceChange: 'any' };
      wizPanel.querySelectorAll('.wiz-market').forEach(cb => cb.checked = false);
      wizPanel.querySelectorAll('.wiz-pill').forEach(b => b.classList.remove('active'));
      wizPanel.querySelectorAll('[data-perf="any"]').forEach(b => b.classList.add('active'));
      wizPanel.querySelectorAll('[data-price="any"]').forEach(b => b.classList.add('active'));
      wizPanel.querySelectorAll('.wiz-ind').forEach(s => s.value = 'any');
      renderCards();
    });

  // Save filter button
  document.getElementById('wizardSave')?.addEventListener('click', () => {
    const hasFilters = wizardFilters.markets.length || wizardFilters.perfRating !== 'any' || wizardFilters.posClass.length || Object.keys(wizardFilters.indicators).length || wizardFilters.priceChange !== 'any';
    if (!hasFilters) return;
    const name = prompt('Name this filter:');
    if (!name?.trim()) return;
    saveFilter(name.trim(), wizardFilters);
    renderSavedFilters();
  });

  // Render saved filters
  function renderSavedFilters() {
    const container = document.getElementById('savedFiltersList');
    if (!container) return;
    const saved = getSavedFilters();
    if (!saved.length) {
      container.innerHTML = '<div style="color:var(--muted2);font-size:0.68rem;padding:4px 0">No saved filters yet</div>';
      return;
    }
    container.innerHTML = saved.map((s, i) => `
      <div class="saved-filter-item">
        <button class="saved-filter-btn" data-sf-idx="${i}">${s.name}</button>
        <button class="saved-filter-del" data-sf-del="${i}" title="Delete">&times;</button>
      </div>
    `).join('');
    container.querySelectorAll('.saved-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = getSavedFilters()[btn.dataset.sfIdx];
        if (!s) return;
        wizardFilters = JSON.parse(JSON.stringify(s.filters));
        // Apply to UI
        wizPanel.querySelectorAll('.wiz-market').forEach(cb => cb.checked = wizardFilters.markets.includes(cb.value));
        wizPanel.querySelectorAll('[data-perf]').forEach(b => b.classList.toggle('active', b.dataset.perf === wizardFilters.perfRating));
        wizPanel.querySelectorAll('[data-pos]').forEach(b => b.classList.toggle('active', wizardFilters.posClass.includes(b.dataset.pos)));
        wizPanel.querySelectorAll('.wiz-ind').forEach(s => s.value = wizardFilters.indicators[s.dataset.ind] || 'any');
        wizPanel.querySelectorAll('[data-price]').forEach(b => b.classList.toggle('active', b.dataset.price === wizardFilters.priceChange));
        // Open wizard if closed
        if (!wizardOpen) { wizardOpen = true; wizPanel.style.display = ''; wizToggle.classList.add('active'); }
        renderCards();
      });
    });
    container.querySelectorAll('.saved-filter-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteFilter(parseInt(btn.dataset.sfDel));
        renderSavedFilters();
      });
    });
  }
  renderSavedFilters();
  }

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

/* ── Browse grid ───────────────────────────────────────────────────── */

const STOCK_GROUPS = ['SP500', 'FTSE100', 'Nikkei225', 'HSI', 'NASDAQ100'];

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
  const q = browseQuery.toLowerCase();
  const tab = activeScoreTab; // 'performance', 'position', 'glorisk'

  // Position and GloRisk tabs only show stocks with positionScore
  const isPositionTab = tab === 'position' || tab === 'glorisk';

  let coins = getSortedCoins().filter(c =>
    (!q || c.ticker.toLowerCase().includes(q) || c.company.toLowerCase().includes(q))
  );

  // For position/glorisk tabs, further filter to stocks with positionScore
  if (isPositionTab) {
    coins = coins.filter(c => STOCK_GROUPS.includes(c.group) && c.positionScore != null);
  }

  // Wizard filters
  if (wizardFilters.markets.length) {
    coins = coins.filter(c => wizardFilters.markets.includes(c.group));
  }
  if (wizardFilters.perfRating !== 'any') {
    // scoreBand is defined below, so inline the logic here
    const bandLabel = (score) => {
      if (score >= 90) return 'Very Stable';
      if (score >= 80) return 'Stable';
      if (score >= 60) return 'Unstable';
      if (score >= 40) return 'Stressed';
      return 'Critical';
    };
    coins = coins.filter(c => bandLabel(gloriskScore(c.mood)) === wizardFilters.perfRating);
  }
  if (wizardFilters.posClass.length) {
    coins = coins.filter(c => c.positionLabel && wizardFilters.posClass.includes(c.positionLabel));
  }
  for (const [key, color] of Object.entries(wizardFilters.indicators)) {
    coins = coins.filter(c => c.indicators[key]?.color === color);
  }
  if (wizardFilters.priceChange === 'gainers') coins = coins.filter(c => (c.priceChange || 0) > 0);
  if (wizardFilters.priceChange === 'losers') coins = coins.filter(c => (c.priceChange || 0) < 0);

  // Sort by the relevant score (descending — highest first) when dropdown is default
  const sortVal = document.getElementById('sortSelect').value;
  if (sortVal === 'default') {
    if (tab === 'performance') {
      coins.sort((a, b) => gloriskScore(b.mood) - gloriskScore(a.mood));
    } else if (tab === 'position') {
      coins.sort((a, b) => (b.positionScore || 0) - (a.positionScore || 0));
    } else if (tab === 'glorisk') {
      coins.sort((a, b) => {
        const aComposite = Math.round((gloriskScore(a.mood) + (a.positionScore || 0)) / 2);
        const bComposite = Math.round((gloriskScore(b.mood) + (b.positionScore || 0)) / 2);
        return bComposite - aComposite;
      });
    }
  }

  countEl.innerHTML = `Showing <span>${coins.length}</span> of ${allCoins.length} assets`;

  // Update wizard count
  const wizCount = document.getElementById('wizardCount');
  if (wizCount) wizCount.textContent = coins.length;

  // Toggle 3-col grid class
  grid.classList.add('grid-3col');

  if (!coins.length) {
    grid.innerHTML = `<div class="no-results" style="grid-column:1/-1">No assets match your filters.</div>`;
    return;
  }

  // Helper: get score band from numeric score
  function scoreBand(score) {
    if (score >= 90) return { label: 'Very Stable', color: '#60a5fa' };
    if (score >= 80) return { label: 'Stable',      color: '#22c55e' };
    if (score >= 60) return { label: 'Unstable',    color: '#f59e0b' };
    if (score >= 40) return { label: 'Stressed',    color: '#f97316' };
    return               { label: 'Critical',    color: '#ef4444' };
  }

  // Helper: build issue counts (only show amber/red — all green = clean card)
  function issueCountsHTML(amberCount, redCount) {
    if (!amberCount && !redCount) return '';
    const parts = [];
    if (amberCount) parts.push(`<span style="color:var(--amber)">${amberCount} warning</span>`);
    if (redCount) parts.push(`<span style="color:var(--red)">${redCount} critical</span>`);
    return `<div class="card-v2-issues">${parts.join(' \u00b7 ')}</div>`;
  }

  grid.innerHTML = coins.map(c => {
    const moodKey   = c.mood.label.toLowerCase().replace(' ', '-');
    const change    = c.priceChange || 0;
    const changeClass = change >= 0 ? 'pos' : 'neg';
    const perfScore = gloriskScore(c.mood);
    const perfBand  = scoreBand(perfScore);

    let score, scoreColor, labelText, issuesHtml;

    if (tab === 'performance') {
      score = perfScore;
      scoreColor = perfBand.color;
      labelText = perfBand.label;
      const a = IND_ORDER.filter(k => c.indicators[k]?.color === 'amber').length;
      const r = IND_ORDER.filter(k => c.indicators[k]?.color === 'red').length;
      issuesHtml = issueCountsHTML(a, r);

    } else if (tab === 'position') {
      score = c.positionScore || 0;
      labelText = c.positionLabel || '';
      const posBand = scoreBand(score);
      scoreColor = posBand.color;
      const posScores = c.positionScores || [];
      const a = posScores.filter(v => v >= 5 && v < 8).length;
      const r = posScores.filter(v => v < 5).length;
      issuesHtml = issueCountsHTML(a, r);

    } else {
      // glorisk tab: composite
      const posScore = c.positionScore || 0;
      score = Math.round((perfScore + posScore) / 2);
      const compBand = scoreBand(score);
      scoreColor = compBand.color;
      labelText = compBand.label;
      // Show both sub-scores inline
      const perfLabel = perfBand.label;
      const posLabel = c.positionLabel || scoreBand(posScore).label;
      issuesHtml = `<div class="card-v2-issues"><span style="color:var(--muted)">Perf ${perfScore}</span> \u00b7 <span style="color:var(--muted)">Pos ${posScore}</span></div>`;
    }

    return `
      <div class="asset-card-v2 mood-${moodKey}" data-ticker="${c.ticker}">
        <div class="card-v2-top">
          <div class="card-v2-left">
            <div class="card-v2-ticker">${c.ticker}</div>
            <div class="card-v2-name">${c.company}</div>
          </div>
          <div class="card-v2-right">
            <div class="card-v2-score-line">
              <span class="card-v2-score" style="color:${scoreColor}">${score}</span>
              <span class="card-v2-label">${labelText}</span>
            </div>
            <div class="card-v2-price-line">
              <span class="card-v2-price">${formatPrice(c.price, c.group)}</span>
              <span class="card-v2-change ${changeClass}">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span>
            </div>
          </div>
        </div>
        ${issuesHtml}
      </div>
    `;
  }).join('');

  // Card click
  grid.querySelectorAll('.asset-card-v2').forEach(card => {
    card.addEventListener('click', () => {
      const coin = allCoins.find(c => c.ticker === card.dataset.ticker);
      if (coin) showReport(coin);
    });
  });

  // Toggle view
  const cardsGrid = document.getElementById('cardsGrid');
  const tableWrap = document.getElementById('browseTableWrap');
  const tableBody = document.getElementById('browseTableBody');
  if (cardsGrid && tableWrap) {
    if (activeView === 'table') {
      cardsGrid.style.display = 'none';
      tableWrap.style.display = '';
      // Render table rows
      if (tableBody) {
        tableBody.innerHTML = coins.map(c => {
          const perfScore = gloriskScore(c.mood);
          const perfBand = scoreBand(perfScore);
          const change = c.priceChange || 0;
          const changeClass = change >= 0 ? 'pos' : 'neg';

          let score, scoreColor, labelText;
          if (tab === 'performance') {
            score = perfScore; scoreColor = perfBand.color; labelText = perfBand.label;
          } else if (tab === 'position') {
            score = c.positionScore || 0;
            const pb = scoreBand(score); scoreColor = pb.color; labelText = c.positionLabel || pb.label;
          } else {
            const posScore = c.positionScore || 0;
            score = Math.round((perfScore + posScore) / 2);
            const cb = scoreBand(score); scoreColor = cb.color; labelText = cb.label;
          }

          const return1Y = c.indicators?.return1Y?.label || '\u2014';
          const posScore = c.positionScore || null;

          return `<tr style="cursor:pointer" data-ticker="${c.ticker}">
            <td><div class="st-ticker">${c.ticker}</div><div class="st-name">${c.company}</div></td>
            <td class="st-right">${formatPrice(c.price, c.group)}</td>
            <td class="st-right"><span class="card-v2-change ${changeClass}">${change >= 0 ? '+' : ''}${change.toFixed(1)}%</span></td>
            <td class="st-right st-td-1y">${return1Y}</td>
            <td class="st-fit" style="color:${scoreColor}">${score}</td>
            <td class="st-label" style="color:${scoreColor}">${labelText}</td>
            <td class="st-right st-td-1y">${perfScore}</td>
            <td class="st-right st-td-1y">${posScore || '\u2014'}</td>
          </tr>`;
        }).join('');

        tableBody.querySelectorAll('tr').forEach(row => {
          row.addEventListener('click', () => {
            const coin = allCoins.find(c => c.ticker === row.dataset.ticker);
            if (coin) showReport(coin);
          });
        });
      }
    } else {
      cardsGrid.style.display = '';
      tableWrap.style.display = 'none';
    }
  }
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
  if (score >= 80) return { label: 'Stable',      color: '#22c55e', cls: 'rsb-green' };
  if (score >= 60) return { label: 'Unstable',    color: '#f59e0b', cls: 'rsb-amber' };
  if (score >= 40) return { label: 'Stressed',    color: '#f97316', cls: 'rsb-orange' };
  return               { label: 'Critical',    color: '#ef4444', cls: 'rsb-red' };
}

/* ── GloRisk Score (single headline card) ─────────────────────────── */

function buildFitRows(coin) {
  const profile = getProfile();
  if (!profile) return '';
  const SCORE_MATRIX = { A: { green: 1, amber: 0.5, red: 0 }, B: { green: 1, amber: 1, red: 0 }, C: { green: 1, amber: 1, red: 1 } };
  const SCORE_MATRIX_Q9 = { A: { green: 1, amber: 0.5, red: 0 }, B: { green: 1, amber: 1, red: 1 }, C: { green: 0, amber: 0.5, red: 1 } };
  let strong = 0, partial = 0, low = 0;

  const rows = FIT_QUESTIONS.map(q => {
    const ind = coin.indicators[q.key];
    const answer = profile[q.key];
    if (!ind || !answer) return '';
    const matrix = q.inverted ? SCORE_MATRIX_Q9 : SCORE_MATRIX;
    const s = matrix[answer]?.[ind.color] ?? 0;
    const fitDot = s === 1 ? '\u{1F7E2}' : s === 0.5 ? '\u{1F7E1}' : '\u{1F534}';
    const fitLabel = s === 1 ? 'Strong' : s === 0.5 ? 'Partial' : 'Low';
    const fitColor = s === 1 ? 'var(--green)' : s === 0.5 ? 'var(--amber)' : 'var(--red)';
    if (s === 1) strong++; else if (s === 0.5) partial++; else low++;
    const prefMap = { A: q.a.split(' ').slice(0, 3).join(' '), B: q.b.split(' ').slice(0, 3).join(' '), C: q.c.split(' ').slice(0, 3).join(' ') };
    const meta = IND_META[q.key] || {};
    return `<tr>
      <td style="font-weight:500;color:var(--text)">${meta.label || q.key}</td>
      <td style="color:var(--muted);font-weight:300">${meta.desc ? meta.desc.split('.')[0] : ''}</td>
      <td style="font-family:var(--font-mono);font-size:0.78rem">${ind.label}</td>
      <td style="font-size:0.72rem;color:var(--muted)">${prefMap[answer]}</td>
      <td class="fit-bd-th-fit" style="color:${fitColor};font-weight:600"><span style="font-size:0.7rem">${fitDot}</span> ${fitLabel}</td>
    </tr>`;
  }).join('');

  // Store totals for the tfoot (set via JS after render)
  setTimeout(() => {
    const totalEl = document.getElementById('fitBdTotal');
    if (totalEl) totalEl.innerHTML = `<span style="color:var(--green)">Strong (${strong})</span> \u00b7 <span style="color:var(--amber)">Partial (${partial})</span> \u00b7 <span style="color:var(--red)">Low (${low})</span>`;
  }, 0);

  return rows;
}

function buildGloRiskCard(coin) {
  const mood = coin.mood;
  const band = getMoodBand(mood.label);
  const ps   = gloriskScore(mood);

  // Check for personalised fit score
  const profile = getProfile();
  const fitScore = profile ? computeFitScore(coin.indicators, profile) : null;
  const fitLabel = fitScore !== null ? getFitLabel(fitScore) : '';
  const fitColor = fitScore !== null ? getFitColor(fitScore) : '';

  // If user has a profile, show fit score as headline; otherwise show Performance
  if (fitScore !== null) {
    return `
      <div class="glorisk-card" id="gloriskCard">
        <div class="gc-header">
          <div class="sd-label">YOUR GLORISK FIT</div>
          <span class="rsb" id="gloriskBadge" style="font-size:0.72rem;padding:3px 12px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);color:${fitColor}">${fitLabel}</span>
        </div>
        <div class="sd-score-row">
          <span class="sd-score glorisk-headline" style="color:${fitColor}">${fitScore}</span>
          <span class="sd-max">/ 100</span>
        </div>
        <div class="gc-breakdown" id="gloriskBreakdown">
          <div class="gc-row">
            <span class="gc-row-label">Market Performance:</span>
            <span class="gc-row-value" id="gloriskPerfValue">${ps}</span>
            <span class="rsb ${moodRsbClass(mood.label)}" style="font-size:0.58rem;padding:2px 8px">${band.displayLabel ?? mood.label}</span>
          </div>
          <div class="gc-row" id="gloriskPosRow" style="display:none">
            <span class="gc-row-label">Market Position:</span>
            <span class="gc-row-value" id="gloriskSwotValue"></span>
            <span class="rsb" id="gloriskSwotBadge" style="font-size:0.58rem;padding:2px 8px"></span>
          </div>
        </div>
        <div style="margin-top:0.5rem;display:flex;gap:8px;align-items:center">
          <button class="cta-link" id="fitBdToggle" style="background:none;cursor:pointer">View Scoring</button>
          <a href="/screener.html" class="cta-link">Edit Profile \u2192</a>
        </div>
      </div>
    `;
  // Append modal to body after render (deferred)
  setTimeout(() => {
    let modal = document.getElementById('fitModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'fitModal';
      modal.className = 'fit-modal-overlay';
      modal.style.display = 'none';
      modal.innerHTML = `
        <div class="fit-modal">
          <div class="fit-bd-header">
            <div class="fit-bd-title">Fit Scoring Breakdown</div>
            <button class="fit-bd-close" id="fitBdClose">\u00d7</button>
          </div>
          <div class="fit-modal-body">
            <table class="fit-bd-table">
              <thead>
                <tr>
                  <th>Indicator</th>
                  <th>Description</th>
                  <th>Value</th>
                  <th>Preference</th>
                  <th class="fit-bd-th-fit">Fit</th>
                </tr>
              </thead>
              <tbody>${buildFitRows(coin)}</tbody>
              <tfoot>
                <tr>
                  <td colspan="4" style="text-align:right;font-family:var(--font-mono);font-size:0.68rem;color:var(--muted)">Total:</td>
                  <td id="fitBdTotal" class="fit-bd-th-fit"></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <a href="/browse.html?asset=${encodeURIComponent(coin.ticker)}" class="fit-bd-view">View Full Asset \u2192</a>
        </div>`;
      document.body.appendChild(modal);
    }
  }, 0);
  return html;
  }

  // No profile — show Performance Score with CTA
  return `
    <div class="glorisk-card" id="gloriskCard">
      <div class="gc-header">
        <div class="sd-label" id="gloriskLabel">PERFORMANCE SCORE</div>
        <span class="rsb ${moodRsbClass(mood.label)}" id="gloriskBadge" style="font-size:0.72rem;padding:3px 12px">${band.displayLabel ?? mood.label}</span>
      </div>
      <div class="sd-score-row">
        <span class="sd-score glorisk-headline" id="gloriskValue" style="color:${band.color}">${ps}</span>
        <span class="sd-max">/ 100</span>
      </div>
      <div class="gc-breakdown" id="gloriskBreakdown" style="display:none">
        <div class="gc-row">
          <span class="gc-row-label">Performance:</span>
          <span class="gc-row-value" id="gloriskPerfValue">${ps}</span>
          <span class="rsb ${moodRsbClass(mood.label)}" id="gloriskPerfBadge" style="font-size:0.58rem;padding:2px 8px">${band.displayLabel ?? mood.label}</span>
        </div>
        <div class="gc-row">
          <span class="gc-row-label">Position:</span>
          <span class="gc-row-value" id="gloriskSwotValue"></span>
          <span class="rsb" id="gloriskSwotBadge" style="font-size:0.58rem;padding:2px 8px"></span>
        </div>
      </div>
      <div style="margin-top:0.75rem"><a href="/screener.html" class="cta-link">Get your personalised GloRisk Score \u2192</a></div>
    </div>
  `;
}

/* ── Performance Score card (inside Performance Summary) ──────────── */

function buildBlocksHTML(colors) {
  const sorted = [...colors].sort((a, b) => {
    const order = { green: 0, amber: 1, red: 2 };
    return (order[a] ?? 1) - (order[b] ?? 1);
  });
  return `<div class="ind-blocks">${sorted.map(c => `<div class="ind-block" style="background:var(--${c})"></div>`).join('')}</div>`;
}

function buildIssueCountsHTML(amberCount, redCount) {
  if (!amberCount && !redCount) return '';
  const parts = [];
  if (amberCount) parts.push(`<span style="color:var(--amber)">${amberCount} warning</span>`);
  if (redCount) parts.push(`<span style="color:var(--red)">${redCount} critical</span>`);
  return `<div class="gc-issues">${parts.join(' \u00b7 ')}</div>`;
}

function buildPerfCard(coin) {
  const mood = coin.mood;
  const band = getMoodBand(mood.label);
  const ps   = gloriskScore(mood);
  const a = IND_ORDER.filter(k => coin.indicators[k]?.color === 'amber').length;
  const r = IND_ORDER.filter(k => coin.indicators[k]?.color === 'red').length;

  return `
    <div class="glorisk-card" style="margin-bottom:0;border-bottom-left-radius:0;border-bottom-right-radius:0">
      <div class="gc-header">
        <div class="sd-label">PERFORMANCE SCORE</div>
        <span class="rsb ${moodRsbClass(mood.label)}" style="font-size:0.72rem;padding:3px 12px">${band.displayLabel ?? mood.label}</span>
      </div>
      <div class="sd-score-row">
        <span class="sd-score glorisk-headline" style="color:${band.color}">${ps}</span>
        <span class="sd-max">/ 100</span>
      </div>
      ${buildIssueCountsHTML(a, r)}
    </div>
  `;
}

/* ── Asset detail (navy redesign) helpers ───────────────────────────── */

function adAssetType(coin) {
  const g = coin.group;
  if (g === 'Crypto') return 'Crypto';
  if (g === 'SectorETFs') return 'ETF';
  if (g === 'Index') return 'Index';
  if (g === 'SP500') return 'Stock \u00b7 S&P 500';
  if (g === 'NASDAQ100') return 'Stock \u00b7 NASDAQ 100';
  if (g === 'FTSE100') return 'Stock \u00b7 FTSE 100';
  if (g === 'Nikkei225') return 'Stock \u00b7 Nikkei 225';
  if (g === 'HSI') return 'Stock \u00b7 Hang Seng';
  return 'Stock';
}

function adIsStock(coin) {
  return ['SP500','NASDAQ100','FTSE100','Nikkei225','HSI'].includes(coin.group);
}

// Fit score → badge info
function adFitBadge(score) {
  if (score == null) return { cls: 'dim',        color: 'var(--ad-text-dim)',    label: '—' };
  if (score >= 85)   return { cls: 'teal',       color: 'var(--ad-teal)',        label: 'Very Strong' };
  if (score >= 65)   return { cls: 'teal-muted', color: 'var(--ad-teal-muted)',  label: 'Strong' };
  if (score >= 40)   return { cls: 'amber',      color: 'var(--ad-amber)',       label: 'Borderline' };
  if (score >= 20)   return { cls: 'red-muted',  color: 'var(--ad-red-muted)',   label: 'Poor' };
  return                    { cls: 'red',        color: 'var(--ad-red)',         label: 'Very Poor' };
}

// Performance (mood) score → badge info
function adPerfBadge(score) {
  if (score >= 90) return { cls: 'teal',       color: 'var(--ad-teal)',       label: 'Very Stable' };
  if (score >= 80) return { cls: 'teal-muted', color: 'var(--ad-teal-muted)', label: 'Stable' };
  if (score >= 60) return { cls: 'amber',      color: 'var(--ad-amber)',      label: 'Unstable' };
  if (score >= 40) return { cls: 'red-muted',  color: 'var(--ad-red-muted)',  label: 'Stressed' };
  return                  { cls: 'red',        color: 'var(--ad-red)',        label: 'Critical' };
}

function adIndColor(c) {
  if (c === 'green') return 'var(--ad-teal)';
  if (c === 'amber') return 'var(--ad-amber)';
  if (c === 'red')   return 'var(--ad-red-muted)';
  return 'var(--ad-text-dim)';
}

// Watchlist helpers + toast are imported from ./lists.js (see top of file)

// Topbar with logo + watch/compare icons + back button (icons grouped right)
function buildAdTopbar(coin) {
  const ticker = coin?.ticker || '';
  const watched = ticker ? isWatched(ticker) : false;
  const ICON_BOOKMARK = '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
  const ICON_COMPARE  = '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/></svg>';
  return `
    <div class="ad-topbar">
      <a href="/" class="ad-logo">Glo<span>Risk</span></a>
      <div class="ad-topbar-right">
        <button class="ad-icon-btn ${watched ? 'is-active' : ''}" id="adWatchBtn" title="${watched ? 'Remove from watchlist' : 'Add to watchlist'}">${ICON_BOOKMARK}</button>
        <a class="ad-icon-btn" href="/compare.html?a=${encodeURIComponent(ticker)}" title="Compare with another asset">${ICON_COMPARE}</a>
        <a href="/screener.html" class="ad-back-btn">\u2190 Back to rankings</a>
      </div>
    </div>
  `;
}

// Asset header (ticker, name, type, price, change, date)
function buildAdHeader(coin) {
  const change = coin.priceChange || 0;
  const changeCls = change >= 0 ? 'pos' : 'neg';
  const asOf = coin.lastDate
    ? new Date(coin.lastDate).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
    : '';
  return `
    <div class="ad-header">
      <div class="ad-top">
        <div>
          <div class="ad-ticker">${coin.ticker}</div>
          <div class="ad-name">${coin.company}</div>
          <div class="ad-type">${adAssetType(coin)}</div>
        </div>
        <div style="text-align:right">
          <div class="ad-price">${formatPrice(coin.price, coin.group)}</div>
          <div class="ad-change ${changeCls}">${change >= 0 ? '+' : ''}${change.toFixed(2)}% \u00b7 30D</div>
          <div class="ad-date">As of ${asOf}</div>
        </div>
      </div>
    </div>
  `;
}

// One-line description for an indicator when scored against a user preference
function adIndicatorExplain(key, v, ticker) {
  const defs = {
    volatility: () => v.raw < 30
      ? `Low annualised volatility (${v.label}) \u2014 calm, predictable day-to-day price movement.`
      : v.raw < 60
      ? `Moderate annualised volatility (${v.label}) \u2014 the price can move meaningfully from day to day.`
      : `High annualised volatility (${v.label}) \u2014 the price swings significantly from day to day.`,
    volSpike: () => v.raw < 1.0
      ? `Recent volatility lower than historical average (${v.label}) \u2014 price behaviour calmer than usual.`
      : v.raw < 2.0
      ? `Recent volatility slightly above average (${v.label}) \u2014 something may be shifting.`
      : `Recent volatility well above average (${v.label}) \u2014 heightened uncertainty.`,
    vsPeak: () => v.raw < 20
      ? `Only ${v.label} below the 3-year high \u2014 holding up close to peak value.`
      : v.raw < 30
      ? `A noticeable ${v.label} pullback from the 3-year high.`
      : `A deep ${v.label} drawdown from the 3-year high \u2014 significant peak loss.`,
    shortTrend: () => v.raw > 0
      ? `Trading ${v.label} above the 50-day average \u2014 short-term trend upward.`
      : v.raw > -6
      ? `Trading ${v.label} below the 50-day average \u2014 early signs of weakness.`
      : `Trading ${v.label} below the 50-day average \u2014 clear short-term downtrend.`,
    longTrend: () => v.raw > 0
      ? `Price ${v.label} above the 200-day average \u2014 the long-term uptrend is intact.`
      : v.raw > -10
      ? `Price ${v.label} below the 200-day average \u2014 long-term trend weakening.`
      : `Price ${v.label} below the 200-day average \u2014 extended long-term downtrend.`,
    maCross: () => v.color === 'green'
      ? `Golden Cross \u2014 50-day average above 200-day. Bullish trend direction.`
      : `Death Cross \u2014 50-day average below 200-day. Bearish trend direction.`,
    return1M: () => v.raw >= 0
      ? `Up ${v.label} over the past 30 days \u2014 short-term direction positive.`
      : v.raw > -10
      ? `Down ${v.label} over the past 30 days \u2014 modest short-term decline.`
      : `Down ${v.label} over the past 30 days \u2014 sharp selling pressure.`,
    return1Y: () => v.raw > 0
      ? `Up ${v.label} over the past 12 months \u2014 gained value over the longer term.`
      : v.raw > -20
      ? `Down ${v.label} over the past 12 months \u2014 moderate annual decline.`
      : `Down ${v.label} over the past 12 months \u2014 sustained period of weakness.`,
    range52W: () => v.raw > 45
      ? `In the upper half of its 52-week range (${v.label}) \u2014 closer to yearly high.`
      : v.raw > 25
      ? `Mid-range within its 52-week band (${v.label}) \u2014 neither near top nor bottom.`
      : `Near the bottom of its 52-week range (${v.label}) \u2014 most yearly gains given back.`,
    cagr3Y: () => v.raw > 0
      ? `${v.label} annualised compound growth over 3 years \u2014 building long-term value.`
      : `${v.label} annualised over 3 years \u2014 destroyed long-term value.`,
  };
  return defs[key] ? defs[key]() : '';
}

// Build the 3 indicator groups (Going well / Concerning / Critical) for Performance body
function buildAdIndGroups(coin) {
  const ind = coin.indicators;
  const ticker = coin.ticker;
  const allCards = [];
  for (const key of IND_ORDER) {
    if (key === 'momentum') continue; // skip legacy indicator
    const v = ind[key];
    if (!v) continue;
    const meta = IND_META[key] || {};
    allCards.push({
      color: v.color, key,
      title: meta.label || key,
      label: v.label,
      text: adIndicatorExplain(key, v, ticker),
    });
  }
  const groups = [
    { label: 'Going well', color: 'green', dot: 'var(--ad-teal)',       cards: allCards.filter(c => c.color === 'green') },
    { label: 'Concerning', color: 'amber', dot: 'var(--ad-amber)',      cards: allCards.filter(c => c.color === 'amber') },
    { label: 'Critical',   color: 'red',   dot: 'var(--ad-red-muted)',  cards: allCards.filter(c => c.color === 'red') },
  ];
  let html = '';
  for (const g of groups) {
    html += `<div class="ad-ind-group">
      <div class="ad-ind-group-label" style="color:${g.dot}"><div class="ad-ind-dot-lg" style="background:${g.dot}"></div>${g.label} (${g.cards.length})</div>
      <div class="ad-ind-table">`;
    if (g.cards.length === 0) {
      html += `<div class="ad-ind-row"><div class="ad-ind-empty">No ${g.label.toLowerCase()} indicators.</div></div>`;
    } else {
      html += `<div class="ad-ind-head"><div class="ad-ind-th">Indicator</div><div class="ad-ind-th">Data</div><div class="ad-ind-th">Explanation</div></div>`;
      for (const c of g.cards) {
        html += `<div class="ad-ind-row">
          <div class="ad-ind-name"><div class="ad-ind-dot" style="background:${g.dot}"></div>${c.title}</div>
          <div class="ad-ind-data" style="color:${g.dot}">${c.label}</div>
          <div class="ad-ind-exp">${c.text}</div>
        </div>`;
      }
    }
    html += `</div></div>`;
  }
  return html;
}

// Personal Fit Score section
function buildAdFitSection(coin) {
  const profile = getProfile();
  if (!profile) {
    return `
      <div class="ad-sec-label">Your personal fit</div>
      <div class="ad-rows-wrap">
        <div class="ad-row">
          <div class="ad-row-head" data-row="fit" style="cursor:default">
            <div class="ad-chev" style="opacity:0.3">\u25B6</div>
            <div>
              <div class="ad-rh-name">Personal Fit Score</div>
              <div class="ad-rh-sub">Set your profile to unlock personalised fit</div>
            </div>
            <div>
              <div class="ad-rh-num" style="color:var(--ad-text-dim)">\u2014</div>
              <div class="ad-rh-numsub">/ 100</div>
            </div>
            <div><span class="ad-badge dim">Not set</span></div>
            <div class="ad-rh-desc"><a href="/screener.html" style="color:var(--ad-indigo-mid);text-decoration:underline">Take the 2-minute questionnaire</a> to see how this asset fits your risk profile.</div>
            <div></div>
          </div>
        </div>
      </div>
    `;
  }

  const fitScore = computeFitScore(coin.indicators, profile);
  if (fitScore == null) {
    return `<div class="ad-sec-label">Your personal fit</div>
      <div class="ad-rows-wrap"><div class="ad-row"><div class="ad-row-head"><div></div><div><div class="ad-rh-name">Personal Fit Score</div><div class="ad-rh-sub">Insufficient data</div></div><div></div><div></div><div></div><div></div></div></div></div>`;
  }

  const fitBadge = adFitBadge(fitScore);
  const summary = getProfileSummary(profile);
  const riskLevelParts = [summary?.riskLevel, summary?.horizon, summary?.philosophy].filter(Boolean);
  const riskLevelText = riskLevelParts.length
    ? `Based on your ${riskLevelParts.join(' \u00b7 ')} profile`
    : 'Based on your risk profile';

  const SCORE_MATRIX    = { A: { green: 1, amber: 0.5, red: 0 }, B: { green: 1, amber: 1, red: 0 }, C: { green: 1, amber: 1, red: 1 } };
  const SCORE_MATRIX_Q9 = { A: { green: 1, amber: 0.5, red: 0 }, B: { green: 1, amber: 1, red: 1 }, C: { green: 0, amber: 0.5, red: 1 } };

  let strong = 0, partial = 0, low = 0;
  const sensitiveChanges = [];

  // Iterate over the 10 risk questions — each question maps 1:1 to one indicator
  const rowsHTML = FIT_QUESTIONS.map(q => {
    const ind = coin.indicators[q.key];
    const answer = profile[q.key];
    if (!ind || !answer) return '';
    const matrix = q.inverted ? SCORE_MATRIX_Q9 : SCORE_MATRIX;
    const s = matrix[answer]?.[ind.color] ?? 0;
    const fitLabel = s === 1 ? 'Strong' : s === 0.5 ? 'Partial' : 'Low';
    const fitColor = s === 1 ? 'var(--ad-teal)' : s === 0.5 ? 'var(--ad-amber)' : 'var(--ad-red-muted)';
    if (s === 1) strong++;
    else if (s === 0.5) partial++;
    else low++;

    const prefText = q[answer.toLowerCase()] || '';
    const meta = IND_META[q.key] || {};
    const desc = (meta.desc ? meta.desc.split('.')[0] : '').trim();

    // Flag currently Strong green indicators that would drop if the color slipped to amber
    if (s === 1 && ind.color === 'green' && matrix[answer]?.amber != null && matrix[answer].amber < 1) {
      sensitiveChanges.push({
        label: meta.label || q.key,
        current: ind.label,
        wouldBecome: matrix[answer].amber === 0.5 ? 'Partial' : 'Low',
      });
    }

    return `
      <div class="ad-bt-row">
        <div class="ad-bt-indicator"><div class="ad-bt-dot" style="background:${fitColor}"></div>${meta.label || q.key}</div>
        <div class="ad-bt-desc">${desc}</div>
        <div class="ad-bt-value" style="color:${fitColor}">${ind.label}</div>
        <div class="ad-bt-pref">${prefText}</div>
        <div class="ad-bt-fit" style="color:${fitColor}">${fitLabel}</div>
      </div>
    `;
  }).join('');

  // Fit dots row — highlight current band
  const fitClass = getFitClass(fitScore);
  const dots = [
    { c: 'var(--ad-red)',        label: 'Very Poor',  key: 'vp' },
    { c: 'var(--ad-red-muted)',  label: 'Poor',       key: 'p'  },
    { c: 'var(--ad-amber)',      label: 'Borderline', key: 'b'  },
    { c: 'var(--ad-teal-muted)', label: 'Strong',     key: 's'  },
    { c: 'var(--ad-teal)',       label: 'Very Strong',key: 'vs' },
  ];
  const dotsHTML = dots.map(d =>
    `<div class="ad-fit-dot-lg" style="background:${d.c};${d.key === fitClass ? 'border:2px solid rgba(255,255,255,0.3)' : 'opacity:0.4'}"></div>`
  ).join('');
  const labelsHTML = dots.map(d => {
    const isCurrent = d.key === fitClass;
    return `<span class="ad-fit-dot-label${isCurrent ? ' current' : ''}" style="${isCurrent ? `color:${d.c};font-weight:700` : ''}">${d.label}${isCurrent ? ' \u2190' : ''}</span>`;
  }).join('');

  // What could change this fit
  let changesHTML;
  if (sensitiveChanges.length === 0) {
    changesHTML = `<div class="ad-no-changes">This asset scores <strong style="color:var(--ad-warm-white)">${fitBadge.label}</strong> against your preferences. No near-term deterioration would reduce its fit \u2014 unless your own risk preferences change. You can update your profile at any time.</div>`;
  } else {
    changesHTML = `<div class="ad-changes-list">` + sensitiveChanges.slice(0, 3).map(c =>
      `<div class="ad-change-card">
        <div class="ad-change-icon" style="background:var(--ad-amber-bg);color:var(--ad-amber)">!</div>
        <div>
          <div class="ad-change-title">If ${c.label} weakens</div>
          <div class="ad-change-desc">Currently <strong style="color:var(--ad-warm-white)">${c.current}</strong> and scoring a Strong match. If it deteriorates, the fit on this indicator would drop to <strong style="color:var(--ad-amber)">${c.wouldBecome}</strong>.</div>
        </div>
      </div>`
    ).join('') + `</div>`;
  }

  const matchCount = strong + partial + low;
  const align = fitBadge.label === 'Very Strong' ? 'This asset aligns closely with your profile.'
             : fitBadge.label === 'Strong'       ? 'This asset aligns well with your profile.'
             : fitBadge.label === 'Borderline'   ? 'This asset partially matches your profile.'
             : fitBadge.label === 'Poor'         ? 'This asset mostly sits outside your preferred range.'
             : 'This asset is outside your preferred risk range.';

  return `
    <div class="ad-sec-label">Your personal fit</div>
    <div class="ad-rows-wrap">
      <div class="ad-row">
        <div class="ad-row-head" data-row="fit">
          <div class="ad-chev">\u25B6</div>
          <div>
            <div class="ad-rh-name">Personal Fit Score</div>
            <div class="ad-rh-sub">${riskLevelText}</div>
          </div>
          <div>
            <div class="ad-rh-num" style="color:${fitBadge.color}">${fitScore}</div>
            <div class="ad-rh-numsub">/ 100</div>
          </div>
          <div><span class="ad-badge ${fitBadge.cls}">${fitBadge.label}</span></div>
          <div class="ad-rh-desc">${strong} of ${matchCount} indicators match your risk preferences. ${align}</div>
          <div></div>
        </div>
        <div class="ad-row-body" data-row-body="fit">
          <div class="ad-body-label">Fit level</div>
          <div class="ad-fit-dots-row">${dotsHTML}</div>
          <div class="ad-fit-dot-labels">${labelsHTML}</div>
          <div class="ad-fit-sum-grid">
            <div class="ad-fit-sum-card"><div class="ad-fit-sum-num" style="color:var(--ad-teal)">${strong}</div><div class="ad-fit-sum-label">Strong matches</div></div>
            <div class="ad-fit-sum-card"><div class="ad-fit-sum-num" style="color:var(--ad-amber)">${partial}</div><div class="ad-fit-sum-label">Partial matches</div></div>
            <div class="ad-fit-sum-card"><div class="ad-fit-sum-num" style="color:var(--ad-red-muted)">${low}</div><div class="ad-fit-sum-label">Low matches</div></div>
          </div>
          <div class="ad-body-label">Breakdown \u2014 how it scored against your preferences</div>
          <div class="ad-bt-table">
            <div class="ad-bt-head">
              <div class="ad-bt-th">Indicator</div>
              <div class="ad-bt-th">Description</div>
              <div class="ad-bt-th">Value</div>
              <div class="ad-bt-th">Your preference</div>
              <div class="ad-bt-th">Fit</div>
            </div>
            ${rowsHTML}
            <div class="ad-bt-total">
              Total: <span style="color:var(--ad-teal)">Strong (${strong})</span> \u00b7 <span style="color:var(--ad-amber)">Partial (${partial})</span> \u00b7 <span style="color:var(--ad-red-muted)">Low (${low})</span>
            </div>
          </div>
          <div class="ad-body-label">What could change this fit</div>
          ${changesHTML}
        </div>
      </div>
    </div>
  `;
}

// Performance score row
function buildAdPerformanceRow(coin) {
  const ps = gloriskScore(coin.mood);
  const badge = adPerfBadge(ps);
  const g = IND_ORDER.filter(k => coin.indicators[k]?.color === 'green').length;
  const a = IND_ORDER.filter(k => coin.indicators[k]?.color === 'amber').length;
  const r = IND_ORDER.filter(k => coin.indicators[k]?.color === 'red').length;
  const summary = r === 0 && a === 0
    ? 'All 10 indicators green \u2014 clean, consistent price action.'
    : r >= 2
    ? `${r} critical indicator${r > 1 ? 's' : ''} flagging material weakness.`
    : a >= 3
    ? `${a} indicators concerning \u2014 mixed signals worth monitoring.`
    : 'Generally stable with only minor concerns.';
  return `
    <div class="ad-row">
      <div class="ad-row-head" data-row="perf">
        <div class="ad-chev">\u25B6</div>
        <div>
          <div class="ad-rh-name">Performance Score</div>
          <div class="ad-rh-sub">Price action, volatility, trend</div>
        </div>
        <div>
          <div class="ad-rh-num" style="color:${badge.color}">${ps}</div>
          <div class="ad-rh-numsub">/ 100</div>
        </div>
        <div><span class="ad-badge ${badge.cls}">${badge.label}</span></div>
        <div class="ad-rh-desc">${summary}</div>
        <div></div>
      </div>
      <div class="ad-row-body" data-row-body="perf">
        <div class="ad-body-label">Indicators</div>
        ${buildAdIndGroups(coin)}
        <div class="ad-body-label">Risk & Opportunity</div>
        <div class="ad-ro-grid" id="adRoGrid"><div class="ad-loading" style="grid-column:1/-1">Loading analysis\u2026</div></div>
        <div class="ad-body-label">Verdict</div>
        <div class="ad-verdict-box"><div class="ad-verdict-text" id="adVerdict"><span class="ad-loading">Loading analysis\u2026</span></div></div>
      </div>
    </div>
  `;
}

// Locked row for ETFs/Crypto/Indices (Position Score + Market Position)
function buildAdLockedRow(id, name, sub, description, badge, lockTitle, lockDesc) {
  return `
    <div class="ad-row">
      <div class="ad-row-head locked" data-row-locked="${id}">
        <div class="ad-chev">\u25B6</div>
        <div>
          <div class="ad-rh-name" style="color:var(--ad-text-muted)">${name}</div>
          <div class="ad-rh-sub">${sub}</div>
        </div>
        <div>
          <div class="ad-rh-num" style="color:var(--ad-text-dim)">\u2014</div>
          <div class="ad-rh-numsub">Not available</div>
        </div>
        <div><span class="ad-badge dim">${badge}</span></div>
        <div class="ad-rh-desc" style="color:var(--ad-text-dim)">${description}</div>
        <div></div>
      </div>
      <div class="ad-locked-body" data-row-body="${id}">
        <div class="ad-lock-i">i</div>
        <div>
          <div class="ad-lock-title">${lockTitle}</div>
          <div class="ad-lock-desc">${lockDesc}</div>
        </div>
      </div>
    </div>
  `;
}

function buildAdPositionRow(coin, isStock) {
  if (!isStock) {
    return buildAdLockedRow(
      'pos',
      'Position Score',
      'Fundamentals, governance, market position',
      'Requires individual company fundamentals.',
      'Stocks only',
      'Position Score not available for ETFs / Crypto',
      'Requires company-level data \u2014 <span>financials, earnings quality, governance, moat, and competitive positioning.</span> Available for <span>individual stocks only.</span>'
    );
  }
  // Placeholder — populated by loadDeepAnalysis
  return `
    <div class="ad-row">
      <div class="ad-row-head" data-row="pos" id="adPosHead">
        <div class="ad-chev">\u25B6</div>
        <div>
          <div class="ad-rh-name">Position Score</div>
          <div class="ad-rh-sub">Fundamentals, governance, market position</div>
        </div>
        <div>
          <div class="ad-rh-num" id="adPosNum" style="color:var(--ad-text-dim)">\u2014</div>
          <div class="ad-rh-numsub">/ 100</div>
        </div>
        <div id="adPosBadge"><span class="ad-badge dim">Loading</span></div>
        <div class="ad-rh-desc" id="adPosDesc">Loading analysis\u2026</div>
        <div></div>
      </div>
      <div class="ad-row-body" data-row-body="pos" id="adPosBody">
        <div class="ad-loading">Loading position analysis\u2026</div>
      </div>
    </div>
  `;
}

function buildAdMarketPosRow(coin, isStock) {
  if (!isStock) {
    return buildAdLockedRow(
      'mkt',
      'Market Position',
      'Momentum / Fragile / Resilient / Trouble',
      'Quadrant analysis requires internal and external company ratings.',
      'Stocks only',
      'Market Position not available for ETFs / Crypto',
      'The <span>Momentum / Fragile / Resilient / Trouble</span> quadrant plots internal business quality against external market conditions. Available for <span>individual stocks only.</span>'
    );
  }
  return `
    <div class="ad-row">
      <div class="ad-row-head" data-row="mkt" id="adMktHead">
        <div class="ad-chev">\u25B6</div>
        <div>
          <div class="ad-rh-name">Market Position</div>
          <div class="ad-rh-sub">Momentum / Fragile / Resilient / Trouble</div>
        </div>
        <div>
          <div class="ad-rh-num" id="adMktNum" style="color:var(--ad-text-dim)">\u2014</div>
          <div class="ad-rh-numsub">Quadrant</div>
        </div>
        <div id="adMktBadge"><span class="ad-badge dim">Loading</span></div>
        <div class="ad-rh-desc" id="adMktDesc">Loading quadrant\u2026</div>
        <div></div>
      </div>
      <div class="ad-row-body" data-row-body="mkt" id="adMktBody">
        <div class="ad-loading">Loading market position\u2026</div>
      </div>
    </div>
  `;
}

function buildAdOverallRow(coin, isStock) {
  const ps = gloriskScore(coin.mood);
  const badge = adPerfBadge(ps);
  // For non-stocks, Overall = Performance (since Position isn't available)
  // For stocks, Overall gets updated by loadDeepAnalysis once position score is known
  const desc = isStock
    ? 'Weighted: 60% Performance + 40% Position.'
    : 'Based on Performance Score \u2014 Position Score not applicable for this asset class.';
  return `
    <div class="ad-row">
      <div class="ad-row-head" data-row="overall">
        <div class="ad-chev">\u25B6</div>
        <div>
          <div class="ad-rh-name">Overall Score</div>
          <div class="ad-rh-sub">Combined risk-adjusted rating</div>
        </div>
        <div>
          <div class="ad-rh-num" id="adOverallNum" style="color:${badge.color}">${ps}</div>
          <div class="ad-rh-numsub">/ 100</div>
        </div>
        <div id="adOverallBadge"><span class="ad-badge ${badge.cls}">${badge.label}</span></div>
        <div class="ad-rh-desc" id="adOverallDesc">${desc}</div>
        <div></div>
      </div>
      <div class="ad-row-body" data-row-body="overall">
        <div class="ad-body-label">How this score is calculated</div>
        <div class="ad-calc-box">
          <div class="ad-calc-text">
            For <strong>ETFs, Crypto and Indices</strong>, the Overall Score equals the <strong>Performance Score</strong> since Position Score is not applicable.
            For <strong>individual stocks</strong>, the Overall Score is weighted: <strong>60% Performance + 40% Position.</strong>
            This reflects that price behaviour is the primary driver of personal fit, with fundamentals providing a secondary quality layer.
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildAdScoresSection(coin) {
  const isStock = adIsStock(coin);
  return `
    <div class="ad-sec-label">Scores</div>
    <div class="ad-rows-wrap">
      ${buildAdPerformanceRow(coin)}
      ${buildAdPositionRow(coin, isStock)}
      ${buildAdMarketPosRow(coin, isStock)}
      ${buildAdOverallRow(coin, isStock)}
    </div>
  `;
}

// Wire up click-to-toggle for every row
function wireAdToggles(root) {
  root.querySelectorAll('.ad-row-head').forEach(head => {
    const key = head.dataset.row || head.dataset.rowLocked;
    if (!key) return;
    const isLocked = head.classList.contains('locked');
    head.addEventListener('click', () => {
      if (isLocked) {
        const body = root.querySelector(`[data-row-body="${key}"]`);
        const chev = head.querySelector('.ad-chev');
        if (!body) return;
        const isOpen = body.classList.contains('open');
        body.classList.toggle('open', !isOpen);
        chev?.classList.toggle('open', !isOpen);
        return;
      }
      const body = root.querySelector(`[data-row-body="${key}"]`);
      const chev = head.querySelector('.ad-chev');
      if (!body) return;
      const isOpen = body.classList.contains('open');
      body.classList.toggle('open', !isOpen);
      chev?.classList.toggle('open', !isOpen);
    });
  });
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
  const change     = coin.priceChange || 0;
  const ps = gloriskScore(mood);
  const displayLabel = band.displayLabel ?? mood.label;
  const shareText = `${coin.ticker} (${coin.company}) is rated ${displayLabel} with a GloRisk Score of ${ps} on GloRisk.`;
  const shareUrl = window.location.origin + '/browse.html?asset=' + encodeURIComponent(coin.ticker);

  body.innerHTML = `
    ${buildAdTopbar(coin)}
    ${buildAdHeader(coin)}
    ${buildAdFitSection(coin)}
    ${buildAdScoresSection(coin)}
  `;

  wireAdToggles(body);

  // Wire watch button — toggles localStorage, flips icon state, shows toast prompt
  const watchBtn = body.querySelector('#adWatchBtn');
  if (watchBtn) {
    watchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (isWatched(coin.ticker)) {
        removeFromWatchlist(coin.ticker);
        watchBtn.classList.remove('is-active');
        watchBtn.title = 'Add to watchlist';
        showToast(`<strong>${coin.ticker}</strong> removed from watchlist`, { duration: 2000 });
      } else {
        addToWatchlistWithPrompt(coin.ticker);
        watchBtn.classList.add('is-active');
        watchBtn.title = 'Remove from watchlist';
      }
    });
  }

  // Auto-open the Personal Fit row so users see the breakdown immediately
  const fitBody = body.querySelector('[data-row-body="fit"]');
  const fitChev = body.querySelector('[data-row="fit"] .ad-chev');
  if (fitBody && getProfile()) {
    fitBody.classList.add('open');
    fitChev?.classList.add('open');
  }

  // Load AI report → populates Performance (Tailwinds/Risks/Verdict) and, for stocks, Position + Market Position
  loadDeepAnalysis(coin);

  // Update tool bar links with current ticker (hidden elements kept for backwards compat)
  const rtbCompare = document.getElementById('rtbCompare');
  if (rtbCompare) rtbCompare.href = `/compare.html?a=${encodeURIComponent(coin.ticker)}`;
  const rtbStress = document.getElementById('rtbStress');
  if (rtbStress) rtbStress.href = '/stress-test.html';

  // Unused legacy variable reference to keep shareText/shareUrl live
  void shareText; void shareUrl;
}

// Legacy renderReport body continued as dead code below (never executed):
function __legacyRenderReport_unused() {
  const coin = null;
  const body = document.getElementById('reportBody');
  const mood       = { label: '', score: 0 };
  const band       = getMoodBand(mood.label);
  const rsbCls     = moodRsbClass(mood.label);
  const change     = 0;
  const changeCls  = change >= 0 ? 'pos' : 'neg';

  const indDefsHTML = IND_ORDER.map(key => {
    const meta = IND_META[key];
    return `
      <div class="ind-def-row">
        <div class="ind-def-name">${meta.label}</div>
        <div class="ind-def-desc">${meta.desc}</div>
      </div>
    `;
  }).join('');

  const asOfDateStr = '';

  const displayLabel = band.displayLabel ?? mood.label;
  const ps = gloriskScore(mood);
  const shareText = `shareText`;
  const shareUrl = '';

  body.innerHTML = `
    <div class="report-hero">
      <div class="hero-info">
        <div class="hero-ticker">${coin.ticker}</div>
        <div class="hero-name">${coin.company}</div>
        <div class="hero-badges"></div>
      </div>
      <div class="hero-price-block">
        <div class="hero-price">${formatPrice(coin.price, coin.group)}</div>
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

    <!-- GloRisk Score (only shown when Position data loads) -->
    <div id="gloriskCardWrap" style="display:none">
      ${buildGloRiskCard(coin)}
    </div>

    <!-- Performance Summary (always shown) -->
    <div class="section-title">Performance Summary</div>
    ${buildPerfCard(coin)}
    <div class="ai-box" style="margin-bottom:1rem;border-top:none;border-top-left-radius:0;border-top-right-radius:0">
      <div class="ai-text" id="aiText"></div>
    </div>

    <!-- Performance Timeline Chart -->
    <div class="section-title">Performance History</div>
    <div class="chart-wrap" style="margin-bottom:2rem">
      <div class="chart-header">
        <div class="chart-title">${coin.ticker} \u00b7 Performance Score over 12 months</div>
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

    <!-- Performance Analysis -->
    <div class="section-title" style="margin-top:2rem">
      Performance Analysis
      <span class="section-share" id="btnShareAnalysis" title="Share analysis">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Share
      </span>
    </div>
    <div class="full-analysis" id="fullAnalysis">${buildFullAnalysis(coin)}</div>

    <!-- Market Position Analysis (AI-generated, loaded from static JSON) -->
    <div class="section-title" style="margin-top:2rem">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      Market Position Analysis
    </div>
    <div class="glorisk-card" id="positionCard" style="display:none;margin-bottom:0;border-bottom-left-radius:0;border-bottom-right-radius:0"></div>
    <div id="swotSummaryWrap" class="ai-box" style="display:none;border-top:none;border-top-left-radius:0;border-top-right-radius:0;margin-bottom:1rem">
      <div class="ai-text" id="swotSummaryText"></div>
    </div>
    <div id="deepAnalysis" class="ai-box" style="display:none">
      <div class="ai-badge"><div class="ai-dot"></div>Investment Research</div>
      <div class="ai-text" id="deepAnalysisText"></div>
      <div style="margin-top:1rem;font-size:0.62rem;color:var(--muted);font-family:var(--font-mono)">
        <span id="deepAnalysisMeta"></span>
      </div>
    </div>
    <div id="deepAnalysisEmpty" style="padding:1rem;color:var(--muted);font-size:0.82rem;display:none">
      Market position analysis report is not yet available for this asset.
    </div>

    <!-- Indicator Definitions -->
    <div class="section-title" style="margin-top:2rem">Performance Indicator Definitions</div>
    <div class="ind-defs-table">${indDefsHTML}</div>

    <!-- Market Position Definitions -->
    <div class="section-title" style="margin-top:2rem">Market Position Definitions</div>
    <div class="ind-defs-table">
      <div class="ind-def-row">
        <div class="ind-def-name" style="display:flex;align-items:center;gap:6px"><span class="fa-dot" style="background:var(--green)"></span> Momentum</div>
        <div class="ind-def-desc">Strong fundamentals and favourable external conditions.</div>
      </div>
      <div class="ind-def-row">
        <div class="ind-def-name" style="display:flex;align-items:center;gap:6px"><span class="fa-dot" style="background:var(--amber)"></span> Resilient</div>
        <div class="ind-def-desc">Strong business facing macro or cyclical pressures.</div>
      </div>
      <div class="ind-def-row">
        <div class="ind-def-name" style="display:flex;align-items:center;gap:6px"><span class="fa-dot" style="background:var(--orange)"></span> Fragile</div>
        <div class="ind-def-desc">Stable externally but weaker internal fundamentals.</div>
      </div>
      <div class="ind-def-row">
        <div class="ind-def-name" style="display:flex;align-items:center;gap:6px"><span class="fa-dot" style="background:var(--red)"></span> Trouble</div>
        <div class="ind-def-desc">Weak fundamentals and challenging conditions.</div>
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

  // Fit modal toggle
  document.getElementById('fitBdToggle')?.addEventListener('click', () => {
    const modal = document.getElementById('fitModal');
    if (modal) modal.style.display = 'flex';
  });
  document.addEventListener('click', (e) => {
    if (e.target.id === 'fitBdClose' || e.target.classList.contains('fit-modal-overlay')) {
      const modal = document.getElementById('fitModal');
      if (modal) modal.style.display = 'none';
    }
  });
  // Auto-open scoring modal if #scoring hash
  if (window.location.hash === '#scoring') {
    setTimeout(() => {
      const modal = document.getElementById('fitModal');
      if (modal) modal.style.display = 'flex';
    }, 500);
  }

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
          label: 'Performance Score',
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
          callbacks: { label: ctx => `  ${ctx.dataset.label}: ${formatPrice(ctx.raw, coin.group)}` },
        },
      },
      scales: {
        x: { grid: { color: '#1e2530' }, ticks: { color: '#5a6470', font: { family: 'DM Mono', size: 10 }, maxTicksLimit: 8, maxRotation: 0 } },
        y: { position: 'right', grid: { color: '#1e2530' }, ticks: { color: '#5a6470', font: { family: 'DM Mono', size: 10 }, callback: v => formatPrice(v, coin.group) } },
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
    const m = line.match(/\|\s*\*?\*?\d+\.\s*.+?\*?\*?\s*\|\s*(\d+)(?:\/10)?\s*\|/);
    if (m) scores.push(parseInt(m[1]));
  }
  const internal = scores.length >= 5 ? scores.slice(0, 5) : [];
  const external = scores.length >= 10 ? scores.slice(5, 10) : [];
  const intAvg = internal.length ? +(internal.reduce((a, b) => a + b, 0) / internal.length).toFixed(1) : null;
  const extAvg = external.length ? +(external.reduce((a, b) => a + b, 0) / external.length).toFixed(1) : null;
  const overall = intAvg !== null && extAvg !== null ? +((intAvg + extAvg) / 2).toFixed(1) : null;

  // 2. Extract tier classification (supports "Tier N Label" and just "Label")
  const tierLabelMap = { 'momentum': 1, 'pack leader': 1, 'resilient': 2, 'momentum stock': 2, 'fragile': 3, 'defensive holding': 3, 'trouble': 4, 'decliner': 4, 'weak/speculative': 4 };
  let tier = null;
  const tierMatch = report.match(/([\u{1F7E2}\u{1F7E1}\u{1F535}\u{1F534}])\s*\*?\*?(?:Tier\s+(\d)\s+)?([^*()\n]+)/u);
  if (tierMatch) {
    const label = tierMatch[3].trim().replace(/\*\*/g, '');
    const num = tierMatch[2] ? parseInt(tierMatch[2]) : (tierLabelMap[label.toLowerCase()] || null);
    if (num) tier = { number: num, label };
  }

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
    if (lower.includes('catalyst')) continue; // skip catalysts
    if (lower.includes('risk') || lower.includes('headwind') || lower.includes('threat')) {
      risks.push({ title: fullTitle.replace(/^key\s+(risks?)[:\s]*/i, ''), desc: rawDesc });
    } else {
      tailwinds.push({ title: fullTitle.replace(/^key\s+(tailwinds?)[:\s]*/i, ''), desc: rawDesc });
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
    { num: 3, label: 'Fragile', sub: '', color: 'orange' },
    { num: 1, label: 'Momentum', sub: '', color: 'green' },
    { num: 4, label: 'Trouble', sub: '', color: 'red' },
    { num: 2, label: 'Resilient', sub: '', color: 'amber' },
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

/* ── Deep Analysis — navy loader ──────────────────────────────────── */

// Extract Tailwinds/Risks from a parsed report's riskSection
function adParseRiskItems(report) {
  const riskSection = report.split(/###\s*Risk\s*&?\s*Opportunity\s*Analysis/i)[1]?.split(/###/)[0] || '';
  const tailwinds = [];
  const risks = [];
  for (const line of riskSection.split('\n').filter(l => l.trim())) {
    const m = line.match(/(?:^-\s*)?\*\*(.+?)\*\*[:\s]*(.+)/);
    if (!m) continue;
    const fullTitle = m[1].trim();
    const desc = m[2].trim().replace(/\[\d+\]/g, '').replace(/\s{2,}/g, ' ');
    const lower = fullTitle.toLowerCase();
    if (lower.includes('catalyst')) continue;
    if (lower.includes('risk') || lower.includes('headwind') || lower.includes('threat')) {
      risks.push({ title: fullTitle.replace(/^key\s+(risks?)[:\s]*/i, ''), desc });
    } else {
      tailwinds.push({ title: fullTitle.replace(/^key\s+(tailwinds?)[:\s]*/i, ''), desc });
    }
  }
  return { tailwinds, risks };
}

// Extract Overall Verdict paragraph from a parsed report
function adParseVerdict(report) {
  const match = report.split(/###\s*(?:Overall\s+Verdict|Investment\s+Verdict)/i)[1]?.split(/###/)[0] || '';
  return match.trim()
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[\d+\]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
}

// Map position tier label → badge info
function adTierBadge(tierNumber) {
  const map = {
    1: { cls: 'teal',       color: 'var(--ad-teal)',       label: 'Momentum' },
    2: { cls: 'teal-muted', color: 'var(--ad-teal-muted)', label: 'Resilient' },
    3: { cls: 'amber',      color: 'var(--ad-amber)',      label: 'Fragile' },
    4: { cls: 'red-muted',  color: 'var(--ad-red-muted)',  label: 'Trouble' },
  };
  return map[tierNumber] || { cls: 'dim', color: 'var(--ad-text-dim)', label: '—' };
}

// Build indicator groups from the 10 position factor scores (stocks only)
function buildAdPositionIndGroups(rd, report) {
  const FACTOR_LABELS = [
    'Moat & Competitive Advantage',
    'Financial Performance',
    'Balance Sheet Strength',
    'Earnings Quality & Trajectory',
    'Leadership & Governance',
    'Market Position & Competition',
    'Regulatory & Political Exposure',
    'Supply Chain & Geographic Resilience',
    'Macroeconomic Sensitivity',
    'Industry Growth Outlook',
  ];
  // Extract factor reasoning text from the Detailed Scoring Table rows
  const reasoning = {};
  const lines = report.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\|\s*\*?\*?\d+\.\s*([^*|]+?)\*?\*?\s*\|\s*\d+(?:\/10)?\s*\|\s*([^|]+?)\s*\|/);
    if (m) {
      const key = m[1].trim().toLowerCase();
      reasoning[key] = m[2].trim().replace(/\[\d+\]/g, '').replace(/\*\*/g, '');
    }
  }
  const scores = rd.scores || [];
  const cards = FACTOR_LABELS.map((label, i) => {
    const score = scores[i];
    if (score == null) return null;
    const color = score >= 8 ? 'green' : score >= 6 ? 'amber' : 'red';
    const key = label.toLowerCase();
    // Try exact match then partial
    let text = reasoning[key] || '';
    if (!text) {
      for (const [rKey, rVal] of Object.entries(reasoning)) {
        if (rKey.includes(key.split(' ')[0]) || key.includes(rKey.split(' ')[0])) {
          text = rVal;
          break;
        }
      }
    }
    return { color, title: label, label: `${score}/10`, text };
  }).filter(Boolean);

  const groups = [
    { label: 'Going well', dot: 'var(--ad-teal)',      cards: cards.filter(c => c.color === 'green') },
    { label: 'Concerning', dot: 'var(--ad-amber)',     cards: cards.filter(c => c.color === 'amber') },
    { label: 'Critical',   dot: 'var(--ad-red-muted)', cards: cards.filter(c => c.color === 'red') },
  ];
  let html = '';
  for (const g of groups) {
    html += `<div class="ad-ind-group">
      <div class="ad-ind-group-label" style="color:${g.dot}"><div class="ad-ind-dot-lg" style="background:${g.dot}"></div>${g.label} (${g.cards.length})</div>
      <div class="ad-ind-table">`;
    if (g.cards.length === 0) {
      html += `<div class="ad-ind-row"><div class="ad-ind-empty">No ${g.label.toLowerCase()} factors.</div></div>`;
    } else {
      html += `<div class="ad-ind-head"><div class="ad-ind-th">Factor</div><div class="ad-ind-th">Score</div><div class="ad-ind-th">Reasoning</div></div>`;
      for (const c of g.cards) {
        html += `<div class="ad-ind-row">
          <div class="ad-ind-name"><div class="ad-ind-dot" style="background:${g.dot}"></div>${c.title}</div>
          <div class="ad-ind-data" style="color:${g.dot}">${c.label}</div>
          <div class="ad-ind-exp">${c.text || '\u2014'}</div>
        </div>`;
      }
    }
    html += `</div></div>`;
  }
  return html;
}

// Build the 2x2 quadrant visual for Market Position
function buildAdQuadrant(rd, ticker) {
  if (!rd.tier) return '<div class="ad-loading">Quadrant unavailable.</div>';
  const cells = [
    { num: 3, label: 'Fragile',   sub: 'Weak internals, strong external' },
    { num: 1, label: 'Momentum',  sub: 'Strong internals + external' },
    { num: 4, label: 'Trouble',   sub: 'Weak internals and external' },
    { num: 2, label: 'Resilient', sub: 'Strong internals, weak external' },
  ];
  let grid = '';
  for (const c of cells) {
    const active = c.num === rd.tier.number;
    grid += `<div class="ad-matrix-cell${active ? ' active' : ''}">
      <div class="ad-matrix-tier">${c.label}</div>
      <div class="ad-matrix-sub">${c.sub}</div>
      ${active ? `<div class="ad-matrix-point" style="left:50%;top:60%">\u25C6 ${ticker}</div>` : ''}
    </div>`;
  }
  return `<div class="ad-matrix-wrap">
    <div class="ad-matrix-axis">External rating \u2192</div>
    <div class="ad-matrix-grid">${grid}</div>
    <div class="ad-matrix-axis">Internal rating \u2192</div>
  </div>`;
}

async function loadDeepAnalysis(coin) {
  const ticker = coin.ticker;
  const body = document.getElementById('reportBody');
  const isStock = adIsStock(coin);

  // Placeholders
  const roGrid   = body.querySelector('#adRoGrid');
  const verdictEl = body.querySelector('#adVerdict');

  let data;
  try {
    const res = await fetch(`/data/reports/${encodeURIComponent(ticker)}.json`);
    if (!res.ok) throw new Error('not found');
    data = await res.json();
  } catch {
    if (roGrid) roGrid.innerHTML = '<div class="ad-ro-card" style="grid-column:1/-1"><div class="ad-ro-empty">In-depth analysis is not yet available for this asset.</div></div>';
    if (verdictEl) verdictEl.innerHTML = '<span class="ad-ro-empty">No verdict available yet. The Performance Score above reflects the latest price-based indicators.</span>';
    // Locked/placeholder stock rows
    if (isStock) {
      const posNum = body.querySelector('#adPosNum');
      const posBadge = body.querySelector('#adPosBadge');
      const posDesc = body.querySelector('#adPosDesc');
      const posBody = body.querySelector('#adPosBody');
      if (posNum) posNum.textContent = '—';
      if (posBadge) posBadge.innerHTML = '<span class="ad-badge dim">No report</span>';
      if (posDesc) posDesc.textContent = 'Position Score report not yet generated for this stock.';
      if (posBody) posBody.innerHTML = '<div class="ad-loading">No fundamentals analysis available yet for this ticker.</div>';
      const mktNum = body.querySelector('#adMktNum');
      const mktBadge = body.querySelector('#adMktBadge');
      const mktDesc = body.querySelector('#adMktDesc');
      const mktBody = body.querySelector('#adMktBody');
      if (mktNum) mktNum.textContent = '—';
      if (mktBadge) mktBadge.innerHTML = '<span class="ad-badge dim">No report</span>';
      if (mktDesc) mktDesc.textContent = 'Quadrant placement not yet available.';
      if (mktBody) mktBody.innerHTML = '<div class="ad-loading">No market position report available yet for this ticker.</div>';
    }
    return;
  }

  const report = data.report;
  const rd = extractReportData(report);
  const { tailwinds, risks } = adParseRiskItems(report);
  const verdict = adParseVerdict(report);

  // 1. Populate Risk & Opportunity grid
  if (roGrid) {
    if (tailwinds.length === 0 && risks.length === 0) {
      roGrid.innerHTML = '<div class="ad-ro-card" style="grid-column:1/-1"><div class="ad-ro-empty">No risk & opportunity items identified in the latest analysis.</div></div>';
    } else {
      const twHTML = tailwinds.length
        ? tailwinds.slice(0, 3).map(t => `<div style="margin-bottom:8px">${t.title ? `<strong>${t.title}:</strong> ` : ''}${t.desc}</div>`).join('')
        : '<div class="ad-ro-empty">No tailwinds identified.</div>';
      const rkHTML = risks.length
        ? risks.slice(0, 3).map(r => `<div style="margin-bottom:8px">${r.title ? `<strong>${r.title}:</strong> ` : ''}${r.desc}</div>`).join('')
        : '<div class="ad-ro-empty">No material risks identified.</div>';
      roGrid.innerHTML = `
        <div class="ad-ro-card">
          <div class="ad-ro-label" style="color:var(--ad-teal)">\u25B2 Tailwinds</div>
          <div class="ad-ro-text">${twHTML}</div>
        </div>
        <div class="ad-ro-card">
          <div class="ad-ro-label" style="color:var(--ad-red-muted)">\u25BC Key Risks</div>
          <div class="ad-ro-text">${rkHTML}</div>
        </div>
      `;
    }
  }

  // 2. Populate Verdict
  if (verdictEl) {
    verdictEl.innerHTML = verdict
      ? verdict
      : `<span class="ad-ro-empty">No overall verdict available in the latest analysis.</span>`;
  }

  // 3. For stocks, populate Position + Market Position rows + update Overall
  if (isStock && rd.overall != null) {
    const swot100 = Math.round(rd.overall * 10);
    const perfScore = gloriskScore(coin.mood);
    const overall = Math.round(perfScore * 0.6 + swot100 * 0.4);

    // Position row
    const posNum   = body.querySelector('#adPosNum');
    const posBadge = body.querySelector('#adPosBadge');
    const posDesc  = body.querySelector('#adPosDesc');
    const posBody  = body.querySelector('#adPosBody');
    const posBandBadge = adPerfBadge(swot100);
    if (posNum)   { posNum.textContent = swot100; posNum.style.color = posBandBadge.color; }
    if (posBadge) posBadge.innerHTML = `<span class="ad-badge ${posBandBadge.cls}">${posBandBadge.label}</span>`;
    if (posDesc)  posDesc.textContent = `Internal quality ${rd.intAvg != null ? rd.intAvg.toFixed(1) : '—'}/10 \u00b7 External positioning ${rd.extAvg != null ? rd.extAvg.toFixed(1) : '—'}/10.`;
    if (posBody) {
      posBody.innerHTML = `
        <div class="ad-body-label">Factor breakdown</div>
        ${buildAdPositionIndGroups(rd, report)}
      `;
    }

    // Market Position row
    const tierBadge = adTierBadge(rd.tier?.number);
    const mktNum   = body.querySelector('#adMktNum');
    const mktBadgeEl = body.querySelector('#adMktBadge');
    const mktDesc  = body.querySelector('#adMktDesc');
    const mktBody  = body.querySelector('#adMktBody');
    if (mktNum)   { mktNum.textContent = tierBadge.label.charAt(0); mktNum.style.color = tierBadge.color; mktNum.style.fontSize = '14px'; }
    if (mktBadgeEl) mktBadgeEl.innerHTML = `<span class="ad-badge ${tierBadge.cls}">${tierBadge.label}</span>`;
    if (mktDesc) {
      const tierDescs = {
        1: 'Strong internal quality and favourable external conditions.',
        2: 'Strong business facing macro or cyclical headwinds.',
        3: 'Stable externally but weaker internal fundamentals.',
        4: 'Weak internal quality in a challenging market environment.',
      };
      mktDesc.textContent = tierDescs[rd.tier?.number] || 'Quadrant placement based on internal and external ratings.';
    }
    if (mktBody) {
      mktBody.innerHTML = `
        <div class="ad-body-label">Quadrant placement</div>
        ${buildAdQuadrant(rd, ticker)}
      `;
    }

    // Overall row recalculated for stocks (60% Perf + 40% Pos)
    const overallBadge = adPerfBadge(overall);
    const overallNum   = body.querySelector('#adOverallNum');
    const overallBadgeEl = body.querySelector('#adOverallBadge');
    if (overallNum)   { overallNum.textContent = overall; overallNum.style.color = overallBadge.color; }
    if (overallBadgeEl) overallBadgeEl.innerHTML = `<span class="ad-badge ${overallBadge.cls}">${overallBadge.label}</span>`;
  }
}

// Legacy implementation kept below for reference (never executed):
async function __legacyLoadDeepAnalysis(ticker) {
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

    // Compute Market Position Score and build Position card + GloRisk card
    const tierRsbMap = { 1: 'rsb-green', 2: 'rsb-amber', 3: 'rsb-orange', 4: 'rsb-red' };
    const tierLabels = { 1: 'Momentum', 2: 'Resilient', 3: 'Fragile', 4: 'Trouble' };
    if (rd.overall !== null) {
      const swot100 = Math.round(rd.overall * 10);
      const swotBand = getScoreBand(swot100);
      const fundTierRsb = rd.tier ? tierRsbMap[rd.tier.number] || '' : '';
      const fundTierLabel = rd.tier ? (tierLabels[rd.tier.number] || rd.tier.label) : '';

      // Build Position card
      const posCard = document.getElementById('positionCard');
      if (posCard) {
        posCard.innerHTML = `
          <div class="gc-header">
            <div class="sd-label">POSITION SCORE</div>
            <span class="rsb ${fundTierRsb}" style="font-size:0.72rem;padding:3px 12px">${fundTierLabel}</span>
          </div>
          <div class="sd-score-row">
            <span class="sd-score glorisk-headline" style="color:${swotBand.color}">${swot100}</span>
            <span class="sd-max">/ 100</span>
          </div>
          ${buildIssueCountsHTML(rd.scores.filter(s => s >= 5 && s < 8).length, rd.scores.filter(s => s < 5).length)}
        `;
        posCard.style.display = '';
      }

      // Show GloRisk composite card
      const gloriskCardWrap = document.getElementById('gloriskCardWrap');
      const gloriskValueEl  = document.getElementById('gloriskValue');
      const gloriskBadgeEl  = document.getElementById('gloriskBadge');
      const gloriskLabelEl  = document.getElementById('gloriskLabel');
      const gloriskBreakEl  = document.getElementById('gloriskBreakdown');
      const perfValueEl     = document.getElementById('gloriskPerfValue');
      const swotValueEl     = document.getElementById('gloriskSwotValue');
      const swotBadgeEl     = document.getElementById('gloriskSwotBadge');
      if (gloriskValueEl && gloriskCardWrap) {
        const perfScore = parseInt(gloriskValueEl.textContent);
        const glorisk = Math.round((perfScore + swot100) / 2);
        const gloBand = getScoreBand(glorisk);

        if (gloriskLabelEl) gloriskLabelEl.textContent = 'GLORISK SCORE';
        gloriskValueEl.textContent = glorisk;
        gloriskValueEl.style.color = gloBand.color;
        if (gloriskBadgeEl) { gloriskBadgeEl.className = `rsb ${gloBand.cls}`; gloriskBadgeEl.textContent = gloBand.label; gloriskBadgeEl.style.fontSize = '0.72rem'; gloriskBadgeEl.style.padding = '3px 12px'; }
        if (perfValueEl) perfValueEl.textContent = perfScore;
        if (swotValueEl) swotValueEl.textContent = swot100;
        if (swotBadgeEl) { swotBadgeEl.className = `rsb ${fundTierRsb}`; swotBadgeEl.textContent = fundTierLabel; swotBadgeEl.style.fontSize = '0.58rem'; swotBadgeEl.style.padding = '2px 8px'; }
        if (gloriskBreakEl) gloriskBreakEl.style.display = '';
        gloriskCardWrap.style.display = '';
      }
    }

    // Populate Market Position Summary block (executive summary from report)
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
          if (i === 1 && /^\d+(?:\/10)?$/.test(c.trim())) {
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
      // Skip exec summary — already shown as Market Position Summary above
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
  const prev = coin.scoreHistory?.['1m']?.indicators;
  const displayLabel = getMoodBand(coin.mood.label).displayLabel ?? coin.mood.label;
  const ps = gloriskScore(coin.mood);
  const prevScore = coin.scoreHistory?.['1m'] ? gloriskScore(coin.scoreHistory['1m']) : null;
  const g = IND_ORDER.filter(k => ind[k]?.color === 'green').length;
  const a = IND_ORDER.filter(k => ind[k]?.color === 'amber').length;
  const r = IND_ORDER.filter(k => ind[k]?.color === 'red').length;

  // Score direction
  let direction = '';
  if (prevScore !== null) {
    const diff = ps - prevScore;
    if (diff > 0) direction = ` (<span style="color:var(--green)">\u2191${diff} from last month</span>)`;
    else if (diff < 0) direction = ` (<span style="color:var(--red)">\u2193${Math.abs(diff)} from last month</span>)`;
  }

  // Month-on-month indicator changes
  const indNames = {
    volatility: 'Daily Volatility', volSpike: 'Volatility Spike', vsPeak: 'Distance from Peak',
    shortTrend: '50-Day Trend', longTrend: '200-Day Trend', maCross: 'Trend Direction',
    return1M: '30-Day Return', return1Y: '12-Month Return', range52W: 'Position in Range', cagr3Y: '3-Year Growth',
  };
  const improvedList = [], deterioratedList = [];
  if (prev) {
    const colorRank = { green: 0, amber: 1, red: 2 };
    for (const key of IND_ORDER) {
      const curr = ind[key], p = prev[key];
      if (!curr || !p) continue;
      const cR = colorRank[curr.color] ?? 1, pR = colorRank[p.color] ?? 1;
      if (cR < pR) improvedList.push(indNames[key] || key);
      else if (cR > pR) deterioratedList.push(indNames[key] || key);
    }
  }

  // Two-column changes
  let changesHTML = '';
  if (improvedList.length || deterioratedList.length) {
    changesHTML = `<div class="perf-changes">
      <div class="perf-changes-col">
        <div class="perf-changes-header" style="color:var(--green)">\u25B2 IMPROVED</div>
        ${improvedList.length ? improvedList.map(n => `<div class="perf-changes-item">${n}</div>`).join('') : '<div class="perf-changes-item" style="color:var(--muted2)">\u2014 none</div>'}
      </div>
      <div class="perf-changes-col">
        <div class="perf-changes-header" style="color:var(--red)">\u25BC DETERIORATED</div>
        ${deterioratedList.length ? deterioratedList.map(n => `<div class="perf-changes-item">${n}</div>`).join('') : '<div class="perf-changes-item" style="color:var(--muted2)">\u2014 none</div>'}
      </div>
    </div>`;
  }

  let html = `
    <p>${coin.company} is currently rated <strong>${displayLabel}</strong> with a score of <strong>${ps}</strong>${direction}.</p>
    ${changesHTML}
  `;

  aiText.innerHTML = html;
}


/* ── Boot ──────────────────────────────────────────────────────────── */

init().catch(console.error);
