// GET /api/sp-locations
// Returns names of Urban Air locations currently on simplified pricing,
// using the same detectPricingModel logic as /api/location (ticket-based).
// Cached for 1 hour; the parallel upstream calls only happen on cache miss.

const {
  API,
  BRAND_ID,
  loadParks,
  findLimitId,
  detectPricingModel,
  IS_SECONDARY,
  HIDE_PRODUCT,
} = require('./_shared');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  try {
    const parks = await loadParks();

    const results = await Promise.allSettled(
      parks.map(async park => {
        const { limitId, date } = await findLimitId(park.id);
        if (!limitId) return null;

        const json = await fetch(
          `${API}/brands/${BRAND_ID}/parks/${park.id}/products` +
          `?productTypeIds=2&date=${date}&parkAttendanceLimitId=${limitId}`
        ).then(r => r.json());

        const allTickets    = json.data || [];
        const primaryTickets = allTickets.filter(
          t => !IS_SECONDARY(t.parkProductName) && !HIDE_PRODUCT(t.parkProductName)
        );
        const model = detectPricingModel(primaryTickets);
        return model === 'simplified' ? park.name : null;
      })
    );

    const names = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .sort((a, b) => {
        const [cA, stA = ''] = a.split(',').map(s => s.trim());
        const [cB, stB = ''] = b.split(',').map(s => s.trim());
        return stA.localeCompare(stB) || cA.localeCompare(cB);
      });

    return res.status(200).json({ count: names.length, names });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
