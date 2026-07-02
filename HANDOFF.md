# Urban Air Pricing Explorer — Complete Rebuild Handoff

## Contents
1. [What This App Is](#1-what-this-app-is)
2. [Framework-Agnostic Functional Specification](#2-framework-agnostic-functional-specification)
   - [User Flow](#21-user-flow)
   - [Application State](#22-application-state)
   - [URL Routing](#23-url-routing)
   - [Data & API Specification](#24-data--api-specification)
   - [Data Loading & Caching](#25-data-loading--caching)
   - [All Business Logic Functions](#26-all-business-logic-functions)
   - [Pricing Model Detection](#27-pricing-model-detection)
   - [Rendering Logic — Tickets Tab](#28-rendering-logic--tickets-tab)
   - [Rendering Logic — Birthdays Tab](#29-rendering-logic--birthdays-tab)
   - [Rendering Logic — Memberships Tab](#210-rendering-logic--memberships-tab)
3. [Complete Visual & Design Specification](#3-complete-visual--design-specification)
   - [Design Tokens](#31-design-tokens)
   - [Application Shell](#32-application-shell)
   - [Tickets Tab — Simplified Pricing Section](#33-tickets-tab--simplified-pricing-section)
   - [Tickets Tab — Attractions Gallery](#34-tickets-tab--attractions-gallery)
   - [Birthdays Tab](#35-birthdays-tab)
   - [Memberships Tab](#36-memberships-tab)
   - [Shared Components](#37-shared-components)
   - [Responsive Breakpoints](#38-responsive-breakpoints)
   - [Animations & Transitions](#39-animations--transitions)
4. [Next.js Rebuild Guide](#4-nextjs-rebuild-guide)
5. [Exact Code Files Included](#5-exact-code-files-included)

---

## 1. What This App Is

An interactive pricing explorer for **Urban Air Adventure Parks** — a nationwide chain of indoor trampoline and adventure parks. The app is a single-page tool that lets users select any Urban Air location from a dropdown, then see that location's live pricing for tickets, birthday party packages, and memberships.

**Primary purpose:** Replace the existing static `#tickets-pricing-grid` section on Urban Air WordPress location pages with a dynamic, API-driven pricing display.

**Current implementation:** One self-contained HTML file (~1,700 lines) with embedded CSS and JavaScript. No build step, no framework. Deployed to Vercel with SPA routing.

**Three tabs of content:**
- **Tickets & Bundles** — The core pricing display. Live ticket prices in either "Simplified" (1–2 tickets) or "Legacy" (3-tier) format, plus a membership panel and add-on pricing.
- **Birthday Parties** — Birthday party packages by tier, attraction matrix, common amenities, and hangout room options.
- **Memberships & Passes** — Monthly membership cards, annual pass cards, and a full attraction list.

---

## 2. Framework-Agnostic Functional Specification

### 2.1 User Flow

```
App loads
  │
  ├─► Fetch all park locations from API
  │     Sort alphabetically: by state first, then city within state
  │     Populate dropdown: "ST - City" display format
  │
  ├─► Parse URL path for pre-selected location and section
  │     If match found: auto-select + auto-load
  │     Else: check sessionStorage for last-visited park
  │           If found: auto-select + auto-load
  │           Else: show empty state "Select a Location"
  │
User selects a location
  │
  ├─► Store selection to sessionStorage
  ├─► Build URL slug from park name (see §2.6)
  ├─► Push new URL to browser history (/{locationSlug})
  ├─► Immediately begin calendar scan (parallel, non-blocking)
  ├─► Show content area, hide empty state
  ├─► Load & render the active tab (default: "tickets")
  └─► After active tab loads: pre-fetch other tabs in background

User switches tabs
  ├─► If data cached: render immediately
  └─► Else: show loading spinner, fetch, render
```

### 2.2 Application State

All mutable state lives in module-level variables:

| Variable | Type | Purpose |
|---|---|---|
| `currentParkId` | number \| null | Unleashed API park ID |
| `currentParkName` | string | "City, ST" format from API |
| `currentUrlSlug` | string | park.urlSlug from API (used in purchase URLs) |
| `currentLocationSlug` | string | Computed slug for UA website URLs (e.g., `ohio-westlake`) |
| `activeTab` | `'tickets'` \| `'birthdays'` \| `'memberships'` | Currently displayed tab |
| `_bootTab` | string \| null | Tab to open on initial load from URL (cleared after first use) |
| `CACHE` | `{ [parkId]: { tickets?, birthdays?, memberships_tab?, attractions?, _limitIdProm?, _attrProm? } }` | In-memory cache keyed by park ID |
| `_wpAttrProm` | Promise \| null | Singleton promise for WP attractions fetch (fetched once per session, shared across all parks) |

### 2.3 URL Routing

**URL structure:** `/{locationSlug}` or `/{locationSlug}/{section}`

**Location slug format:** `{full-state-name}-{city-slug}` — e.g., `ohio-westlake`, `texas-southlake`, `north-carolina-concord`

**Section mapping (URL → tab name):**
```
birthday    → birthdays
birthdays   → birthdays
membership  → memberships
memberships → memberships
(anything else) → tickets
```

**On load:**
1. Parse `window.location.pathname`, split on `/`, take `pathParts[0]` as location slug and `pathParts[1]` as section.
2. Iterate all park options; for each, call `buildLocationSlug(parkName)` and compare to URL slug.
3. If match: set `_bootTab` to mapped tab name, trigger change event on select.
4. If no URL match: check `sessionStorage.getItem('ua_park')` (stored as JSON string `{id, name, urlSlug}`). If found, match by `id` and trigger change.

**On park selection:**
- Call `history.pushState({ parkId }, '', '/' + locationSlug + sectionSuffix)`.
- `sectionSuffix` is `/birthday` (for birthdays tab) or `/membership` (for memberships tab) only when `_bootTab` is set, otherwise empty.

### 2.4 Data & API Specification

**Base URL:** `https://unleashedapi.urbanairparks.com`
**Brand ID:** `1` (constant, hardcoded)
**All endpoints return:** `{ data: [...] }` — the app always uses `.data` from the response body.
**Error handling:** Non-2xx responses throw `Error('HTTP {status}')`. The app catches at the tab-render level and shows an error box.

---

#### Endpoint 1 — List All Parks
```
GET /brands/1/parks
```
Returns array of park objects. Used fields:
- `id` — numeric park ID
- `name` — "City, ST" format string
- `urlSlug` — string used in purchase URLs (e.g., `"westlake-oh"`)

---

#### Endpoint 2 — Membership Products
```
GET /brands/1/parks/{parkId}/products?productTypeIds=1
```
Returns memberships. Used fields per product:
- `parkProductName` — display name (before cleaning)
- `price` — number (dollars, float)
- `productLevelName` — tier/level label
- `productLevelId` — numeric tier ID
- `imageUri` — product image URL (may be null)
- `billingInterval` — billing period string (e.g., `"mo"`)
- `contractDuration` — contract length in months (may be null)
- `description` — product description text (may be null)
- `color` — hex color for card accent (may be null; default `#B45309`)
- `attractions` — array of attraction objects (see below)

---

#### Endpoint 3 — Ticket Products (date-scoped)
```
GET /brands/1/parks/{parkId}/products?productTypeIds=2&date={YYYY-MM-DD}&parkAttendanceLimitId={limitId}
```
Requires a valid `date` and `parkAttendanceLimitId` from the calendar scan (§2.5). If no date is available, this endpoint is skipped and the tickets array will be empty. Used fields per product — same shape as memberships, plus:
- `urlSlug` — not used per-ticket; the park-level urlSlug is used for purchase URLs instead.

---

#### Endpoint 4 — Merchandise Products
```
GET /brands/1/parks/{parkId}/products?productTypeIds=3
```
Returns socks, add-ons, etc. Same product shape. Not date-scoped. This always loads even if tickets fail.

---

#### Endpoint 5 — Annual Pass Products
```
GET /brands/1/parks/{parkId}/products?productTypeIds=7
```
Returns annual/prepaid passes. Same product shape.

---

#### Endpoint 6 — Calendar (daily attendance slots)
```
GET /brands/1/parks/{parkId}/products/calendar?date={YYYY-MM-DD}
```
Returns array of attendance slot objects. Used fields:
- `parkAttendanceLimitId` — the ID needed to scope ticket prices to a date

---

#### Endpoint 7 — Birthday Packages
```
GET /bookings/packages?parkId={parkId}&preferredDate={YYYY-MM-DD}&requiresHandicap=false
```
`preferredDate` = today + 7 days (ISO date string, no time). Returns array of package objects. Used fields:
- `productLevelName` — tier name (e.g., "Gold", "Bronze")
- `productLevelId` — numeric tier ID
- `productLevelColor` — hex color for tier header
- `productLevelDescription` — description of what's included
- `minCombinedPrice` — starting price (float)
- `quantity` — minimum number of guests
- `attractions` — array of attraction objects (includes `minimumProductLevelId`)

---

#### Endpoint 8 — Birthday Hangouts
```
GET /bookings/hangouts/hangouts-minimum?parkId={parkId}&productLevelId=4&selectedDate={YYYY-MM-DDT12:00:00}&requiresHandicap=false
```
`selectedDate` = today + 7 days, appended with `T12:00:00`. Returns array of hangout/room objects. Used fields:
- `name` — room name
- `price` — number (0 = included, >0 = add-on cost)
- `amenities` — array of strings
- `resourceTypeId` — used for deduplication (keep only first occurrence per resourceTypeId)

---

#### Endpoint 9 — WordPress Attractions
```
GET https://www.urbanair.com/wp-json/urban_air/attractions/
```
External WordPress REST API. Returns array of WP post objects OR `{ data: [] }`. Used fields:
- `title` — string OR `{ rendered: string }` (both forms must be handled)
- `featured_image` — image URL (primary)
- `acf.image.url` — image URL (fallback 1)
- `featured_image_url` — image URL (fallback 2)
- `excerpt` — short description, may contain HTML tags (strip them)
- `description` — alternate description (no HTML)
- `acf.description` — alternate description (no HTML)
- `slug` — URL slug for linking to `urbanair.com/{locationSlug}/{slug}`

**Important:** This endpoint is called once per session and the Promise is cached globally (not per park). It fires as part of the first `loadTickets()` call.

---

#### Attraction Object Shape (embedded in products)
```
{
  name: string,
  heightRequirement: number | null,  // inches, e.g. 42
  minimumProductLevelId: number | null  // used in birthday matrix
}
```

---

### 2.5 Data Loading & Caching

All fetched data is cached in a global `CACHE` object keyed by `parkId`. Checks always happen before fetching.

**Tickets load sequence:**
1. If `CACHE[parkId].tickets` exists → return it immediately.
2. Otherwise, call `findLimitId()` (or reuse `CACHE[parkId]._limitIdProm` if already running).
3. Then run 4 fetches in parallel:
   - Ticket products (using limitId + date; empty array `[]` if limitId is null)
   - Merchandise products
   - Membership products
   - WP attractions (global singleton, fires once per session)
4. Clean/strip names from all results.
5. Extract and cache `attractions` on the park cache.
6. Return `{ tickets, merch, memberships, attractions, wpAttractions }`.

**Calendar scan (`findLimitId`):**
1. Generate ISO date strings for today through today+6 (7 days).
2. Create one `AbortController` per day.
3. Race all 7 fetches with `Promise.any()`.
4. First fetch that returns a non-empty slots array wins; cancel all others.
5. Return `{ limitId: slots[0].parkAttendanceLimitId, date }`.
6. If all fail or return empty: return `{ limitId: null, date: null }`.

**Birthday load sequence:**
1. If `CACHE[parkId].birthdays` exists → return it.
2. Build `dt7` = today+7 days (YYYY-MM-DD).
3. Build `dt7ISO` = `dt7 + 'T12:00:00'`.
4. Fetch packages and hangouts in parallel.
5. Deduplicate hangouts: for each `resourceTypeId`, keep only the first occurrence.
6. Return `{ packages, hangouts }` and cache it.

**Memberships load sequence:**
1. If `CACHE[parkId].memberships_tab` exists → return it.
2. Fetch membership products and annual pass products in parallel.
3. If `CACHE[parkId].attractions` not yet set, compute it from memberships.
4. Return `{ memberships, annualPasses, attractions }` and cache it.

**After active tab loads:**
- Silently pre-fetch the other two tabs in background (errors ignored).
- This means by the time users switch tabs, data is usually already cached.

---

### 2.6 All Business Logic Functions

#### `buildLocationSlug(parkName)`
Converts `"City, ST"` to `"full-state-name-city"` URL slug.

```
Input:  "Westlake, OH"
Output: "ohio-westlake"

Input:  "Spanish Fort, AL"
Output: "alabama-spanish-fort"

Input:  "Washington, DC"
Output: "washington-dc-washington"
```

Algorithm:
1. Split on comma: `city = "Westlake"`, `stateAbbr = "OH"`.
2. Look up `STATE_NAMES[stateAbbr.toUpperCase()]` for full state name (hyphenated). If not found, lowercase + hyphenate the abbreviation.
3. `citySlug = city.toLowerCase().replace(/\s+/g, '-')`.
4. Return `"{stateName}-{citySlug}"`. If either part is empty, return `""`.

**Full STATE_NAMES map:**
```
AL→alabama, AK→alaska, AZ→arizona, AR→arkansas, CA→california,
CO→colorado, CT→connecticut, DE→delaware, FL→florida, GA→georgia,
HI→hawaii, ID→idaho, IL→illinois, IN→indiana, IA→iowa,
KS→kansas, KY→kentucky, LA→louisiana, ME→maine, MD→maryland,
MA→massachusetts, MI→michigan, MN→minnesota, MS→mississippi, MO→missouri,
MT→montana, NE→nebraska, NV→nevada, NH→new-hampshire, NJ→new-jersey,
NM→new-mexico, NY→new-york, NC→north-carolina, ND→north-dakota, OH→ohio,
OK→oklahoma, OR→oregon, PA→pennsylvania, RI→rhode-island, SC→south-carolina,
SD→south-dakota, TN→tennessee, TX→texas, UT→utah, VT→vermont,
VA→virginia, WA→washington, WV→west-virginia, WI→wisconsin, WY→wyoming,
DC→washington-dc
```

---

#### `makeCleaner(parkName)`
Returns a function that strips the city name from product names.

- Strips leading `"CityName "` prefix from product name (case-insensitive).
- Strips trailing `" - CityName"` or `" – CityName"` suffix (with optional spaces around dash).
- The regex uses the city portion only (before the comma in "City, ST").

Example: Park = `"Westlake, OH"`. `clean("Westlake Unlimited Play") → "Unlimited Play"`.

---

#### `stripSuffixes(products)`
Removes common suffixes from product names:
- Strip trailing `" Ticket"` (case-insensitive)
- Strip trailing `" Membership"` (case-insensitive)
- Strip trailing `" Pass"` (case-insensitive)
- Trim whitespace after stripping

Applied to tickets, memberships, and annual passes before any other processing.

---

#### `hideProduct(name)`
Returns `true` for products that should be completely hidden. Filter applied to tickets, merch, and memberships.

Hidden if name matches: `/adventure\s*4\s*all|adventure\s*for\s*all|bring.a.friend.friday/i`

---

#### `isSecondaryTicket(name)`
Returns `true` for tickets that are add-ons, not main tickets. These are filtered out of the primary ticket list.

Pattern: `/\b(parent|shorty)\b|short\s*y?\s*40|\b5\s*(?:&amp;|&|and\b)?\s*under\b/i`

Matches: "Parent Ticket", "Shorty", "Shorty 40", "5 & Under", "5 and Under", "5&Under" — plus the misspellings "Short 40" and "Shorty40" that exist in CC data at some parks.

---

#### `isPrimaryTicket(name)` / `IS_PRIMARY(name)`
Allowlist of main ticket names. Only tickets matching this pattern are treated as primary; anything that is neither primary nor secondary is a **promo ticket** (e.g. "America's 250th Celebration", "Camp Urbie", "Double Play BOGO") and is not rendered as a ticket cell. The API returns promo tickets in a separate `pricing.promoTickets` field.

Pattern: `/unlimited play|\b(deluxe|ultimate|platinum)\b/i`

Matches: "Unlimited Play", "Unlimited Play +", "Deluxe", "Ultimate", "Platinum"

---

#### `isGoKartsTicket(ticket)`
Returns `true` if a ticket grants go-kart access.

True if:
- Product name matches `/go.?kart|unlimited play\s*\+/i`, OR
- Any of the ticket's `attractions` has a name matching `/go.?kart/i`

---

#### `fmtPrice(price)`
Formats a dollar amount with superscript cents.

```
Input:  29.99
Output: "$29<span class="sp-cents">99</span>"

Input:  30.00
Output: "$30"  (no cents span if cents === 0)
```

Algorithm:
1. `dollars = Math.floor(price)`
2. `cents = Math.round((price - dollars) * 100)`
3. If `cents === 0`: return `"$" + dollars`
4. Else: return `"$" + dollars + '<span class="sp-cents">' + String(cents).padStart(2, '0') + "</span>"`

The `.sp-cents` class applies `font-size: 0.42em; vertical-align: super; letter-spacing: 0; line-height: 1`.

---

#### `parentPriceCalc(basePrice)`
Calculates parent/secondary ticket price as exactly 50% of base price, truncated (never rounded up).

```javascript
Math.floor(basePrice / 2 * 100) / 100
```

Example: basePrice = `$29.99` → `Math.floor(14.995 * 100) / 100` = `Math.floor(1499.5) / 100` = `1499 / 100` = `$14.99`

This calculation is used for:
- Parent Ticket price in ticket add-ons column (50% of cheapest primary ticket price)
- Parent Membership price in member add-ons column (50% of cheapest membership price)

---

#### `extractAttractions(products)`
Builds a deduplicated, sorted attraction list from a set of products.

1. Sort products by `productLevelId` descending (highest tier first).
2. Iterate through all products; for each product, iterate through its `attractions`.
3. If attraction `name` not yet seen, add to output and mark seen.
4. Sort final output by `heightRequirement` ascending (nulls/0 first).

---

#### Attraction Normalization & WP Matching

The gallery's primary challenge: API attraction names and WordPress attraction post titles use different naming conventions. The matching pipeline:

**Normalize function `norm(s)`:**
1. Lowercase
2. Replace `&amp;` with space
3. Replace word `and` with space (using `/\band\b/g`)
4. Replace `&` with space
5. Remove all non-alphanumeric characters (keep only `[a-z0-9]`)

Examples:
- `"Sky Rider (Indoor Zipline)"` → `"skyriderindoorzipline"`
- `"Go-Kart Tracks"` → `"gokarttracks"`
- `"Tubes & Playground"` → `"tubesplayground"`

**Build WP Map:**
1. For each WP attraction, get title from `wa.title` (string) OR `wa.title?.rendered` (object with `.rendered`).
2. Normalize the title → `key`.
3. Store `wpMap[key] = wa`.
4. Also strip leading `"the"` from key: `noThe = key.replace(/^the/, '')`. If `noThe !== key`, also store `wpMap[noThe] = wa`.

**Find WP match for an API attraction `wpFind(normalizedApiName)`:**
1. Direct map lookup: `wpMap[normalizedApiName]`
2. Alias lookup: check `WP_ALIASES[normalizedApiName]`, then `wpMap[WP_ALIASES[normalizedApiName]]`
3. Substring fallback: if `normalizedApiName.length >= 7`, iterate all `wpMap` entries; return first where `key.length >= 5` AND (`key.includes(normalizedApiName)` OR `normalizedApiName.includes(key)`)
4. If none found: return `null`

**Explicit WP_ALIASES dictionary:**
```javascript
{
  'skyriderindoorzipline': 'skyrider',
  'runway':                'runwaytumbletrack',
  'tubesindoorplayground': 'tubesplayground',
  'tubeslide':             'tubeslides',
  'gokarts':               'gokarttracks',
  'gokarttrack':           'gokarttracks',
  'indoorgokarts':         'gokarttracks',
  'climbinghill':          'climbingwalls',
  'climbingwall':          'climbingwalls',
  'ropescourse':           'warriorcourse',
  'warriorobstaclecourse': 'warriorcourse',
  'indoorropes':           'warriorcourse',
}
```

**Extract data from a matched WP attraction `wa`:**
- Image: `wa?.featured_image` → `wa?.acf?.image?.url` → `wa?.featured_image_url` → fallback
- Description: `(wa?.excerpt || wa?.description || wa?.acf?.description || '').replace(/<[^>]+>/g, '').trim()`
- Slug: `wa?.slug || ''`

**Fallback image URL:** `https://www.urbanair.com/wp-content/uploads/2022/05/353573_standard-1.jpeg`
**Go-karts hardcoded fallback image:** `https://www.urbanair.com/wp-content/uploads/2018/03/go-karts-1600x900-1-1080x675.jpg`
**Go-karts hardcoded description fallback:** `"Put your driving skills to the test and race to the finish with our indoor Go-Karts."`
**Go-karts hardcoded slug fallback:** `"go-karts"`

---

### 2.7 Pricing Model Detection

**Input:** `primaryTickets` — tickets matching the `isPrimaryTicket` allowlist, minus secondary tickets (parent, shorty, 5 & under). Promo tickets never reach this function.

**Rules:**
1. If any ticket name matches `/\b(deluxe|ultimate|platinum)\b/i` → **legacy**
2. Otherwise → **simplified**

(There is deliberately no ticket-count rule: promos can add a third ticket to simplified parks, so counting tickets misclassifies them.)

**Implications:**
- `simplified`: 1 or 2 primary tickets. The cheapest is "Unlimited Play" (base). The most expensive (if different from base AND is a go-karts ticket) is "Unlimited Play +".
- `legacy`: primary tickets are Deluxe/Ultimate/Platinum tiers, sorted by price ascending. Each displayed as a tier cell.

---

### 2.8 Rendering Logic — Tickets Tab

The entire tickets tab renders inside one component (the "simplified pricing wrap"). Despite the name, it handles BOTH simplified and legacy models.

**Step 1 — Classify tickets:**
```
secondary = tickets where isSecondaryTicket(name) === true
primary   = tickets where isPrimaryTicket(name) === true && isSecondaryTicket(name) === false
model     = detectPricingModel(primary)   // 'simplified' | 'legacy'
// tickets that are neither primary nor secondary are promos — not rendered
isLegacy  = model === 'legacy'
sortedByPrice = [...primary].sort ascending by price
goKartsOn = !isLegacy && primary.some(t => isGoKartsTicket(t))
```

**Step 2 — Header copy:**
- H1: `isLegacy ? "Ticket Options" : "Play All Day"`
- Subline: `isLegacy ? "Pick Your Level of Play · Deluxe to Platinum!" : "Unlimited Fun · No Time Limits · Adventure Unlimited!"`

**Step 3 — Panel grid class:**
```
Base class: "sp-panels"
If isLegacy AND sortedByPrice.length >= 3: add class "sp-legacy"     → columns: 2.1fr 0.9fr
Else if !goKartsOn AND !isLegacy: add class "sp-no-gokarts"          → columns: 1fr 1fr
Else (simplified + goKartsOn):   no extra class                      → columns: 1.16fr 0.84fr
```

**Step 4 — Ticket cells split class:**
```
Base class: "sp-tickets-split"
If isLegacy AND sortedByPrice.length >= 3: add "sp-triple"   → 3 equal columns
If !isLegacy AND !goKartsOn: add "sp-single"                 → 1 column
Else: default 2 columns
```

**Step 5 — Build ticket cells:**

*Simplified mode:*
```
base    = sortedByPrice[0]
upgrade = goKartsOn ? sortedByPrice[last] : null
If base:    buildTicketCell(base, ticketUrl, 'outline', false, false, new Set())
If upgrade (and upgrade !== base):
            buildTicketCell(upgrade, ticketUrl, 'solid', true, false, new Set())
```

*Legacy mode:*
```
cumulativeAttrNames = new Set()  // tracks all attr names from lower tiers
sortedByPrice.forEach((ticket, i) => {
  ctaStyle = (i < sortedByPrice.length - 1) ? 'outline' : 'solid'
  hasDivider = (i > 0)
  buildTicketCell(ticket, ticketUrl, ctaStyle, hasDivider, true, cumulativeAttrNames)
  // After building: add this ticket's attractions to cumulativeAttrNames
  ticket.attractions.forEach(a => cumulativeAttrNames.add(a.name))
})
```

**`buildTicketCell(ticket, ticketUrl, ctaStyle, hasDivider, isLegacy, lowerAttrNames)`:**

```
CSS classes on cell:
  - Always: "sp-ticket-cell"
  - If hasDivider: + "sp-cell-divider"  → adds left border 2px #fdeaf5
  - If isLegacy: + "sp-legacy-cell"    → reduces horizontal padding to 20px

Price font size:
  - Default 72px
  - If isLegacy: 60px (add class "sp-price-lg")

Body content:
  If isLegacy:
    tierAttrs = ticket.attractions filtered to names NOT in lowerAttrNames
    leadIn:
      lowerAttrNames.size === 0      → "Includes:"
      lowerAttrNames.size <= 6       → "Everything in Deluxe, plus:"
      lowerAttrNames.size > 6        → "Everything in Ultimate and Deluxe, plus:"
    If tierAttrs.length:
      Render pink lead-in line + unordered list of attraction names
    
  If simplified:
    subtext = ctaStyle === 'solid'
      ? 'All Day Play, plus unlimited laps.'
      : 'Every attraction. All day long.'
    Render subtext paragraph

HTML output:
  <div class="sp-ticket-cell [sp-cell-divider] [sp-legacy-cell]">
    <h3 class="sp-cell-title">{ticket.parkProductName}</h3>
    <span class="sp-accent-bar"></span>
    <div class="sp-price-slot">
      <span class="sp-price [sp-price-lg]">{fmtPrice(ticket.price)}</span>
    </div>
    [body content]
    <a href="{ticketUrl}" target="_blank" rel="noopener" 
       class="sp-cta sp-cta-{ctaStyle}">Select Ticket</a>
  </div>
```

**Step 6 — Ticket purchase URL:**
```
ticketUrl = currentUrlSlug
  ? "https://store.unleashedbrands.com/urban-air/{currentUrlSlug}/purchase/ticket"
  : "#"
```
`currentUrlSlug` = `park.urlSlug` from the API (e.g., `"westlake-oh"`).

**Step 7 — Ticket add-on cards:**

Grid class: `"sp-addon-grid"` + (isLegacy ? `" sp-stacked"` : `""`)

Find products:
```
fiveUnder = secondary.find(name matches /\b5\s*(?:&amp;|&|and)?\s*under\b/i)
         || merch.find(same)
shorty    = secondary.find(name matches /shorty/i) || merch.find(same)
parent    = secondary.find(name matches /parent/i) || merch.find(same)
socks     = merch.find(name matches /sock/i)
```

`wide` class = isLegacy ? `""` : `" sp-addon-wide"` (socks card spans 2 cols in simplified mode)

`parentDisplay` = if `basePrice != null`: `fmtPrice(Math.floor(basePrice / 2 * 100) / 100)` else `"50%"`
`basePrice` = isLegacy ? null : sortedByPrice[0]?.price

Cards rendered (in order, skip if product not found):
1. 5 & Under — `fmtPrice(fiveUnder.price)`
2. Shorty 40″ — `fmtPrice(shorty.price)`
3. Parent Ticket — `parentDisplay`
4. Urban Air Socks — `fmtPrice(socks.price)` (with `wide` class)

All cards: white background, 4px `#e50695` bottom border, `#383838` name, `#6b7280` desc, `#e50695` price.

**Step 8 — Membership panel:**

Find cheapest membership:
```
cheapestMember = memberships
  .filter(p => !/shorty|parent/i.test(p.parkProductName))
  .sort ascending by price
  [0]
```

Price display: `fmtPrice(cheapestMember.price) + '<span class="sp-member-mo">/mo</span>'`

Half badge visibility:
- If `isLegacy`: `halfBadge.style.display = 'none'`
- Otherwise: show badge; badge sub-text:
  - goKartsOn: `"the cost of<br>Unlimited&nbsp;Play&nbsp;+"`
  - !goKartsOn: `"the cost of<br>Unlimited&nbsp;Play"`

Member descriptor text:
- `goKartsOn && !isLegacy`: `"Unlimited Visits, Go-Karts Included!"`
- otherwise: `"Unlimited Visits, Every Month!"`

Member CTA href:
```
memberUrl = locationSlug
  ? "https://www.urbanair.com/{locationSlug}/membership"
  : "#"
```
`locationSlug` = `currentLocationSlug` = computed by `buildLocationSlug(parkName)` (e.g., `"ohio-westlake"`)

**Step 9 — Member add-on cards:**

Grid class: `"sp-addon-grid"` + (isLegacy ? `" sp-stacked"` : `""`)

Find products:
```
mFiveUnder = memberships.find(name matches /\b5\s*(?:&amp;|&|and)?\s*under\b/i)
           || secondary.find(same)
mShorty    = memberships.find(name matches /shorty/i) || secondary.find(same)
mParent    = memberships.find(name matches /parent/i) || secondary.find(same)
```

`parentDisplay` = if `baseMemberPrice != null`: `fmtPrice(Math.floor(baseMemberPrice / 2 * 100) / 100)` else `"50%"`
`baseMemberPrice` = isLegacy ? null : cheapestMember?.price

Cards rendered:
1. 5 & Under — `fmtPrice(mFiveUnder.price)` (if found)
2. Shorty 40″ — `fmtPrice(mShorty.price)` (if found)
3. Parent Membership — `parentDisplay` (if found)
4. Urban Air Socks — `"FREE"` (always rendered, with `wide` class in simplified mode)

All cards: `#e50695` background, no bottom border, white name, `rgba(255,255,255,0.85)` desc, `#e0e621` price.

**Step 10 — Attractions gallery:**

```
goKartsAttr = apiAttractions.find(name matches /go.?kart/i)
others      = apiAttractions.filter(name does NOT match /go.?kart/i)
```

Go-karts tile (if `goKartsOn && goKartsAttr`):
- Class: `"sp-attraction-card sp-featured-card"` (spans 2 cols × 2 rows)
- Look up WP data via `wpFind(norm(goKartsAttr.name))`
- Image: WP image → go-karts hardcoded fallback
- Description: WP description → hardcoded fallback
- Slug: WP slug → `"go-karts"`
- Link: `locationSlug ? "https://www.urbanair.com/{locationSlug}/{slug}" : "https://www.urbanair.com/attractions/"`
- Has "Featured" pink pill (top-left) + attraction name yellow pill (bottom-left)

Regular tiles (for each `others` attraction):
- Class: `"sp-attraction-card"` (no span)
- Look up WP data via `wpFind(norm(attr.name))`
- Image: WP image → fallback image
- Description: WP description (shown in hover overlay)
- Link: `(locationSlug && slug) ? "https://www.urbanair.com/{locationSlug}/{slug}" : "https://www.urbanair.com/attractions/"`
- Has attraction name yellow pill (bottom-left)

If `apiAttractions` is empty: render empty grid.

---

### 2.9 Rendering Logic — Birthdays Tab

**Input:** `{ packages, hangouts }` from `loadBirthdays()`

**Birthday packages grid:**
- If `packages.length === 0`: hide birthday section entirely.
- Render one `bdayCard(pkg)` per package.
- Show section header "Birthday Parties" with orange accent (`--c-birthday: #C2410C`).

**`bdayCard(pkg)` output:**
```html
<div class="bday-card">
  <div class="bday-head" style="background:{pkg.productLevelColor || '#C2410C'}">
    <div class="bday-tier">{pkg.productLevelName}</div>
    <div class="bday-price">{usd(pkg.minCombinedPrice)}</div>
    <div class="bday-from">Starting price</div>
  </div>
  <div class="bday-body">
    <div class="bday-meta">[guests icon] Min {pkg.quantity} guests</div>
    <div class="bday-desc">{pkg.productLevelDescription || ''}</div>
    [attractionHTML(pkg.attractions)]
  </div>
</div>
```
`usd(n)` = `Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(n)`

**Attraction matrix (tiers × attractions):**
- Only shown if packages have attractions data.
- Tiers = packages sorted by `productLevelId` ascending.
- All unique attraction names across all packages (deduped, first occurrence wins).
- Each cell: checkmark `✓` (green) if `tier.productLevelId >= attraction.minimumProductLevelId`, else em dash `—` (gray).
- Heights shown as `(42")` in gray next to attraction name in header column.

**Common amenities:**
- Extract amenities from all hangouts.
- Find intersection: items present in ALL hangout amenity arrays.
- Show only if intersection is non-empty.

**Hangouts section:**
- If `hangouts.length === 0`: hide section.
- One `hangoutCard(h)` per hangout (already deduplicated by resourceTypeId).

**`hangoutCard(h)` output:**
```html
<div class="hgout" style="border-top: 3px solid {color}">
  <div class="hgout-row">
    <div class="hgout-name" style="color:{color}">{h.name}</div>
    [price or "Included"]
  </div>
  [amenity list if h.amenities.length]
</div>
```
`color = h.price === 0 ? '#047857' : '#C2410C'`
Price: `h.price === 0` → "Included" (green) | else → `"+{usd(h.price)}"` (orange)

---

### 2.10 Rendering Logic — Memberships Tab

**Input:** `{ memberships, annualPasses, attractions }` from `loadMemberships()`

**Monthly memberships grid:**
- One `memberCard(m)` per membership.
- If empty: hide "Monthly Memberships" section.

**`memberCard(p)` output:**
```
Color bar (4px) in p.color || '#B45309'
Optional image (if p.imageUri)
Card body:
  - Name (uppercase, Oswald font)
  - Price: "{usd(p.price)}/{p.billingInterval || 'mo'}"
  - Contract: "{p.contractDuration}-month contract" (if present)
  - Level badge (if p.productLevelName)
  - Description text (if present)
  - Attraction list with height requirement footnotes (see below)
```

**Height requirement footnotes in `attractionHTML(attractions)`:**
- Build a `fnMap` to assign sequential footnote numbers to unique height requirements.
- Each attraction with a height requirement gets a superscript `1`, `2`, etc.
- Below the list: a legend line `"¹ 42" height required · ² 48" height required"` etc.
- Footnote superscripts have a tooltip showing the full requirement on hover.

**Annual passes grid:**
- One `annualCard(a)` per annual pass.
- If empty: hide "Annual & Prepaid Passes" section.

**`annualCard(p)` output:** Same shape as memberCard but with green (`#047857`) accent and no billing interval.

**Park attractions grid:**
- Render all `attractions` (from `CACHE[parkId].attractions`).
- Each attraction: name + height requirement pill (`"42" min"` in amber).
- Grid: 3 columns on desktop, 2 on ≤800px, 1 on ≤480px.
- If empty: hide "Park Attractions" section.

---

## 3. Complete Visual & Design Specification

Recreate these values exactly. No approximations.

### 3.1 Design Tokens

**Colors:**
```
--pink:        #e50695   (primary: CTAs, borders, accents, prices)
--yellow:      #e0e621   (accent: member panel prices, pills, hover states)
--charcoal:    #383838   (primary text, headings)
--section-bg:  #f6f2f5   (pricing zone background)
--divider:     #fdeaf5   (panel internal dividers)
--gray-500:    #6b7280   (body/subline text)
--gray-600:    #4b5563   (attraction list text in legacy cells)
--gray-400:    #9ca3af   (fine print)
--white:       #ffffff
--black-app:   #111218   (app header background)
--yellow-hdr:  #FFD100   (app header border/brand)

-- Used in other tabs only:
--c-ticket:    #1D4ED8
--c-member:    #B45309   (amber: monthly memberships)
--c-annual:    #047857   (green: annual passes)
--c-birthday:  #C2410C   (orange: birthday parties)
--c-attract:   #0D9488   (teal: attractions section headers)
--c-merch:     #374151
```

**Typography:**
```
Font families:
  Heading (Oswald):    'Oswald', sans-serif         — used in app shell tabs + legacy card names
  Body (Nunito Sans):  'Nunito Sans', sans-serif     — used in app shell body text
  Marketing (Montserrat): 'Montserrat', sans-serif   — used in ALL simplified pricing section

Target production font (if licensed): Azo Sans (replace Montserrat 1:1 with same weights)

Google Fonts URL:
  https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&family=Oswald:wght@400;500;600;700&family=Nunito+Sans:wght@400;500;600;700&display=swap

Type scale (for simplified pricing section — all Montserrat):
  Eyebrow:          14px / 800 / uppercase / letter-spacing 0.25em / #e50695
  H1:               48px mobile, 60px ≥768px / 900 / uppercase / tracking tight / #383838
  H2:               48px / 900 / uppercase / tracking tight / #383838
  Panel title:      26px / 900 / uppercase / tracking tight / line-height 1 / #383838 (ticket) / #e0e621 (member)
  Big price:        72px / 900 / line-height 1 / no-wrap / #e50695 (ticket) / #e0e621 (member)
  Legacy price:     60px / 900 (same, different size)
  Descriptor:       20px / 800 / uppercase / #383838 (ticket) / white (member)
  Tier lead-in:     12px / 700 / uppercase / letter-spacing 0.1em / #e50695
  Tier list:        14px / 600 / #4b5563 / line-height 1.7 / centered
  Subline:          18px / 600 / #6b7280
  CTA text:         16px / 700 / uppercase / letter-spacing 0.05em
  Member "/mo":     24px / 800
  Add-on name:      16px / 800 / uppercase / #383838 (ticket) / white (member)
  Add-on desc:      12px / 600 / #6b7280 (ticket) / rgba(255,255,255,0.85) (member)
  Add-on price:     30px / 900 / no-wrap / #e50695 (ticket) / #e0e621 (member)
  Fine print:       11px / line-height 1.6 / #9ca3af / centered / max-width 896px
  Superscript cents: 0.42em of price size / vertical-align super / letter-spacing 0 / line-height 1
  HALF badge "HALF": 16px / 900 / white
  HALF badge sub:   9px / 700 / line-height 1.4 / white
```

**Spacing:**
```
Section vertical padding:  64px (pricing zone + gallery)
Section horizontal padding: 24px
Section max-width:          1280px (centered)
Panel grid gap:             28px
Column internal gap (panel to add-ons): 20px
Add-on grid gap:            20px
Gallery grid gap:           24px
Cell padding:               40px vertical / 32px horizontal
Cell padding legacy:        40px vertical / 20px horizontal
Accent bar margin:          10px top / 28px bottom
Price slot margin-bottom:   8px
CTA margin-top:             24px
Gallery footer margin-top:  48px
Fine print margin-top:      40px
```

**Border radii:**
```
Panels + attraction cards:  25px
CTAs + pills + badges:      50px (fully rounded)
App shell cards:            12px
```

**Shadows:**
```
Resting:         0 0 20px rgba(0,0,0,0.2)
Panel hover:     0 18px 36px rgba(0,0,0,0.18)
App shell:       0 1px 3px rgba(0,0,0,.06), 0 2px 8px rgba(0,0,0,.07)
App shell hover: 0 4px 16px rgba(0,0,0,.10)
```

---

### 3.2 Application Shell

The application shell is a chrome that wraps all three tabs. It has its own design language separate from the simplified pricing section.

**Sticky header:**
- Background: `#111218` (near-black)
- Bottom border: 3px solid `#FFD100` (golden yellow)
- Z-index: 100
- Inner padding: 11px 24px
- Layout: flex row, align-items center, gap 18px

Brand:
- "Urban Air" — Oswald, 21px, 700, uppercase, letter-spacing 0.07em, white
- "Pricing Explorer" — 10px, 600, letter-spacing 0.12em, uppercase, `#FFD100`, opacity 0.8

Location dropdown:
- Max-width: 440px, flex: 1
- Background: `rgba(255,255,255,0.08)`, border: 1.5px solid `rgba(255,255,255,0.18)`, border-radius: 8px
- Text: white, Nunito Sans, 14px, 600
- On focus: border-color `#FFD100`, background `rgba(255,255,255,0.13)`
- Options: background `#1a1a24`, text white
- Custom chevron arrow (absolutely positioned SVG at right, pointer-events none)

**Tab navigation:**
The tabs (Tickets & Bundles, Birthday Parties, Memberships & Passes) are NOT visible in the current production `index.html`. Tab switching is done programmatically via URL changes and direct JavaScript calls. There is no visible tab bar in the current app — the content area shows one tab at a time based on `activeTab` state. The Next.js rebuild should implement a visible tab navigation bar.

**Empty state:**
- Centered vertically and horizontally
- 📍 emoji icon (44px)
- "Select a Location" — Oswald, 22px, 600, uppercase
- "Pricing pulled live from the Urban Air API" — 13px, `#9CA3AF`

**Loading state (per-tab):**
- Centered spinner (42px circle, border 4px, border-top-color `#111218`, animated spin)
- "Loading Tickets" / "Loading Birthday Parties" / "Loading Memberships" — Oswald, 22px
- Step text below (shows API progress: "Scanning upcoming schedule…", "Loading tickets…")

**Error state:**
- Max-width 440px, centered with 60px margin top
- Background `#fef2f2`, border `#fca5a5`, border-radius 12px
- "Could Not Load Data" heading in `#991b1b`
- Error message in `#dc2626`

**Content animation:**
- Main content area fades in from `opacity:0, translateY(14px)` to `opacity:1, translateY(0)`
- Duration: 0.3s, cubic-bezier(0.22, 1, 0.36, 1)

---

### 3.3 Tickets Tab — Simplified Pricing Section

The main design area. Background `#f6f2f5`.

**Section header (centered):**
- Eyebrow: "CHOOSE YOUR ADVENTURE"
- H1: dynamic (see §2.8 Step 2)
- Subline: dynamic (see §2.8 Step 2)
- All three centered, margin-bottom 40px on the header block

**Two-column panel grid** (see §2.8 Steps 3–4 for classes and column ratios):
- Left column: flex column, gap 20px → tickets panel card (flex-grow: 1) + ticket add-on grid
- Right column: flex column, gap 20px → membership panel card (flex-grow: 1) + member add-on grid

**Tickets panel card:**
- White background, border-radius 25px, shadow, overflow hidden, flex-grow 1
- Hover: translateY(-6px) + deeper shadow, 0.3s ease
- Internal split grid (see §2.8 Steps 4–5)

**Each ticket cell** (see §2.8 `buildTicketCell`):
1. Title (`h3`, 26px/900/uppercase/`#383838`)
2. Accent bar (40×4px, `#e50695`, rounded-full, margin 10px top / 28px bottom)
3. Price slot (fixed 100px tall, flex center)
   - Price span (72px or 60px/900/`#e50695`, white-space nowrap)
   - Cents as `<span class="sp-cents">` with 0.42em size, superscript
4. Descriptor (20px/800/uppercase/`#383838`)
5. Body (flex-grow 1): subtext paragraph (simplified) OR tier list (legacy)
6. CTA button (see CTA styles below)

**Vertical divider between cells:** `border-left: 2px solid #fdeaf5`
Below 640px: cells stack vertically; divider changes to `border-top: 2px solid #fdeaf5`, `border-left: none`

**Membership panel card:**
- Background `#e50695`, same radius/shadow/hover as tickets
- Flex column, items center, text center, padding 40px 32px
- Halftone texture: absolute overlay, `radial-gradient(rgba(255,255,255,0.18) 1.5px, transparent 1.5px)` at 14×14px, masked with `linear-gradient(115deg, black 0%, transparent 45%)`
- All child elements inside have `position: relative` (above the halftone)

Membership cell anatomy:
1. "MONTHLY MEMBERSHIP" — 26px/900/uppercase/`#e0e621`
2. Yellow accent bar (40×4px)
3. Price slot (100px fixed height, flex row, gap 16px, centered):
   - Price + /mo: `<span class="sp-member-price">` contains fmtPrice output + `<span class="sp-member-mo">/mo</span>`
   - HALF badge (100×100px, flex column center, white text):
     - SVG background: two semicircular arcs (radius 42, stroke `#e0e621`, stroke-width 3) + two arrow polygons forming chasing arrows
     - SVG path data: 
       - Arc 1: `M 50 8 A 42 42 0 0 1 50 92`
       - Arc 2: `M 50 92 A 42 42 0 0 1 50 8`  
       - Arrow 1 (bottom): `polygon points="53,86 53,98 41,92"`
       - Arrow 2 (top): `polygon points="47,2 47,14 59,8"`
     - "HALF" text: 16px/900
     - Sub-text: 9px/700, dynamic (see §2.8 Step 8)
4. Descriptor: 20px/800/uppercase/white, dynamic text
5. "Plus member pricing on everything below." — 14px/600/`rgba(255,255,255,0.85)`, flex-grow 1
6. Member CTA button

**CTA button styles:**
All: `border-radius: 50px; border: 3px solid; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; text-align: center; text-decoration: none; transition: all 0.3s ease; display: block; width: 100%; max-width: 240px; margin-top: 24px; padding: 14px 16px; font-size: 16px; cursor: pointer`

| Style class | Default state | Hover state |
|---|---|---|
| `sp-cta-outline` | transparent bg, `#e50695` border+text | `#e50695` bg, white text |
| `sp-cta-solid` | `#e50695` bg+border, white text | white bg, `#e50695` text, scale(1.04) |
| `sp-cta-member` | `#e0e621` bg+border, `#383838` text | white bg+border, `#e50695` text, scale(1.04) |
| `sp-cta-wide` | inline-block, auto width, `padding: 14px 48px`, `letter-spacing: 0.1em`, `#e50695` bg, white text, shadow | `#e0e621` bg+border, `#383838` text, scale(1.04) |

**Add-on cards:**
- Height: 112px fixed
- Border-radius: 25px
- Shadow: `0 0 20px rgba(0,0,0,0.2)`
- Padding: 0 24px
- Layout: flex row, align-items center, gap 16px

| Side | Background | Bottom border | Name color | Desc color | Price color |
|---|---|---|---|---|---|
| Ticket | white | 4px solid `#e50695` | `#383838` | `#6b7280` | `#e50695` |
| Member | `#e50695` | none | white | `rgba(255,255,255,0.85)` | `#e0e621` |

Add-on grid: 2 columns, gap 20px. Socks card spans both columns (in simplified mode). Legacy: all cards full-width. Below 480px: always single column.

**Fine print:**
- Exact copy: `"Prices shown are live values from the location pricing feed. Shorty 40 access level is dependent upon the child's attraction eligibility. Parent Ticket: with purchase of a full-price child's pass; must match the child's attraction level. Urban Air Socks are required. Membership includes one pair of Urban Air Socks on the initial visit only. Prices do not include tax. Offers and pricing not valid for parties, groups, or special events."`
- Style: 11px, `#9ca3af`, centered, max-width 896px, margin 40px auto 0

---

### 3.4 Tickets Tab — Attractions Gallery

Section: white background, padding 64px 0.

**Gallery header (centered):**
- Eyebrow: "EXPERIENCE THE THRILL"
- H2: "ATTRACTIONS GALLERY"

**Gallery grid:**
- CSS grid: 2 columns mobile / 4 columns ≥768px
- Gap: 24px
- `grid-auto-rows: 16rem` — every row is exactly 16rem tall
- Every tile: `height: 100%` within grid cell

**Tiles general:**
- Border-radius: 25px
- Overflow: hidden
- Box-shadow: `0 2px 8px rgba(0,0,0,0.15)`
- Image: `width: 100%; height: 100%; object-fit: cover`

**Featured Go-Karts tile:**
- Class: `sp-featured-card` → `grid-column: span 2; grid-row: span 2`
- "FEATURED" pill: absolute top-left (20px from edges), pink bg, white text, 12px/900, uppercase, `padding: 6px 16px`, radius 50px, shadow `0 2px 8px rgba(0,0,0,0.2)`
- Attraction name pill: absolute bottom-left (20px from edges), yellow `#e0e621` bg, `#383838` text, 16px/900, uppercase, `padding: 8px 20px`, radius 50px
- Hover overlay: see below (larger text on featured tile)

**Regular tiles:**
- Attraction name pill: absolute bottom-left (16px from edges), yellow bg, `#383838`, 12px/900, uppercase, `padding: 4px 12px`

**Hover overlay (all tiles):**
- Absolute inset 0, z-index 11
- Background: `rgba(56,56,56,0.78)`
- Opacity: 0 at rest → 1 on parent hover, 0.3s ease transition
- Flex column, items center, justify center, padding 20px, text center, white text
- Description: 13px/600 (15px on featured), max 3 lines clamped (`-webkit-line-clamp: 3`, 4 on featured), `overflow: hidden`
- "Learn More" link: `#e0e621`, 12px/700, uppercase, underline on hover (14px on featured)

**Gallery footer:**
- "VIEW ALL ATTRACTIONS" wide CTA button (see §3.3 CTA styles, `sp-cta-wide`)
- Link: `https://www.urbanair.com/attractions/`
- Centered, margin-top 48px

---

### 3.5 Birthdays Tab

The birthdays tab uses the "app shell" card style (not simplified pricing style).

**Section:** orange (`#C2410C`) header bar, white body.

**Birthday package grid:** 3 columns on desktop, 2 on ≤900px, 1 on ≤560px, gap 18px.

**Birthday card:**
- Colored header (from `productLevelColor`): tier name in Oswald 26px/700/uppercase, price in 36px/700, "Starting price" in 11px/600/70% opacity
- White body: guest minimum (with icon), description text, attraction list

**Attraction matrix:** Full-width table. Colored column headers per tier. Checkmarks vs. dashes per attraction-tier combination.

**Common amenities:** 2-column grid (1 on mobile), each item with green checkmark, 12px text.

**Hangouts section:** Flex row wrap, gap 14px. Each hangout card: top border (3px, green or orange), name + price/included row, amenity list.

---

### 3.6 Memberships Tab

**Monthly Memberships section:** Amber (`#B45309`) header. Grid 3 cols / 2 / 1. Each card: colored top bar, optional image, name, price with interval, contract duration, level badge, description, attraction list.

**Annual Passes section:** Green (`#047857`) header. Same grid. No billing interval.

**Park Attractions section:** Teal (`#0D9488`) header. 3-column grid (2 on ≤800px, 1 on ≤480px). Each item: attraction name + optional height pill (`"42" min"` in amber on cream).

---

### 3.7 Shared Components

**Section header bar:**
```
Flex row, align-items center, gap 10px
Padding: 13px 22px
Border-radius: 12px 12px 0 0
Background: color-coded (passed inline)
Color: white
Icon: 20×20px SVG, opacity 0.9
Title: Oswald, 20px, 600, uppercase, letter-spacing 0.07em
```

**Section body:**
```
Background: white
Border: 1px solid #E5E7EB, border-top: none
Border-radius: 0 0 12px 12px
Padding: 24px
```

**General card (.card):**
```
Background: white
Border: 1px solid #E5E7EB
Border-radius: 12px
Overflow: hidden
Box-shadow: 0 1px 3px rgba(0,0,0,.06), 0 2px 8px rgba(0,0,0,.07)
Hover: translateY(-2px), shadow deepens
Animation: fadein 0.25s ease
```

**Row card (.row-card):** horizontal flex, space-between, name 13px/600, price Oswald 17px/700.

---

### 3.8 Responsive Breakpoints

| Breakpoint | Changes |
|---|---|
| < 480px | Add-on grid: always 1 column. Wide add-on card: span 1. |
| < 560px | Birthday packages grid: 1 column. Secondary tickets: 1 column. |
| < 640px | Ticket cells: stack vertically. Horizontal divider replaces left-border. |
| < 768px | Gallery grid: 2 columns (default). H1 stays 48px (no desktop bump). |
| ≥ 768px | H1 grows to 60px. Gallery grid: 4 columns. |
| < 800px | Membership attraction grid: 2 columns. Birthday attraction grid: 2 columns. |
| < 900px | Birthday packages grid: 2 columns. General 3-column grids: 2 columns. |
| < 1024px | Pricing panel grid: always 1 column (override all column ratios). |

---

### 3.9 Animations & Transitions

| Element | Animation |
|---|---|
| Main content area (on park select) | `rise`: from `{opacity:0, transform:translateY(14px)}` to `{opacity:1, transform:none}`, 0.3s cubic-bezier(0.22,1,0.36,1) |
| All cards | `fadein`: from `{opacity:0}` to `{opacity:1}`, 0.25s ease |
| Panel cards (pricing) | Hover: `translateY(-6px)` + shadow, 0.3s ease |
| App shell cards | Hover: `translateY(-2px)` + shadow, 0.18s |
| Loading spinner | `spin`: `rotate(360deg)`, 0.75s linear infinite |
| Attraction overlay | `opacity: 0 → 1`, 0.3s ease |
| CTA buttons | `all 0.3s ease`; scale(1.04) on solid/member/wide hover |
| Header dropdown | `border-color, background 0.18s` |
| Height requirement tooltip | `opacity 0.12s` |

---

## 4. Next.js Rebuild Guide

### Recommended Architecture

**App Router (Next.js 13+).** No pages router. Use React Server Components for the static shell; client components only where interactivity requires it.

### Project Structure

```
app/
  layout.tsx          — Root layout: fonts, global CSS
  page.tsx            — Redirects to /[location] or shows empty state
  [location]/
    page.tsx          — Main location page (renders PricingExplorer)
    [section]/
      page.tsx        — Deep-linked section (birthdays, memberships)
  globals.css         — CSS variables and global styles

components/
  PricingExplorer.tsx        — 'use client' root: location select + tab state
  LocationSelector.tsx       — Dropdown with park list
  tabs/
    TicketsTab.tsx
    BirthdaysTab.tsx
    MembershipsTab.tsx
  pricing/
    SimplifiedPricingSection.tsx   — Full tickets + gallery layout
    TicketCell.tsx
    MembershipPanel.tsx
    AddonCard.tsx
    AttractionsGallery.tsx
    AttractionTile.tsx
  birthdays/
    BirthdayCard.tsx
    AttractionMatrix.tsx
    HangoutCard.tsx
  memberships/
    MemberCard.tsx
    AnnualCard.tsx
  shared/
    SectionHeader.tsx
    LoadingSpinner.tsx
    HalfBadge.tsx
    PriceDisplay.tsx     — Renders price with superscript cents
    CtaButton.tsx

lib/
  api.ts              — All API fetch functions (typed)
  pricing.ts          — detectPricingModel, isSecondaryTicket, etc.
  attractions.ts      — WP matching logic, normalization
  slugs.ts            — buildLocationSlug, STATE_NAMES
  format.ts           — fmtPrice, usd, parentPriceCalc
  types.ts            — All TypeScript interfaces
```

### Routing

Use Next.js dynamic routes:
```
/                               → redirect or empty state
/[locationSlug]                 → tickets tab
/[locationSlug]/birthday        → birthdays tab
/[locationSlug]/membership      → memberships tab
```

On the server, `params.locationSlug` matches against the park list to get the `parkId`. Pass `parkId` as a prop to the client `PricingExplorer` component.

**Do not use `history.pushState` directly.** Use `router.push()` from `next/navigation`. On tab change, push the appropriate route.

### Data Fetching Strategy

**Park list:** Fetch in a React Server Component (RSC) at layout level. Pass to a client `LocationSelector`. Cache with `cache: 'force-cache'` and revalidate every hour.

**Per-park data:** All fetched client-side (same as current app), because prices vary by location. Use React `useState` + `useEffect` or a lightweight data-fetching library (SWR or TanStack Query recommended — not required). Maintain the same in-memory `CACHE` object keyed by `parkId` as module-level state in a custom hook.

**WP Attractions:** Fetch once per app session (module-level singleton promise, exactly as the current app). Alternatively, fetch server-side and pass as a prop since it doesn't change per location.

### Session Storage

Use `sessionStorage` in a `useEffect` (it doesn't exist server-side):
```typescript
useEffect(() => {
  const saved = sessionStorage.getItem('ua_park');
  // restore from saved
}, []);
```

### TypeScript Interfaces

```typescript
interface Park {
  id: number;
  name: string;           // "City, ST"
  urlSlug: string;        // "westlake-oh"
}

interface Product {
  parkProductName: string;
  price: number;
  productLevelId?: number;
  productLevelName?: string;
  productLevelColor?: string;
  productLevelDescription?: string;
  imageUri?: string;
  billingInterval?: string;
  contractDuration?: number;
  description?: string;
  color?: string;
  attractions?: Attraction[];
  urlSlug?: string;
}

interface Attraction {
  name: string;
  heightRequirement?: number;
  minimumProductLevelId?: number;
}

interface BirthdayPackage extends Product {
  minCombinedPrice: number;
  quantity: number;
}

interface Hangout {
  name: string;
  price: number;
  amenities: string[];
  resourceTypeId: number;
}

interface CalendarSlot {
  parkAttendanceLimitId: number;
}

interface WpAttraction {
  title: string | { rendered: string };
  featured_image?: string;
  featured_image_url?: string;
  acf?: { image?: { url?: string }; description?: string };
  excerpt?: string;
  description?: string;
  slug?: string;
}

interface TicketsData {
  tickets: Product[];
  merch: Product[];
  memberships: Product[];
  attractions: Attraction[];
  wpAttractions: WpAttraction[];
}
```

### CSS Approach

Recommended: **CSS Modules** with the design tokens as CSS custom properties in `globals.css`. The simplified pricing section has a large, self-contained stylesheet — port it directly as `pricing.module.css`. Keep all class names identical to the original (`.sp-wrap`, `.sp-panel-card`, etc.) to make cross-referencing easier.

Alternatively, Tailwind CSS v4 works well — the design reference (`pricing-section-static.html`) already uses Tailwind v4 with custom theme tokens. You can port those tokens directly into `tailwind.config.ts`.

### Key Pitfalls to Avoid

1. **Calendar scan must still use `Promise.any()` with AbortControllers.** This is a performance-critical parallel race — do not serialize it.
2. **Parent price truncation:** Use `Math.floor(basePrice / 2 * 100) / 100`, not `Math.round`. "Never rounded up" is a business requirement.
3. **WP attractions fetch is a singleton.** Do not fire it once per location change. Use a module-level variable or React context to memoize the single promise.
4. **`park.urlSlug` ≠ `buildLocationSlug(park.name)`.** These are different slugs used for different URLs:
   - `park.urlSlug` (from API, e.g. `"westlake-oh"`) → purchase URLs on `store.unleashedbrands.com`
   - `buildLocationSlug(park.name)` (e.g. `"ohio-westlake"`) → UA website URLs and app routing
5. **Dropdown display format:** Show `"ST - City"` in dropdown options, not `"City, ST"` (the API format).
6. **Sort parks** by state abbreviation then city, both alphabetically, before rendering dropdown.
7. **Hide/filter products** matching `hideProduct()` regex before any rendering.
8. **Background pre-fetch:** After the active tab renders, silently pre-fetch the other two tabs. This is important for perceived performance.
9. **Pricing model detection uses `primary` tickets only** (the `isPrimaryTicket` allowlist minus secondary tickets — promo tickets excluded). Do not run `detectPricingModel()` on the raw ticket array.
10. **The "5 & Under" product** is treated as a secondary ticket (same as Shorty/Parent). It appears in the add-on cards section, not as a main ticket cell.

---

## 5. Exact Code Files Included

The following files are included in this handoff package alongside this document:

| File | Purpose |
|---|---|
| `index.html` | Complete production app (~1,685 lines). Single-file HTML/CSS/JS. The authoritative implementation. |
| `UA Simplified Pricing Update/design_handoff_simplified_pricing/pricing-section-static.html` | Clean static design reference for the pricing + gallery section. Both models in markup; CSS-only variant switching via `data-*` attributes on `<html>`. Tailwind v4 CDN. **Start here for visual reference.** |
| `UA Simplified Pricing Update/design_handoff_simplified_pricing/README.md` | Original design spec from the design handoff. Covers all design tokens, typography, spacing, component anatomy, and variant logic. |
| `UA Simplified Pricing Update/design_handoff_simplified_pricing/Simplified Pricing (tweakable).html` | Same design with live tweak panel. React/Babel required. Design review only. |
| `UA Simplified Pricing Update/design_handoff_simplified_pricing/tweaks-panel.jsx` | Tweak panel harness. Design review only. Do not port to production. |

**To see the design immediately:** Open `pricing-section-static.html` in a browser. Change `data-model="simplified"` to `data-model="legacy"` on the `<html>` tag to preview the legacy layout. Change `data-gokarts="on"` to `"off"` to hide go-karts variant.
