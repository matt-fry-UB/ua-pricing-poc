// GET /api/locations
// Returns all Urban Air locations with their slugs and basic info.

const { loadParks, buildLocationSlug } = require('./_shared');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  try {
    const parks = await loadParks();
    parks.sort((a, b) => {
      const [cityA, stateA = ''] = a.name.split(',').map(s => s.trim());
      const [cityB, stateB = ''] = b.name.split(',').map(s => s.trim());
      return stateA.localeCompare(stateB) || cityA.localeCompare(cityB);
    });

    const locations = parks.map(p => {
      const [city = '', statePart = ''] = p.name.split(',').map(s => s.trim());
      const slug = buildLocationSlug(p.name);
      return {
        slug,
        parkId: p.id,
        name:   p.name,
        city,
        state:  statePart,
        url:    slug ? `https://ua-pricing-poc.vercel.app/${slug}` : null,
        apiUrl: slug ? `https://ua-pricing-poc.vercel.app/api/location/${slug}` : null,
      };
    }).filter(l => l.slug);

    return res.status(200).json({ count: locations.length, locations });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
