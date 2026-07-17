// The single source of truth for which stores the picks page supports and what
// counts as a real affiliate (tracked) link for each. The add-script and the
// guardrail tests both import from here.
//
// TO ADD A NEW AFFILIATE PROGRAM later: add one object to MERCHANTS below with
//   - id / label
//   - match(u):      is this URL one of this store's links?
//   - isAffiliate(u): does it carry this store's tracking so you actually earn?
//   - hint:          what to tell the user when they paste a bare (untracked) link
// Nothing else in the codebase needs to change.
//
// NOTE: both rules below are best-guess until Waleed has real accounts. When he
// joins noon / Amazon Associates and pastes one real tracked link, tighten the
// matching isAffiliate() to that exact shape. The tests still pass.

const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
  'aff', 'aff_id', 'a_aid', 'affiliate', 'affid', 'ref',
];

function parse(url) { try { return new URL(String(url).trim()); } catch { return null; } }
function host(u) { return u.hostname.toLowerCase().replace(/^www\./, ''); }
function hasParam(u, names) {
  for (const p of names) { const v = u.searchParams.get(p); if (v !== null && v.trim() !== '') return true; }
  return false;
}

export const MERCHANTS = [
  {
    id: 'noon',
    label: 'noon',
    match: (u) => { const h = host(u); return h === 'noon.com' || h.endsWith('.noon.com'); },
    // A tracker host, or any tracking parameter. (Placeholder until a real noon link.)
    isAffiliate: (u) => ['c.noon.com', 'go.noon.com'].includes(host(u)) || hasParam(u, [...TRACKING_PARAMS, 'tag']),
    hint: 'Open it from your noon affiliate dashboard and copy the tracked link.',
  },
  {
    id: 'amazon',
    label: 'Amazon',
    // amazon.<tld>, the amzn.to short-link domain, and the a.co share domain.
    match: (u) => { const h = host(u); return h === 'amzn.to' || h === 'a.co' || /(^|\.)amazon\.[a-z.]+$/.test(h); },
    // Associates links carry a ?tag= associate id. amzn.to short links come from
    // SiteStripe and bake the tag in. a.co is the plain "share" shortener with NO
    // tag, so it does not count.
    isAffiliate: (u) => host(u) === 'amzn.to' || hasParam(u, ['tag']),
    hint: 'Use your Amazon Associates link: the amzn.to short link from SiteStripe, or a product URL with your ?tag=. The a.co share link earns nothing.',
  },
];

export function merchantOf(url) { const u = parse(url); if (!u) return null; return MERCHANTS.find((m) => m.match(u)) || null; }
export function isKnownMerchantUrl(url) { return merchantOf(url) !== null; }

export function isAffiliateUrl(url) {
  const u = parse(url);
  if (!u) return false;
  const m = MERCHANTS.find((x) => x.match(u));
  return m ? m.isAffiliate(u) : false;
}

export function supportedStores() { return MERCHANTS.map((m) => m.label).join(', '); }
