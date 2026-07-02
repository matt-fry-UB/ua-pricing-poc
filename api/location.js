// GET /api/location?slug=indiana-noblesville
// Returns all available pricing and attraction data for a single Urban Air location.

const {
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
} = require('./_shared');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: 'Missing slug parameter. Usage: /api/location?slug=indiana-noblesville' });

  try {
    // Resolve slug → park
    const parks = await loadParks();
    const park  = parks.find(p => buildLocationSlug(p.name) === slug);
    if (!park) {
      const available = parks
        .map(p => buildLocationSlug(p.name))
        .filter(Boolean)
        .sort();
      return res.status(404).json({ error: 'Location not found', slug, availableSlugs: available });
    }

    const parkId = park.id;
    const clean  = makeCityStripper(park.name);

    // Fetch calendar, products, and WP attractions in parallel
    const dt7    = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();
    const dt7ISO = dt7 + 'T12:00:00';

    const [limitIdResult, merch, memberships, annualPasses, wpAttractions, birthdayPackages, birthdayHangoutsRaw] =
      await Promise.all([
        findLimitId(parkId),
        apiFetch(`${API}/brands/${BRAND_ID}/parks/${parkId}/products?productTypeIds=3`),
        apiFetch(`${API}/brands/${BRAND_ID}/parks/${parkId}/products?productTypeIds=1`),
        apiFetch(`${API}/brands/${BRAND_ID}/parks/${parkId}/products?productTypeIds=7`),
        fetch('https://www.urbanair.com/wp-json/urban_air/attractions/?per_page=100')
          .then(r => r.json()).catch(() => []),
        apiFetch(`${API}/bookings/packages?parkId=${parkId}&preferredDate=${dt7}&requiresHandicap=false`).catch(() => []),
        apiFetch(`${API}/bookings/hangouts/hangouts-minimum?parkId=${parkId}&productLevelId=4&selectedDate=${dt7ISO}&requiresHandicap=false`).catch(() => []),
      ]);

    // Tickets require the limitId from the calendar race
    const { limitId, date } = limitIdResult;
    const allTickets = limitId
      ? await apiFetch(`${API}/brands/${BRAND_ID}/parks/${parkId}/products?productTypeIds=2&date=${date}&parkAttendanceLimitId=${limitId}`)
      : [];

    // Strip city name prefix/suffix and trailing "Ticket/Membership/Pass"
    const cleanStrip = arr => arr.map(p => ({
      ...p,
      parkProductName: stripSuffix(clean(p.parkProductName)),
    }));

    const tickets     = cleanStrip(allTickets).filter(p => !HIDE_PRODUCT(p.parkProductName));
    const cleanMerch  = cleanStrip(merch).filter(p => !HIDE_PRODUCT(p.parkProductName));
    const cleanMem    = cleanStrip(memberships).filter(p => !HIDE_PRODUCT(p.parkProductName));
    const cleanAnnual = cleanStrip(annualPasses).filter(p => !HIDE_PRODUCT(p.parkProductName));

    // Classify tickets
    const primaryTickets   = tickets.filter(t => IS_PRIMARY(t.parkProductName) && !IS_SECONDARY(t.parkProductName));
    const secondaryTickets = tickets.filter(t => IS_SECONDARY(t.parkProductName));
    const promoTickets     = tickets.filter(t => !IS_PRIMARY(t.parkProductName) && !IS_SECONDARY(t.parkProductName));
    const goKartsTicket    = primaryTickets.find(IS_GOKARTS) || null;
    const pricingModel     = detectPricingModel(primaryTickets);

    // Deduplicate birthday hangouts by resourceTypeId
    const hangouts = Object.values(
      birthdayHangoutsRaw.reduce((acc, h) => {
        if (!acc[h.resourceTypeId]) acc[h.resourceTypeId] = h;
        return acc;
      }, {})
    );

    // Format WP attractions
    const attractions = (Array.isArray(wpAttractions) ? wpAttractions : []).map(wa => ({
      title:   wa.title?.rendered || wa.title || '',
      excerpt: wa.excerpt?.rendered || wa.excerpt || '',
      image:   wa.featured_image || null,
      slug:    wa.slug || null,
      link:    wa.link || null,
    }));

    const [city = '', statePart = ''] = park.name.split(',').map(s => s.trim());
    const locationSlug = buildLocationSlug(park.name);

    const response = {
      slug: locationSlug,
      park: {
        id:        parkId,
        name:      park.name,
        city,
        state:     statePart,
        urlSlug:   park.urlSlug || null,
        CCurlSlug: park.urlSlug || null,
      },
      links: {
        tickets:    `https://ua-pricing-poc.vercel.app/${locationSlug}`,
        birthday:   `https://ua-pricing-poc.vercel.app/${locationSlug}/birthday`,
        membership: `https://ua-pricing-poc.vercel.app/${locationSlug}/membership`,
        urbanAir:   `https://www.urbanair.com/${park.urlSlug || ''}`,
      },
      pricing: {
        model:            pricingModel,
        pricingDate:      date || null,
        tickets:          primaryTickets.map(formatProduct),
        secondaryTickets: secondaryTickets.map(formatProduct),
        promoTickets:     promoTickets.map(formatProduct),
        goKartsIncluded:  !!goKartsTicket,
        memberships:      cleanMem.map(formatProduct),
        annualPasses:     cleanAnnual.map(formatProduct),
        merch:            cleanMerch.map(formatProduct),
      },
      birthday: {
        packages: birthdayPackages,
        hangouts,
      },
      attractions,
      meta: {
        generatedAt: new Date().toISOString(),
        limitId:     limitId || null,
      },
    };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(response);

  } catch (err) {
    console.error('API error for slug:', slug, err);
    return res.status(500).json({ error: err.message });
  }
};
