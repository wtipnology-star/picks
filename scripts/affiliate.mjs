// Single source of truth for "what is a noon link" and "what is an affiliate link".
// The add-script and the guardrail tests both import from here, so the rule lives
// in exactly one place.
//
// NOTE: until we have a real noon affiliate link to look at, "affiliate" is defined
// broadly as "carries a tracking parameter". The day Waleed pastes a real one, narrow
// AFFILIATE_PARAMS / AFFILIATE_HOSTS to match its exact shape and the tests still pass.

export const AFFILIATE_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
  'aff', 'aff_id', 'a_aid', 'affiliate', 'affid', 'tag', 'ref',
];

// Redirect / tracker hosts that are themselves affiliate links regardless of params.
export const AFFILIATE_HOSTS = ['c.noon.com', 'go.noon.com'];

function parse(url) {
  try { return new URL(String(url).trim()); } catch { return null; }
}

export function isNoonUrl(url) {
  const u = parse(url);
  if (!u) return false;
  const h = u.hostname.toLowerCase().replace(/^www\./, '');
  return h === 'noon.com' || h.endsWith('.noon.com');
}

// A noon product page: has /p/ in the path, or a product code segment like N70012345V.
export function isNoonProductUrl(url) {
  const u = parse(url);
  if (!u || !isNoonUrl(url)) return false;
  return /\/p\/?($|[/?#])/.test(u.pathname) || /\/N[0-9A-Z]{6,}\b/i.test(u.pathname);
}

export function isAffiliateUrl(url) {
  const u = parse(url);
  if (!u) return false;
  if (AFFILIATE_HOSTS.includes(u.hostname.toLowerCase())) return true;
  for (const p of AFFILIATE_PARAMS) {
    const v = u.searchParams.get(p);
    if (v !== null && v.trim() !== '') return true;
  }
  return false;
}
