/**
 * UA Simplified Pricing QA -- full website scraper
 *
 * Usage:
 *   node pricing_scrape_full.js '[{"name":"Akron, OH","wpSlug":"ohio-akron"},...]'
 *
 * Outputs one JSON line per location.
 */

const { chromium } = require('playwright');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitAndEval(page, selector, fn, timeout = 8000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return await page.evaluate(fn);
  } catch {
    return null;
  }
}

function extractPrice(text) {
  const m = (text || '').match(/\$[\d.]+/);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------------------
// Tickets page  /[wpSlug]/
// ---------------------------------------------------------------------------

async function scrapeTickets(page, name, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

  const result = await waitAndEval(page, '#tickets-pricing-grid', () => {
    const grid = document.getElementById('tickets-pricing-grid');
    const out = { packages: {}, features: {}, socks: null, attractions: [] };

    // Ticket packages (th columns): name + price from text content
    grid.querySelectorAll('th').forEach(th => {
      const text = th.textContent.replace(/\s+/g, ' ').trim();
      const priceMatch = text.match(/\$[\d.]+/);
      if (!priceMatch) return;
      const name = text.split('$')[0].trim().replace(/\s*(Buy|Book|Purchase)\s+\w.*$/i, '').trim();
      if (name) out.packages[name] = priceMatch[0];
    });

    // Shorty / Parent Pass: feature rows with a price in a td
    grid.querySelectorAll('tbody tr').forEach(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 2) return;
      const label = cells[0].textContent.trim();
      for (let i = 1; i < cells.length; i++) {
        const m = cells[i].textContent.trim().match(/\$[\d.]+/);
        if (m) { out.features[label] = m[0]; break; }
      }
    });

    // Ticket attractions: tbody rows where any td has aria-label="Included" (deduplicated)
    const seen = new Set();
    grid.querySelectorAll('tbody tr').forEach(row => {
      const hasCheck = Array.from(row.querySelectorAll('[aria-label="Included"]')).length > 0;
      if (!hasCheck) return;
      const label = row.querySelector('td')?.textContent?.trim();
      if (label && !seen.has(label)) { seen.add(label); out.attractions.push(label); }
    });

    // Socks: find a container whose p text includes "socks", get price from h4 sibling
    document.querySelectorAll('h4').forEach(h4 => {
      const parent = h4.parentElement;
      if (!parent) return;
      const parentText = parent.textContent.toLowerCase();
      if (parentText.includes('sock')) {
        const m = h4.textContent.match(/\$[\d.]+/);
        if (m) out.socks = m[0];
      }
    });

    // Adventure 4 All promo checks
    const bodyText = document.body.innerText;
    out.a4aSimplifiedFound = bodyText.includes('(4) Unlimited Play+ Tickets');
    out.a4aLegacyFound     = bodyText.includes('(4) Unlimited Play Tickets');

    return out;
  });

  return { location: name, ...(result || { error: 'tickets-pricing-grid not found' }) };
}

// ---------------------------------------------------------------------------
// Birthday page  /[wpSlug]/kids-birthday-parties
// ---------------------------------------------------------------------------

async function scrapeBirthday(page, name, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

  const result = await waitAndEval(page, '#party-pricing-table', () => {
    const table = document.getElementById('party-pricing-table');
    const out = {
      packages: {},
      venues: {},
      attractions: [],
      partyTimeFound: false,
      save100Found: false,
      promoDiscount: null,
      smallSquadHostFound: false,
    };

    // Party packages (th columns)
    table.querySelectorAll('th').forEach(th => {
      const text = th.textContent.replace(/\s+/g, ' ').trim();
      const priceMatch = text.match(/\$[\d.]+/);
      if (!priceMatch) return;
      const name = text.split('$')[0].trim().replace(/\s*(Buy|Book|Purchase)\s+\w.*$/i, '').trim();
      if (name) out.packages[name] = priceMatch[0];
    });

    // Birthday attractions: tbody rows with a checkmark (deduplicated)
    const seenAttr = new Set();
    table.querySelectorAll('tbody tr').forEach(row => {
      const hasCheck = Array.from(row.querySelectorAll('[aria-label="Included"]')).length > 0;
      if (!hasCheck) return;
      const label = row.querySelector('td')?.textContent?.trim();
      if (label && !seenAttr.has(label)) { seenAttr.add(label); out.attractions.push(label); }
    });

    // Venue add-ons: h3 elements whose parent contains "+ $price"
    document.querySelectorAll('h3').forEach(h3 => {
      const container = h3.parentElement;
      if (!container) return;
      const addOnMatch = container.textContent.match(/\+\s*\$([\d.]+)/);
      if (!addOnMatch) return;

      const venueName = h3.textContent.trim();
      const price = '$' + addOnMatch[1];

      // Amenities: look for ul/li or multiple p tags in the same container
      const amenities = [];
      container.querySelectorAll('li').forEach(li => amenities.push(li.textContent.trim()));
      if (amenities.length === 0) {
        const ps = Array.from(container.querySelectorAll('p'));
        ps.forEach(p => {
          const t = p.textContent.trim();
          if (t) amenities.push(t);
        });
      }
      // Strip leading checkmark characters from amenity strings
      const cleaned = amenities.map(a => a.replace(/^[✓✗\s]+/, '').trim()).filter(Boolean);

      out.venues[venueName] = { price, amenities: cleaned.length ? cleaned : null };
    });

    // Promo code checks (case-sensitive as per requirement)
    const bodyText = document.body.innerText;
    out.partyTimeFound = bodyText.includes('PARTY-TIME');
    out.save100Found   = bodyText.includes('SAVE-100');

    // 25% Off promo discount
    const discountMatch = bodyText.match(/(\d+%\s*Off)/i);
    if (discountMatch) out.promoDiscount = discountMatch[1];

    // Small Squad shared host check
    out.smallSquadHostFound = bodyText.toLowerCase().includes('shared party host');

    return out;
  });

  return { location: name, ...(result || { error: 'party-pricing-table not found' }) };
}

