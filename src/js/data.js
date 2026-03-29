/**
 * GloRisk — Data Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches pre-built JSON data. No CSV parsing in the browser.
 *   coins.json          — lightweight catalog for browse grid
 *   assets/{TICKER}.json — per-asset price history + MAs (on demand)
 */

'use strict';

let _cache = null;
const _assetCache = {};

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

/* ── Get mood distribution counts ────────────────────────────────────────── */

export async function getMoodCounts() {
  const { coins } = await loadData();
  const counts = { 'Very Healthy': 0, Healthy: 0, Unsettled: 0, Stressed: 0, Critical: 0 };
  coins.forEach(c => { if (counts[c.mood.label] !== undefined) counts[c.mood.label]++; });
  return counts;
}

/* ── Fetch per-asset JSON (price history + MAs) on demand ────────────────── */

export async function fetchAssetData(coin) {
  const file = coin.assetFile;
  if (!file) return null;
  if (_assetCache[file]) return _assetCache[file];

  const res = await fetch(`/data/assets/${file}`);
  if (!res.ok) return null;

  const data = await res.json();
  _assetCache[file] = data;
  return data;
}
