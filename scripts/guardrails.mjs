// Copy guardrails shared by the add-script and the tests. Pure string checks, no I/O.

// Currency codes, symbols, and Arabic currency words. If any appear in copy we treat
// it as a price and refuse it. Kept to real currency signals so that ordinary words
// like "cost" in the disclosure ("no extra cost to you") do not false-positive.
const PRICE_RE = new RegExp([
  '\\b(BHD|SAR|AED|KWD|QAR|OMR|USD|EUR|GBP)\\b',
  '[$£€]',
  'ر\\.[سقع]|د\\.[بإك]',   // ر.س ر.ق ر.ع د.ب د.إ د.ك — dot required, no space (a spaced "د. ك" is a sentence boundary)
  'ريال|درهم|دينار|دولار|يورو',
  'سعر|بسعر',
].join('|'), 'i');

export function findPrice(text) {
  const s = String(text ?? '');
  const m = s.match(PRICE_RE);
  return m ? m[0] : null;
}

// Every dash EXCEPT the plain ASCII hyphen-minus. These are always forbidden.
const FANCY_DASH_RE = /[‐‑‒–—―−﹘﹣－]/;

export function findFancyDash(text) {
  const s = String(text ?? '');
  const m = s.match(FANCY_DASH_RE);
  return m ? m[0] : null;
}

// Plain ASCII hyphen. Forbidden in prose; only warned about in product names
// (so "USB-C" trips a warning, not a failure — decide per field which you call).
export function hasHyphen(text) {
  return String(text ?? '').includes('-');
}

// Arabic range, used to decide whether a value is Arabic copy (letter-spacing check).
export const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
