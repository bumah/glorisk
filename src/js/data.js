/**
 * GloRisk — Data Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches pre-built JSON data. No CSV parsing in the browser.
 *   coins.json — unified catalog (~30k stocks from fundamentals snapshot)
 *
 * Crypto, ETFs and indices are returning via their own input files in
 * follow-up commits. Until then, only stocks are in the catalog.
 */

'use strict';

let _cache = null;

/* ── Load and return all coins ─────────────────────────────────────────── */

export async function loadData() {
  if (_cache) return _cache;

  const res  = await fetch('/data/coins.json');
  const json = await res.json();

  _cache = {
    asOf:  json.asOf,
    built: json.built,
    total: json.total,
    coins: json.coins,
  };
  return _cache;
}

/* ── Search coins by ticker or name ──────────────────────────────────────── */

export async function searchCoins(query, limit = 10) {
  const { coins } = await loadData();
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return coins
    .filter(c =>
      c.ticker.toLowerCase().includes(q) ||
      c.company.toLowerCase().includes(q)
    )
    .slice(0, limit);
}

/* ── Get a single coin by ticker ─────────────────────────────────────────── */

export async function getCoin(ticker) {
  const { coins } = await loadData();
  return coins.find(c => c.ticker === ticker.toUpperCase()) ?? null;
}

/* ── Get all coins ───────────────────────────────────────────────────────── */

export async function getAllCoins() {
  const { coins } = await loadData();
  return coins;
}
