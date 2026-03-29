/**
 * GloRisk — UI Utilities
 * Shared helpers used across all views.
 */

'use strict';

import { getMoodBand, IND_META, IND_ORDER } from './riskEngine.js';

/* ── Price formatter ─────────────────────────────────────────────────────── */

export function formatPrice(p) {
  if (p == null) return '—';
  if (p < 0.0001) return '$' + p.toFixed(8);
  if (p < 0.01)   return '$' + p.toFixed(6);
  if (p < 1)      return '$' + p.toFixed(4);
  return '$' + p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── Mood pill HTML ──────────────────────────────────────────────────────── */

export function moodPill(label) {
  const band = getMoodBand(label);
  return `<span class="mood-pill ${band.cls}">${band.displayLabel ?? label}</span>`;
}

/* ── Risk score bar ──────────────────────────────────────────────────────── */

export function scoreBar(pct, color) {
  return `
    <div class="score-bar">
      <div class="score-fill" style="width:${pct}%;background:${color}"></div>
    </div>
  `;
}

/* ── Indicator dot HTML ──────────────────────────────────────────────────── */

export function indDot(color) {
  return `<span class="ind-dot ind-dot--${color}"></span>`;
}

/* ── Format a date string ────────────────────────────────────────────────── */

export function formatDate(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/* ── Swing badge HTML ────────────────────────────────────────────────────── */

export function swingBadge(swing) {
  if (!swing || swing.delta === 0 || swing.state === 'flat') {
    return `<span class="swing swing--flat">● 0</span>`;
  }
  const abs = Math.abs(swing.delta);
  if (swing.state === 'up')  return `<span class="swing swing--up">↑ ${abs}</span>`;
  if (swing.state === 'red') return `<span class="swing swing--down">↓ ${abs}</span>`;
  return `<span class="swing swing--warn">↓ ${abs}</span>`;
}

/* ── Build full indicator table rows ─────────────────────────────────────── */

export function buildIndicatorRows(indicators) {
  return IND_ORDER.map(key => {
    const ind  = indicators[key];
    if (!ind) return '';
    const meta = IND_META[key];
    return `
      <div class="ind-row" data-ind="${key}">
        <div class="ind-signal ind-signal--${ind.color}"></div>
        <div class="ind-info">
          <div class="ind-name">${meta.label}</div>
          <div class="ind-desc">${meta.desc}</div>
        </div>
        <div class="ind-val ind-val--${ind.color}">${ind.label}</div>
        <div class="ind-pts ${ind.pts > 0 ? 'ind-pts--bad' : ''}">${ind.pts > 0 ? '+' + ind.pts + 'pts' : '—'}</div>
      </div>
    `;
  }).join('');
}

/* ── Search dropdown: render items ───────────────────────────────────────── */

export function buildDropdownItems(coins, moodPillFn) {
  const pill = moodPillFn || moodPill;
  if (!coins.length) {
    return `<div class="dd-empty">No assets found</div>`;
  }
  return coins.map((c, i) => `
    <div class="dd-item" data-idx="${i}" data-ticker="${c.ticker}">
      <div class="dd-ticker">${c.ticker}</div>
      <div class="dd-name">${c.company}</div>
      <div class="dd-mood">${pill(c.mood.label)}</div>
    </div>
  `).join('');
}
