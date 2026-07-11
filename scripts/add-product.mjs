#!/usr/bin/env node
// npm run add <noon affiliate url>
//
// Parses the product name and one spec from the noon URL and page, drafts an
// Arabic + English row, prints it for you to approve, then appends it to
// products.csv. Refuses a plain (non affiliate) noon link.
//
// The verdict it drafts is a STUB built from one real spec number, or blank when
// the page gives no such number. You rewrite it. It never writes filler.

import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { isNoonUrl, isAffiliateUrl } from './affiliate.mjs';
import { findPrice, findFancyDash, hasHyphen } from './guardrails.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(ROOT, 'products.csv');
const HEADER = 'show,category_ar,category_en,name_ar,name_en,verdict_ar,verdict_en,url,image';

const ACRONYMS = new Set(['USB', 'GAN', 'GaN', 'HDMI', 'RGB', 'LED', 'ANC', 'TWS', 'PD', 'W', 'AI', '4K', '8K', 'TV', 'SSD', 'HD']);
const CATS = [
  [/charg|power|gan|cable|adapter|powerbank|brick|\bpd\b|watt/i, { ar: 'الشحن', en: 'Charging' }],
  [/audio|speaker|soundcore|headphone|earbud|buds|\bmic\b|sound/i, { ar: 'الصوت', en: 'Audio' }],
  [/smart|aqara|sensor|bulb|plug|home|hub|zigbee/i, { ar: 'البيت الذكي', en: 'Smart Home' }],
  [/case|screen|mount|holder|stand|grip|magsafe|phone/i, { ar: 'ملحقات الجوال', en: 'Phone Accessories' }],
  [/watch|band|strap|wearable/i, { ar: 'الساعات', en: 'Wearables' }],
];

function die(msg) { console.error('\n' + msg + '\n'); process.exit(1); }

function slugFromNoonUrl(u) {
  // .../uae-en/momax-140w-gan-charger/N70012345V/p/  ->  momax-140w-gan-charger
  const parts = u.pathname.split('/').filter(Boolean);
  // drop the locale segment (uae-en) and the product code / p
  const cand = parts.filter(p => !/^[a-z]{2,}-[a-z]{2}$/i.test(p) && !/^N[0-9A-Z]{6,}$/i.test(p) && p !== 'p');
  return cand.sort((a, b) => b.length - a.length)[0] || '';
}

const UNIT_CASE = { mah: 'mAh', wh: 'Wh', hz: 'Hz', gb: 'GB', tb: 'TB', w: 'W', k: 'K' };
function fixToken(w) {
  const up = w.toUpperCase();
  if (ACRONYMS.has(up)) return up === 'GAN' ? 'GaN' : up;
  const unit = w.match(/^(\d+(?:\.\d+)?)(mah|wh|hz|gb|tb|w|k)$/i);
  if (unit) return unit[1] + UNIT_CASE[unit[2].toLowerCase()];   // 24000mah -> 24000mAh
  if (/\d/.test(w)) return up;                                   // n70, 4k, p1
  return w.charAt(0).toUpperCase() + w.slice(1);
}
function titleFromSlug(slug) {
  return slug.split('-').filter(Boolean).map(fixToken).join(' ').trim();
}

// noon titles are SEO strings: "Buy X ... | Best Price UAE | Dubai | noon".
// Keep only the part before the first pipe, and strip the Buy/Shop wrappers.
function cleanName(s) {
  return String(s || '')
    .split('|')[0]
    .replace(/^\s*(buy|shop|تسوق|اشتري)\s+/i, '')
    .replace(/\s+online\b.*$/i, '')     // English tail
    .replace(/\s*أونلاين.*$/, '')        // Arabic tail (no \b before Arabic script)
    .replace(/\s{2,}/g, ' ').trim();
}

