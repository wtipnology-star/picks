#!/usr/bin/env node
// npm run add <affiliate url>
//
// Parses the product name and one spec from a supported store's URL and page,
// drafts an Arabic + English row, prints it for you to approve, then appends it
// to products.csv. Refuses a link that is not from a supported store, or that is
// a bare (untracked) link that would earn you nothing.
//
// Supported stores and what a valid affiliate link looks like live in affiliate.mjs.
// The verdict it drafts is a stub built from one real spec number, or blank when
// the page gives no such number. You rewrite it. It never writes filler.

import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { merchantOf, isAffiliateUrl, supportedStores } from './affiliate.mjs';
import { findPrice, findFancyDash, hasHyphen } from './guardrails.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(ROOT, 'products.csv');
const HEADER = 'show,category_ar,category_en,name_ar,name_en,verdict_ar,verdict_en,url,image,featured';

const ACRONYMS = new Set(['USB', 'GAN', 'GaN', 'HDMI', 'RGB', 'LED', 'ANC', 'TWS', 'PD', 'AI', '4K', '8K', 'TV', 'SSD', 'HD', 'GB', 'TB']);
// Keyword -> category. Order matters (first match wins). Patterns use word
// boundaries so "AI-Powered" does not read as "power" -> Charging.
const CATS = [
  [/charger|charging|\bgan\b|\bcable\b|adapter|power\s?bank|\bpd\b|\bwatt|\bwh\b/i, { ar: 'الشحن', en: 'Charging' }],
  [/audio|speaker|soundcore|headphone|earbud|\bbuds\b|\bmic\b|earphone|\bsound\b/i, { ar: 'الصوت', en: 'Audio' }],
  [/smart\s?home|aqara|\bsensor\b|\bbulb\b|smart\s?plug|\bhub\b|zigbee|matter/i, { ar: 'البيت الذكي', en: 'Smart Home' }],
  [/\bcase\b|screen protector|\bmount\b|holder|\bstand\b|magsafe|grip/i, { ar: 'ملحقات الجوال', en: 'Phone Accessories' }],
  [/watch|\bband\b|strap|wearable|fitbit|tracker|fitness|garmin|smartwatch/i, { ar: 'الساعات', en: 'Wearables' }],
];

function die(msg) { console.error('\n' + msg + '\n'); process.exit(1); }

// Generic slug: the human, hyphenated segment. Works for noon
// (.../momax-140w-gan-charger/N70012345V/p/) and Amazon (.../Anker-Charger-140W/dp/B0..).
function slugFromUrl(u) {
  const parts = u.pathname.split('/').filter(Boolean);
  const drop = (p) =>
    /^[a-z]{2,}-[a-z]{2}$/i.test(p) ||           // locale segment (uae-en)
    /^N[0-9A-Z]{6,}$/i.test(p) ||                // noon product code
    /^B0[0-9A-Z]{8}$/i.test(p) ||                // amazon ASIN
    /^[A-Z0-9]{10}$/.test(p) ||                  // bare ASIN
    /^(dp|gp|p|d|product|ref|slredirect)$/i.test(p);
  const cand = parts.filter((p) => !drop(p));
  cand.sort((a, b) => (b.split('-').length - a.split('-').length) || (b.length - a.length));
  return cand[0] || '';
}

const UNIT_CASE = { mah: 'mAh', wh: 'Wh', hz: 'Hz', gb: 'GB', tb: 'TB', w: 'W', k: 'K' };
function fixToken(w) {
  const up = w.toUpperCase();
  if (ACRONYMS.has(up)) return up === 'GAN' ? 'GaN' : up;
  const unit = w.match(/^(\d+(?:\.\d+)?)(mah|wh|hz|gb|tb|w|k)$/i);
  if (unit) return unit[1] + UNIT_CASE[unit[2].toLowerCase()];
  if (/\d/.test(w)) return up;
  return w.charAt(0).toUpperCase() + w.slice(1);
}
function titleFromSlug(slug) { return slug.split('-').filter(Boolean).map(fixToken).join(' ').trim(); }

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;|&#0?39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; } });
}

// Strip store SEO wrappers and keep the core product name. Amazon titles read
// "Brand Model - long descriptors : Category"; noon adds "تسوق ... أونلاين | ...".
function cleanName(s) {
  let t = decodeEntities(String(s || '')).split('|')[0];
  t = t.replace(/^\s*amazon\.[a-z.]+\s*:\s*/i, '')
       .replace(/^\s*(buy|shop|تسوق|اشتري)\s+/i, '')
       .replace(/\s+online\b.*$/i, '')
       .replace(/\s*أونلاين.*$/, '');
  // cut at the first " - " / " : " separator — everything after is descriptors/category
  t = t.split(/\s+[-–—:]\s+/)[0];
  // cut at the first comma that is not a digit grouping comma (25,000 is kept)
  t = t.replace(/(?:(?<!\d),|,(?!\d)).*$/s, '');
  return t.replace(/\s{2,}/g, ' ').trim();
}

