/**
 * GloRisk — Shared watchlist + portfolio helpers + toast component
 * ─────────────────────────────────────────────────────────────────
 * Watchlist is the superset, Portfolio is a subset.
 * Adding to portfolio always adds to watchlist.
 * Removing from watchlist cascades and removes from portfolio.
 *
 * Used by:
 *   - /watchlist.html (the page itself)
 *   - /screener.html (bookmark icon on each row)
 *   - /js/main.js (bookmark icon on the asset detail topbar)
 *
 * Storage:
 *   localStorage['glorisk-watchlist']     = ["MSFT", "AAPL", ...]
 *   localStorage['glorisk-portfolio-fit'] = ["MSFT", ...]   (always ⊆ watchlist)
 */

'use strict';

const WATCHLIST_KEY = 'glorisk-watchlist';
const PORTFOLIO_KEY = 'glorisk-portfolio-fit';

/* ── Watchlist (superset) ────────────────────────────────────────────────── */

export function getWatchlist() {
  try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]'); }
  catch { return []; }
}

export function isWatched(ticker) {
  return getWatchlist().includes(ticker);
}

export function addToWatchlist(ticker) {
  const list = getWatchlist();
  if (list.includes(ticker)) return false;
  list.push(ticker);
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  return true;
}

export function removeFromWatchlist(ticker) {
  const list = getWatchlist();
  const idx = list.indexOf(ticker);
  if (idx < 0) return false;
  list.splice(idx, 1);
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  // Cascade: portfolio cannot exist without watchlist
  removeFromPortfolio(ticker);
  return true;
}

/* ── Portfolio (subset of watchlist) ─────────────────────────────────────── */

export function getPortfolio() {
  try { return JSON.parse(localStorage.getItem(PORTFOLIO_KEY) || '[]'); }
  catch { return []; }
}

export function isInPortfolio(ticker) {
  return getPortfolio().includes(ticker);
}

export function addToPortfolio(ticker) {
  // Adding to portfolio always adds to watchlist (invariant: portfolio ⊆ watchlist)
  addToWatchlist(ticker);
  const list = getPortfolio();
  if (list.includes(ticker)) return false;
  list.push(ticker);
  localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(list));
  return true;
}

export function removeFromPortfolio(ticker) {
  const list = getPortfolio();
  const idx = list.indexOf(ticker);
  if (idx < 0) return false;
  list.splice(idx, 1);
  localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(list));
  return true;
}

/* ── Toast component ─────────────────────────────────────────────────────── */

let toastStylesInjected = false;
function injectToastStyles() {
  if (toastStylesInjected) return;
  toastStylesInjected = true;
  const style = document.createElement('style');
  style.id = 'glo-toast-styles';
  style.textContent = `
    .glo-toast-wrap {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      max-width: 320px;
      font-family: 'DM Sans', system-ui, sans-serif;
      pointer-events: none;
    }
    .glo-toast {
      background: #1E2E52;
      border: 0.5px solid rgba(79,70,229,0.4);
      border-radius: 10px;
      padding: 14px 16px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      color: #F8F7F4;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      animation: glo-toast-in 0.25s ease;
      pointer-events: auto;
    }
    @keyframes glo-toast-in {
      from { transform: translateY(20px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    .glo-toast-msg {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .glo-toast-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: rgba(29,158,117,0.25);
      color: #5DCAA5;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .glo-toast-text { flex: 1; line-height: 1.5; color: #F8F7F4; }
    .glo-toast-text strong { font-weight: 700; color: #F8F7F4; }
    .glo-toast-actions { display: flex; gap: 8px; }
    .glo-toast-action {
      padding: 7px 14px;
      background: rgba(79,70,229,0.25);
      border: 0.5px solid rgba(79,70,229,0.5);
      border-radius: 6px;
      color: #C7D2FE;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      font-family: inherit;
    }
    .glo-toast-action:hover { background: rgba(79,70,229,0.4); color: #fff; }
    .glo-toast-dismiss {
      background: transparent;
      border: none;
      color: rgba(255,255,255,0.4);
      font-size: 16px;
      padding: 0 4px;
      cursor: pointer;
      font-family: inherit;
      line-height: 1;
    }
    .glo-toast-dismiss:hover { color: #F8F7F4; }
  `;
  document.head.appendChild(style);
}

let toastEl = null;
let toastTimer = null;

function dismissToast() {
  if (toastEl) { toastEl.remove(); toastEl = null; }
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
}

/**
 * Show a toast at the bottom-right of the viewport.
 * @param {string} message — main text (HTML allowed)
 * @param {object} options
 * @param {string} [options.actionLabel] — text for the action button (e.g. "+ Add to portfolio")
 * @param {function} [options.onAction] — callback when action button is clicked
 * @param {number} [options.duration=5000] — auto-dismiss in ms
 */
export function showToast(message, options = {}) {
  injectToastStyles();
  dismissToast();

  let wrap = document.querySelector('.glo-toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'glo-toast-wrap';
    document.body.appendChild(wrap);
  }

  toastEl = document.createElement('div');
  toastEl.className = 'glo-toast';

  const actionHTML = options.actionLabel
    ? `<div class="glo-toast-actions"><button class="glo-toast-action">${options.actionLabel}</button></div>`
    : '';

  toastEl.innerHTML = `
    <div class="glo-toast-msg">
      <span class="glo-toast-icon">\u2713</span>
      <span class="glo-toast-text">${message}</span>
      <button class="glo-toast-dismiss" title="Dismiss">\u00d7</button>
    </div>
    ${actionHTML}
  `;

  wrap.appendChild(toastEl);

  if (options.actionLabel && options.onAction) {
    toastEl.querySelector('.glo-toast-action').addEventListener('click', () => {
      options.onAction();
    });
  }
  toastEl.querySelector('.glo-toast-dismiss').addEventListener('click', dismissToast);

  const duration = options.duration ?? 5000;
  toastTimer = setTimeout(dismissToast, duration);
}

/* ── Convenience: add-to-watchlist with portfolio prompt ─────────────────── */

/**
 * Add a ticker to the watchlist and show a toast prompting the user to also
 * add it to the portfolio. Used by every "add to watchlist" entry point
 * (the watchlist page itself, the screener bookmark icon, the asset detail
 * topbar bookmark icon) so the prompt is consistent everywhere.
 */
export function addToWatchlistWithPrompt(ticker, opts = {}) {
  const wasAdded = addToWatchlist(ticker);
  if (!wasAdded && !opts.alwaysShow) return false; // already on the list, no toast
  showToast(`<strong>${ticker}</strong> added to watchlist`, {
    actionLabel: '+ Add to portfolio',
    onAction: () => {
      addToPortfolio(ticker);
      showToast(`<strong>${ticker}</strong> added to portfolio`, { duration: 2000 });
      if (opts.onPortfolioAdded) opts.onPortfolioAdded(ticker);
    },
    duration: 5000,
  });
  return true;
}