// Pull one salient spec number. Priority order matters: the strongest single fact wins.
function extractSpec(text) {
  const t = String(text || '');
  const rules = [
    [/(\d+(?:\.\d+)?)\s?W\b/i,      (n) => ({ en: `${n}W in one charger`, ar: `${n} واط من راس واحد` })],
    [/(\d{3,5})\s?mAh\b/i,          (n) => ({ en: `${n}mAh in the pack`, ar: `${n} مللي أمبير في البنك` })],
    [/(\d+(?:\.\d+)?)\s?Wh\b/i,     (n) => ({ en: `${n}Wh`, ar: `${n} واط ساعة` })],
    [/(\d+(?:\.\d+)?)\s?(TB|GB)\b/i,(n, u) => ({ en: `${n}${u.toUpperCase()} of storage`, ar: `${n} ${/tb/i.test(u) ? 'تيرا' : 'جيجا'} تخزين` })],
    [/(\d+(?:\.\d+)?)\s?Hz\b/i,     (n) => ({ en: `${n}Hz`, ar: `${n} هرتز` })],
    [/(\d+(?:\.\d+)?)\s?(?:inch|["”])\b/i, (n) => ({ en: `${n} inch`, ar: `${n} إنش` })],
  ];
  for (const [re, fmt] of rules) {
    const m = t.match(re);
    if (m) return fmt(m[1], m[2]);
  }
  return null;
}

function guessCategory(text) {
  for (const [re, cat] of CATS) if (re.test(text)) return cat;
  return { ar: 'ملحقات', en: 'Accessories' };
}

async function fetchMeta(url) {
  const out = { title: '', ar: '' };
  const get = async (u) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(u, {
        redirect: 'follow', signal: ctrl.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 'accept-language': 'en' },
      });
      if (!res.ok) return '';
      return await res.text();
    } catch { return ''; } finally { clearTimeout(t); }
  };
  const og = (html) => {
    const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return m ? m[1].trim() : '';
  };
  const html = await get(url);
  if (html) out.title = og(html);
  // best effort Arabic name from the -ar locale variant
  try {
    const arUrl = new URL(url);
    if (/-en\//.test(arUrl.pathname)) {
      arUrl.pathname = arUrl.pathname.replace(/-en\//, '-ar/');
      const arHtml = await get(arUrl.toString());
      if (arHtml) out.ar = og(arHtml);
    }
  } catch { /* ignore */ }
  return out;
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  const url = (process.argv[2] || '').trim();

  if (!url) die('Usage:  npm run add <noon affiliate url>');

  // Guardrail 2, at the door: affiliate links only.
  if (!isAffiliateUrl(url)) {
    if (isNoonUrl(url)) {
      die([
        'That is a plain noon product link, not an affiliate link.',
        'Open it from your noon affiliate dashboard and copy the tracked link instead,',
        'then run:  npm run add <that link>',
        '',
        'Nothing was added.',
      ].join('\n'));
    }
    die('That does not look like a noon affiliate link. Paste your tracked noon link.\nNothing was added.');
  }

  console.log('\nReading the product page...');
  const meta = await fetchMeta(url);

  let u; try { u = new URL(url); } catch { u = null; }
  const slug = u ? slugFromNoonUrl(u) : '';
  // Prefer the slug: it is the concise, human name. og:title is SEO cruft, kept only
  // as a fallback when there is no slug. Arabic has no slug, so it uses the -ar title.
  const name_en = titleFromSlug(slug) || cleanName(meta.title) || '';
  const name_ar = cleanName(meta.ar) || name_en;
  if (!name_en) die('Could not read a product name from the link or page. Nothing was added.');

  const basis = [name_en, meta.title, slug].join(' ');
  const cat = guessCategory(basis);
  const spec = extractSpec(basis);

  const verdict_en = spec ? `${spec.en}.` : '';
  const verdict_ar = spec ? `${spec.ar}.` : '';

  const row = {
    show: 'yes',
    category_ar: cat.ar, category_en: cat.en,
    name_ar, name_en,
    verdict_ar, verdict_en,
    url, image: '',
  };

  // Enforce the guardrails on what we are about to write.
  const proseFields = ['category_ar', 'category_en', 'verdict_ar', 'verdict_en'];
  const copyFields = ['category_ar', 'category_en', 'name_ar', 'name_en', 'verdict_ar', 'verdict_en'];
  for (const f of copyFields) {
    const p = findPrice(row[f]); if (p) die(`Refusing to write: a price ("${p}") landed in ${f}.`);
    const d = findFancyDash(row[f]); if (d) die(`Refusing to write: an em/en dash landed in ${f}. Rewrite it with plain words.`);
  }
  for (const f of proseFields) if (hasHyphen(row[f])) die(`Refusing to write: a hyphen landed in ${f}. Rewrite it without a hyphen.`);
  for (const f of ['name_ar', 'name_en']) if (hasHyphen(row[f])) console.warn(`  ! heads up: "${row[f]}" contains a hyphen. Fine for a model name, but check it.`);

  // Preview.
  const line = [row.show, row.category_ar, row.category_en, row.name_ar, row.name_en, row.verdict_ar, row.verdict_en, row.url, row.image].map(csvEscape).join(',');
  console.log('\n  category   ' + row.category_en + '  /  ' + row.category_ar);
  console.log('  name (en)  ' + row.name_en);
  console.log('  name (ar)  ' + row.name_ar);
  console.log('  verdict    ' + (verdict_en || '(blank)'));
  console.log('  verdict ع  ' + (verdict_ar || '(فاضي)'));
  console.log('  url        ' + row.url);
  if (!spec) {
    console.log('\n  No spec number was on the page. The verdict is blank on purpose.');
    console.log('  Write the one fact a spec sheet could not: what it replaced, what it');
    console.log('  survived, the number that actually matters. Do the maths if you have to.');
  } else {
    console.log('\n  This verdict is a stub built from one number. Rewrite it in your own voice.');
  }
  console.log('\n  CSV line:\n  ' + line + '\n');

  const rl = createInterface({ input: stdin, output: stdout });
  const ans = (await rl.question('Append this row to products.csv? [y/N] ')).trim().toLowerCase();
  rl.close();
  if (ans !== 'y' && ans !== 'yes') { console.log('\nNothing was added.\n'); return; }

  if (!existsSync(CSV)) await writeFile(CSV, HEADER + '\n', 'utf8');
  const body = await readFile(CSV, 'utf8').catch(() => '');
  const prefix = body.length && !body.endsWith('\n') ? '\n' : '';
  await appendFile(CSV, prefix + line + '\n', 'utf8');
  console.log('\nAdded to products.csv. Edit the verdict there, then commit and push.\n');
}

main().catch((e) => die('Unexpected error: ' + (e && e.message ? e.message : e)));
