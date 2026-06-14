// GET /api/sp-locations
// Returns names of Urban Air locations currently on simplified pricing,
// determined by checking each park's membership products against the upstream API.
// Simplified = has memberships but none named Deluxe/Ultimate/Platinum.
// Cached for 1 hour; only the first cold call per hour hits the upstream API.

const { API, BRAND_ID, loadParks } = require('./_shared');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  try {
    const parks = await loadParks();

    const results = await Promise.allSettled(
      parks.map(async park => {
        const resp = await fetch(
          `${API}/brands/${BRAND_ID}/parks/${park.id}/products?productTypeIds=1`
        );
        if (!resp.ok) return null;
        const json = await resp.json();
        const memberships = json.data || [];
        // Legacy locations have Deluxe/Ultimate/Platinum memberships
        const isLegacy = memberships.some(m =>
          /\b(deluxe|ultimate|platinum)\b/i.test(m.parkProductName)
        );
        // Require at least one membership to confirm the park is active/configured
        return memberships.length > 0 && !isLegacy ? park.name : null;
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
