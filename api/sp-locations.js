// GET /api/sp-locations
// Returns names of Urban Air locations currently on simplified pricing,
// using the same detectPricingModel logic as /api/location (ticket-based).
// Cached for 1 hour; the parallel upstream calls only happen on cache miss.
//
// Parks are processed in batches to avoid flooding the upstream API with
// hundreds of concurrent calendar requests (findLimitId makes 7 fetches per
// park). Unbatched, ~700 simultaneous requests trigger rate limiting and
// cause findLimitId to return null for many parks, producing false negatives.

const {
  API,
  BRAND_ID,
  loadParks,
  findLimitId,
  detectPricingModel,
  IS_SECONDARY,
  IS_PRIMARY,
  HIDE_PRODUCT,
} = require('./_shared');

const BATCH_SIZE = 15;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  try {
    const parks = await loadParks();

    const results = [];
    for (let i = 0; i < parks.length; i += BATCH_SIZE) {
      const batch = parks.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(async park => {
          const { limitId, date } = await findLimitId(park.id);
          if (!limitId) return null;

          const json = await fetch(
            `${API}/brands/${BRAND_ID}/parks/${park.id}/products` +
            `?productTypeIds=2&date=${date}&parkAttendanceLimitId=${limitId}`
          ).then(r => r.json());

          const allTickets    = json.data || [];
          const primaryTickets = allTickets.filter(
            t => IS_PRIMARY(t.parkProductName) &&
                 !IS_SECONDARY(t.parkProductName) &&
                 !HIDE_PRODUCT(t.parkProductName)
          );
          const model = detectPricingModel(primaryTickets);
          return model === 'simplified' ? park.name : null;
        })
      );
      results.push(...batchResults);
    }

    const names = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .sort((a, b) => {
        const cA = a.split(',')[0].trim();
        const cB = b.split(',')[0].trim();
        return cA.localeCompare(cB);
      });

    return res.status(200).json({ count: names.length, names });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
