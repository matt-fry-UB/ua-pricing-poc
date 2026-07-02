// Shared helpers for all location API endpoints

const API      = 'https://unleashedapi.urbanairparks.com';
const BRAND_ID = 1;

const STATE_NAMES = {
  AL:'alabama', AK:'alaska', AZ:'arizona', AR:'arkansas', CA:'california',
  CO:'colorado', CT:'connecticut', DE:'delaware', FL:'florida', GA:'georgia',
  HI:'hawaii', ID:'idaho', IL:'illinois', IN:'indiana', IA:'iowa',
  KS:'kansas', KY:'kentucky', LA:'louisiana', ME:'maine', MD:'maryland',
  MA:'massachusetts', MI:'michigan', MN:'minnesota', MS:'mississippi', MO:'missouri',
  MT:'montana', NE:'nebraska', NV:'nevada', NH:'new-hampshire', NJ:'new-jersey',
  NM:'new-mexico', NY:'new-york', NC:'north-carolina', ND:'north-dakota', OH:'ohio',
  OK:'oklahoma', OR:'oregon', PA:'pennsylvania', RI:'rhode-island', SC:'south-carolina',
  SD:'south-dakota', TN:'tennessee', TX:'texas', UT:'utah', VT:'vermont',
  VA:'virginia', WA:'washington', WV:'west-virginia', WI:'wisconsin', WY:'wyoming',
  DC:'washington-dc',
};

function buildLocationSlug(parkName) {
  const [city = '', stateAbbr = ''] = parkName.split(',').map(s => s.trim());
  const stateName = STATE_NAMES[stateAbbr.toUpperCase()] || stateAbbr.toLowerCase().replace(/\s+/g, '-');
  const citySlug  = city.toLowerCase().replace(/\s+/g, '-');
  return stateName && citySlug ? `${stateName}-${citySlug}` : '';
}

async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const json = await res.json();
  return json.data || [];
}

async function loadParks() {
  return apiFetch(`${API}/brands/${BRAND_ID}/parks`);
}

async function findLimitId(parkId) {
  const makeDate = i => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  };
  const controllers = Array.from({ length: 7 }, () => new AbortController());
  try {
    return await Promise.any(
      Array.from({ length: 7 }, (_, i) => {
        const ds = makeDate(i);
        return fetch(
          `${API}/brands/${BRAND_ID}/parks/${parkId}/products/calendar?date=${ds}`,
          { signal: controllers[i].signal }
        )
          .then(r => r.json())
          .then(j => {
            const slots = j.data || [];
            if (!slots.length) throw new Error('empty');
            controllers.forEach((c, idx) => { if (idx !== i) c.abort(); });
            return { limitId: slots[0].parkAttendanceLimitId, date: ds };
          });
      })
    );
  } catch {
    return { limitId: null, date: null };
  }
}

const HIDE_PRODUCT = name =>
  /adventure\s*4\s*all|adventure\s*for\s*all|bring.a.friend.friday/i.test(name);

const IS_SECONDARY = name =>
  /\b(parent|shorty)\b|short\s*y?\s*40|\b5\s*(?:&amp;|&|and)?\s*under\b/i.test(name);

// Allowlist of primary ticket names. Anything else that isn't secondary is
// treated as a promo ticket (e.g. "America's 250th Celebration") and kept
// out of the primary tickets list. "unlimited play" covers both
// "Unlimited Play" and "Unlimited Play +".
const IS_PRIMARY = name =>
  /unlimited play|\b(deluxe|ultimate|platinum)\b/i.test(name);

const IS_GOKARTS = p =>
  /go.?kart|unlimited play\s*\+/i.test(p.parkProductName) ||
  (p.attractions || []).some(a => /go.?kart/i.test(a.name));

function detectPricingModel(primaryTickets) {
  if (primaryTickets.some(t => /\b(deluxe|ultimate|platinum)\b/i.test(t.parkProductName))) return 'legacy';
  return 'simplified';
}

function stripSuffix(name) {
  return name
    .replace(/\s+ticket$/i, '')
    .replace(/\s+membership$/i, '')
    .replace(/\s+pass$/i, '')
    .trim();
}

function makeCityStripper(parkName) {
  const city = parkName.split(',')[0].trim();
  const esc  = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rPre = new RegExp('^' + esc + '\\s+', 'i');
  const rSuf = new RegExp('\\s*[-–]\\s*' + esc + '\\s*$', 'i');
  return name => (name || '').replace(rPre, '').replace(rSuf, '').trim();
}

function formatProduct(p) {
  return {
    id:            p.id,
    name:          p.parkProductName,
    price:         p.price ?? null,
    productTypeId: p.productTypeId,
    description:   (p.parkProductDescription || '').trim() || null,
    ticketUrl:     p.ticketUrl || null,
  };
}

module.exports = {
  API,
  BRAND_ID,
  buildLocationSlug,
  apiFetch,
  loadParks,
  findLimitId,
  HIDE_PRODUCT,
  IS_SECONDARY,
  IS_PRIMARY,
  IS_GOKARTS,
  detectPricingModel,
  stripSuffix,
  makeCityStripper,
  formatProduct,
};
