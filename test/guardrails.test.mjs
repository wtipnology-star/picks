// Run with: npm test   (node --test)
// These lock the four non negotiables: no prices, affiliate links only,
// no em/hyphen dashes, no CSS letter-spacing on Arabic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isAffiliateUrl, isKnownMerchantUrl, merchantOf } from '../scripts/affiliate.mjs';
import { findPrice, findFancyDash, hasHyphen } from '../scripts/guardrails.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

/* ---- minimal CSV parser, same semantics as the page ---- */
function parseCSV(text) {
  const rows = []; let row = [], f = '', inQ = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else inQ = false; } else f += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}
function loadProducts() {
  const rows = parseCSV(read('products.csv'));
  const head = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

const products = loadProducts();
const COPY = ['category_ar', 'category_en', 'name_ar', 'name_en', 'verdict_ar', 'verdict_en'];
const PROSE = ['category_ar', 'category_en', 'verdict_ar', 'verdict_en'];
const label = (p) => p.name_en || p.name_ar || '(row)';

/* ===================== 1. No prices ===================== */
test('products.csv: no prices in any copy', () => {
  for (const p of products) for (const f of COPY) {
    const hit = findPrice(p[f]);
    assert.equal(hit, null, `price "${hit}" in ${f} of "${label(p)}"`);
  }
});

test('index.html: no prices in the copy dictionary', () => {
  const html = read('index.html');
  // All visible copy is in the T dictionary + FALLBACK. Scan those, not the whole
  // script; strip ${...} interpolations so template syntax is not mistaken for copy.
  const T = html.slice(html.indexOf('const T'), html.indexOf('let lang='));
  const FB = html.slice(html.indexOf('const FALLBACK'), html.indexOf('const T'));
  const copy = (T + FB).replace(/\$\{[^}]*\}/g, ' ');
  const hit = findPrice(copy);
  assert.equal(hit, null, `price-like token "${hit}" found in the copy dictionary`);
});

/* ============== 2. Affiliate links only ============== */
test('products.csv: every url is an affiliate link', () => {
  for (const p of products) {
    assert.ok(p.url && p.url !== '#', `empty url on "${label(p)}"`);
    assert.ok(isAffiliateUrl(p.url), `not an affiliate link: ${p.url} ("${label(p)}")`);
  }
});

test('index.html: FALLBACK urls are affiliate links (or empty placeholder #)', () => {
  const html = read('index.html');
  const block = html.slice(html.indexOf('const FALLBACK'), html.indexOf('const T'));
  const urls = [...block.matchAll(/url:\s*"([^"]*)"/g)].map(m => m[1]);
  assert.ok(urls.length > 0, 'expected at least one FALLBACK url');
  for (const u of urls) assert.ok(isAffiliateUrl(u), `FALLBACK url is not affiliate: ${u}`);
});

test('affiliate rule holds across supported stores', () => {
  // noon: bare product link is not affiliate, tracked one is
  const noonBare = 'https://www.noon.com/uae-en/momax-140w-gan-charger/N70012345V/p/';
  assert.equal(isKnownMerchantUrl(noonBare), true, 'noon link should be a known store');
  assert.equal(isAffiliateUrl(noonBare), false, 'bare noon link must not count as affiliate');
  assert.equal(isAffiliateUrl(noonBare + '?utm_source=wtipnology'), true, 'tracked noon link must count');

  // amazon: a.co share link earns nothing; amzn.to (SiteStripe) and ?tag= do
  assert.equal(isKnownMerchantUrl('https://a.co/d/0gB3ciBx'), true, 'a.co should be a known store');
  assert.equal(isAffiliateUrl('https://a.co/d/0gB3ciBx'), false, 'a.co share link must not count');
  assert.equal(isAffiliateUrl('https://amzn.to/3abcXYZ'), true, 'amzn.to SiteStripe link must count');
  assert.equal(isAffiliateUrl('https://www.amazon.ae/dp/B0ABC12345?tag=wtip-21'), true, '?tag= must count');
  assert.equal(isAffiliateUrl('https://www.amazon.ae/dp/B0ABC12345'), false, 'untagged amazon must not count');
  assert.equal(merchantOf('https://www.amazon.ae/dp/B0ABC12345').id, 'amazon');

  // unknown store is refused outright
  assert.equal(isKnownMerchantUrl('https://example.com/x'), false, 'unknown store must be unrecognised');
  assert.equal(isAffiliateUrl('https://example.com/x?tag=y'), false, 'unknown store never counts as affiliate');
});

test('index.html: buy links carry rel="nofollow sponsored"', () => {
  const html = read('index.html');
  const buy = html.match(/<a class="buy"[^>]*>/i);
  assert.ok(buy, 'buy link not found');
  assert.match(buy[0], /rel="[^"]*nofollow[^"]*"/i);
  assert.match(buy[0], /rel="[^"]*sponsored[^"]*"/i);
});

/* ============== 3. No em dashes or hyphens ============== */
test('products.csv: no em/en dashes anywhere in copy', () => {
  for (const p of products) for (const f of COPY) {
    const d = findFancyDash(p[f]);
    assert.equal(d, null, `dash "${d}" in ${f} of "${label(p)}"`);
  }
});

test('products.csv: no hyphens in prose (names may keep model hyphens)', () => {
  for (const p of products) for (const f of PROSE) {
    assert.equal(hasHyphen(p[f]), false, `hyphen in ${f} of "${label(p)}"`);
  }
});

test('index.html: no em/en dashes in the fixed copy dictionary', () => {
  const html = read('index.html');
  const T = html.slice(html.indexOf('const T'), html.indexOf('let lang='));
  const d = findFancyDash(T);
  assert.equal(d, null, `dash "${d}" found in the copy dictionary`);
});

/* ====== 4. No CSS letter-spacing on Arabic surfaces ====== */
test('index.html: no letter-spacing on any Arabic-bearing selector', () => {
  const html = read('index.html');
  const style = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)[1];
  const ARABIC_SELECTORS = ['body', '.name', '.verdict', '.cat', '.count', '.chip', '.eyebrow', '.lede', '.disclose', '.ar-name', '#q', '.buy', 'h1'];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const offenders = [];
  // match innermost rule blocks (also works inside @media, whose inner rules have no braces)
  for (const m of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim(), decls = m[2];
    if (!/letter-spacing/i.test(decls)) continue;
    if (/letter-spacing\s*:\s*0(?:[a-z%]+)?\s*(?:!important)?\s*;?/i.test(decls)) continue; // zeroed
    const latinScoped = /\[dir=["']?ltr["']?\]/.test(sel) || /var\(--lat\)/.test(decls);
    const arabicish = /var\(--ar\)/.test(decls) ||
      ARABIC_SELECTORS.some(a => new RegExp('(^|[\\s,>+~])' + esc(a) + '($|[\\s,>+~:.\\[])').test(sel));
    if (arabicish && !latinScoped) offenders.push(sel);
  }
  assert.deepEqual(offenders, [], `letter-spacing on Arabic selector(s): ${offenders.join(' , ')}`);
});