// ---------------------------------------------------------------------------
// Offers page  /[wpSlug]/offers/
// ---------------------------------------------------------------------------

async function scrapeOffers(page, name, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

  return await page.evaluate((locationName) => {
    const bodyText = document.body.innerText;

    // Small Squad promo price: "All for $price" wording
    const priceMatch = bodyText.match(/All for (?:just )?\$([\d.]+)/i);

    return {
      location: locationName,
      smallSquadPrice:     priceMatch ? '$' + priceMatch[1] : null,
      partyTimeFound:      bodyText.includes('PARTY-TIME'),
      save100Found:        bodyText.includes('SAVE-100'),
      smallSquadHostFound: bodyText.toLowerCase().includes('shared party host'),
      a4aSimplifiedFound:  bodyText.includes('(4) Unlimited Play+ Tickets'),
      a4aLegacyFound:      bodyText.includes('(4) Unlimited Play Tickets'),
    };
  }, name);
}

// ---------------------------------------------------------------------------
// Membership page  /[wpSlug]/membership/
// ---------------------------------------------------------------------------

async function scrapeMembership(page, name, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

  const result = await waitAndEval(page, '.pricing-table', () => {
    const out = {};

    // Tier columns: match by title text, extract price from text nodes only
    document.querySelectorAll('.pricing-table thead th .pricing-card').forEach(card => {
      const title = card.querySelector('.title')?.textContent?.trim();
      const priceEl = card.querySelector('.price');
      if (!title || !priceEl) return;

      const price = Array.from(priceEl.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .join('');

      const t = title.toLowerCase();
      if (t.includes('unlimited play') && title.includes('+')) {
        out.upPlusTitle = title; out.upPlusPrice = price;
      } else if (t.includes('unlimited play')) {
        out.upTitle = title; out.upPrice = price;
      } else if (t.includes('shorty')) {
        out.shortyTitle = title; out.shortyPrice = price;
      }
    });

    // Parent Pass add-on in #tickets section
    document.querySelectorAll('#tickets .membership_line_item').forEach(item => {
      const h3 = item.querySelector('h3')?.textContent?.trim() || '';
      const desc = item.querySelector('p')?.textContent?.trim() || '';
      // Match "$4.99 ..." or "4.99 ..." (dollar sign sometimes absent)
      const m = h3.match(/\$?(\d+\.\d+)/);
      if (m && desc.toLowerCase().includes('parent')) {
        out.parentTitle = desc; out.parentPrice = '$' + m[1];
      }
    });

    return out;
  });

  return { location: name, ...(result || { error: 'pricing-table not found' }) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node pricing_scrape_full.js \'[{"name":"...","wpSlug":"..."}]\'');
    process.exit(1);
  }

  let locations;
  try {
    locations = JSON.parse(arg);
  } catch {
    console.error('Invalid JSON argument'); process.exit(1);
  }

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' });

  for (const loc of locations) {
    const base = `https://www.urbanair.com/${loc.wpSlug}`;
    const [tickets, birthday, offers, membership] = [
      await scrapeTickets(  page, loc.name, `${base}/`),
      await scrapeBirthday( page, loc.name, `${base}/kids-birthday-parties`),
      await scrapeOffers(   page, loc.name, `${base}/offers/`),
      await scrapeMembership(page, loc.name, `${base}/membership/`),
    ];
    console.log(JSON.stringify({ location: loc.name, wpSlug: loc.wpSlug, tickets, birthday, offers, membership }));
  }

  await browser.close();
})().catch(err => { console.error(err.message); process.exit(1); });