// One salient spec number, strongest fact first.
function extractSpec(text) {
  const t = String(text || '');
  const rules = [
    [/(\d+(?:\.\d+)?)\s?W\b/i,        (n) => ({ en: `${n}W in one charger`, ar: `${n} واط من راس واحد` })],
    [/(\d{3,5})\s?mAh\b/i,            (n) => ({ en: `${n}mAh in the pack`, ar: `${n} مللي أمبير في البنك` })],
    [/(\d+(?:\.\d+)?)\s?Wh\b/i,       (n) => ({ en: `${n}Wh`, ar: `${n} واط ساعة` })],
    [/(\d+(?:\.\d+)?)\s?(TB|GB)\b/i,  (n, u) => ({ en: `${n}${u.toUpperCase()} of storage`, ar: `${n} ${/tb/i.test(u) ? 'تيرا' : 'جيجا'} تخزين` })],
    [/(\d+(?:\.\d+)?)\s?Hz\b/i,       (n) => ({ en: `${n}Hz`, ar: `${n} هرتز` })],
    [/(\d+(?:\.\d+)?)\s?(?:inch|["”])\b/i, (n) => ({ en: `${n} inch`, ar: `${n} إنش` })],
    [/(\d+)\s?days?['’\s]+(?:battery|of\s+battery|life)/i, (n) => ({ en: `${n} day battery`, ar: `${n} أيام بطارية` })],
  ];
  for (const [re, fmt] of rules) { const m = t.match(re); if (m) return fmt(m[1], m[2]); }
  return null;
}

function guessCategory(text) {
  for (const [re, cat] of CATS) if (re.test(text)) return cat;
  return { ar: 'ملحقات', en: 'Accessories' };
}

async function fetchMeta(url, merchant) {
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
  // noon exposes an Arabic page at the -ar locale; other stores do not, cheaply.
  if (merchant && merchant.id === 'noon') {
    try {
      const arUrl = new URL(url);
      if (/-en\//.test(arUrl.pathname)) {
        arUrl.pathname = arUrl.pathname.replace(/-en\//, '-ar/');
        const arHtml = await get(arUrl.toString());
        if (arHtml) out.ar = og(arHtml);
      }
    } catch { /* ignore */ }
  }
  return out;
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  const url = (process.argv[2] || '').trim();
  if (!url) die(`Usage:  npm run add <affiliate url>\nSupported stores: ${supportedStores()}`);

  const merchant = merchantOf(url);
  if (!merchant) die(`That is not a store I recognise. Supported: ${supportedStores()}.\nPaste a tracked affiliate link.\nNothing was added.`);

  // Guardrail 2, at the door: affiliate (tracked) links only.
  if (!isAffiliateUrl(url)) {
    die([
      `That is a plain ${merchant.label} link, not an affiliate link, so it would earn you nothing.`,
      merchant.hint,
      '',
      'Nothing was added.',
    ].join('\n'));
  }

  console.log(`\nReading the ${merchant.label} product page...`);
  const meta = await fetchMeta(url, merchant);

  let u; try { u = new URL(url); } catch { u = null; }
  const slug = u ? slugFromUrl(u) : '';
  const slugName = titleFromSlug(slug);
  const titleName = cleanName(meta.title);
  // prefer a multi-word slug (reads like a real name); else the cleaned page title.
  const name_en = (slugName && slugName.includes(' ')) ? slugName : (titleName || slugName || '');
  const name_ar = cleanName(meta.ar) || name_en;
  if (!name_en) die('Could not read a product name from the link or page. Nothing was added.');

  const basis = [name_en, meta.title, slug].join(' ');
  const cat = guessCategory(basis);
  const spec = extractSpec(basis);
  const verdict_en = spec ? `${spec.en}.` : '';
  const verdict_ar = spec ? `${spec.ar}.` : '';

  const row = {
    show: 'yes', category_ar: cat.ar, category_en: cat.en,
    name_ar, name_en, verdict_ar, verdict_en, url, image: '', featured: 'no',
  };

  // Enforce the guardrails on what we are about to write.
  const copyFields = ['category_ar', 'category_en', 'name_ar', 'name_en', 'verdict_ar', 'verdict_en'];
  const proseFields = ['category_ar', 'category_en', 'verdict_ar', 'verdict_en'];
  for (const f of copyFields) {
    const p = findPrice(row[f]); if (p) die(`Refusing to write: a price ("${p}") landed in ${f}.`);
    const d = findFancyDash(row[f]); if (d) die(`Refusing to write: an em/en dash landed in ${f}. Rewrite it with plain words.`);
  }
  for (const f of proseFields) if (hasHyphen(row[f])) die(`Refusing to write: a hyphen landed in ${f}. Rewrite it without a hyphen.`);
  for (const f of ['name_ar', 'name_en']) if (hasHyphen(row[f])) console.warn(`  ! heads up: "${row[f]}" contains a hyphen. Fine for a model name, but check it.`);
  if (!name_en.includes(' ')) console.warn('  ! could not read a clean product name (short/redirect link). Edit name_en below before it goes live.');
  if (merchant.id !== 'noon' && name_ar === name_en) console.warn('  ! Arabic name copied from English. Rewrite name_ar in your dialect.');

  const line = [row.show, row.category_ar, row.category_en, row.name_ar, row.name_en, row.verdict_ar, row.verdict_en, row.url, row.image, row.featured].map(csvEscape).join(',');
  console.log('\n  store      ' + merchant.label);
  console.log('  category   ' + row.category_en + '  /  ' + row.category_ar);
  console.log('  name (en)  ' + row.name_en);
  console.log('  name (ar)  ' + row.name_ar);
  console.log('  verdict    ' + (verdict_en || '(blank)'));
  console.log('  verdict ع  ' + (verdict_ar || '(فاضي)'));
  console.log('  url        ' + row.url);
  console.log('  featured   ' + row.featured + '  (set to "yes" in products.csv to add it to the swipe strip)');
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
