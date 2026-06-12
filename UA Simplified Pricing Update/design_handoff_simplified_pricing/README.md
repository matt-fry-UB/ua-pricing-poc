# Handoff: Urban Air Simplified Pricing Section

## Overview
A redesigned pricing + attractions section for Urban Air location pages. It replaces the existing `#tickets-pricing-grid` section (e.g. on https://www.urbanair.com/texas-southlake). It supports **two pricing models**, selected per location:

1. **Simplified Pricing** (new model): one base ticket ("Unlimited Play"), an optional upgrade at some locations ("Unlimited Play +", includes Go-Karts), and a Monthly Membership.
2. **Legacy tiers** (older locations, e.g. Spanish Fort AL, Southlake TX): three tiered tickets (Deluxe / Ultimate / Platinum) with cumulative attraction lists, plus the same Monthly Membership.

The layout is inspired by the in-park digital menu boards: a white tickets zone on the left with non-member add-on pricing below it, and a hot-pink membership zone on the right with member add-on pricing below it. An attractions gallery with a featured 2×2 tile sits underneath.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. The task is to **recreate this design inside the target website's existing environment** (the live Urban Air WordPress/HTML/CSS/JS stack) using its established patterns. The prototypes use the Tailwind Play CDN for convenience; the production implementation should use whatever CSS approach the codebase already uses — all needed values are documented below.

- `pricing-section-static.html` — **recommended reference.** Clean, dependency-light version (Tailwind v4 browser CDN + a plain-CSS block). No JS frameworks. Both pricing models are in the markup; all variant behavior is driven purely by `data-*` attributes on `<html>` (see "Variant logic"). To preview legacy mode, change `data-model="simplified"` to `data-model="legacy"` on the `<html>` tag.
- `Simplified Pricing (tweakable).html` + `tweaks-panel.jsx` — the working design with an interactive tweak harness (React/Babel) for flipping the same variants live. The harness is a design-review tool only; **do not port it**. Visuals are identical to the static file.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, shadows, copy, and interactions are final design intent. Recreate pixel-perfectly. Exceptions: prices and tier-attraction mappings are placeholders (see "Data requirements") and the font is a stand-in (see "Design tokens → Typography").

## Screens / Views

### 1. Pricing Section (`section#tickets-pricing-grid`)
- **Purpose**: Guest picks a ticket or membership; sees add-on pricing at a glance for both paths.
- **Section container**: full-width band, background `#f6f2f5`; inner container max-width 1280px, horizontal padding 24px, vertical padding 64px.
- **Header** (centered, bottom margin 40px; copy varies by model):
  - Eyebrow: "CHOOSE YOUR ADVENTURE" — 14px, weight 800, uppercase, letter-spacing 0.25em, color `#e50695`, margin-bottom 12px.
  - H1 — 48px mobile / 60px desktop, weight 900, uppercase, tight tracking, color `#383838`, margin-bottom 12px. Simplified: "UNLIMITED PLAY". Legacy: "TICKET OPTIONS".
  - Subline — 18px, weight 600, color `#6b7280`. Simplified: "Unlimited Fun · No Time Limits · Adventure Unlimited!". Legacy: "Pick Your Level of Play · Deluxe to Platinum!".
- **Two-column panel grid**: gap 28px, items stretch. Simplified: `grid-template-columns: 1.16fr 0.84fr`. Legacy: `2.1fr 0.9fr` (wider tickets panel for 3 cells). Below 1024px: single column. Each column is a flex column with 20px gap (main panel on top grows to fill, add-on grid below).

#### Tickets panel (left, white)
- Card: white, border-radius 25px, shadow `0 0 20px rgba(0,0,0,0.2)`. Hover: `translateY(-6px)` + deeper shadow `0 18px 36px rgba(0,0,0,0.18)`, 0.3s ease.
- Internal split: equal columns divided by 2px `#fdeaf5` vertical lines — 2 cells in simplified mode, 3 in legacy. Below 640px the cells stack with horizontal dividers. Cell padding: 32px horizontal (20px in legacy), 40px vertical, contents centered, flex column.
- **Cell anatomy** (top to bottom; fixed slot heights keep all CTAs in the section aligned horizontally):
  1. Title — 26px, weight 900, uppercase, tight tracking, line-height 1, `#383838`. **Titles, not buttons — no pill backgrounds.**
  2. Accent bar — 40×4px rounded-full bar, `#e50695`, margin 10px top / 28px bottom.
  3. Price slot — fixed 100px tall, contents vertically centered. Price: 72px (60px in legacy mode), weight 900, `#e50695`, line-height 1, no wrap. Cents superscript at 0.42em (e.g. $29⁹⁹).
  4. Descriptor — 20px, weight 800, uppercase, `#383838`.
  5. Body — `flex-grow: 1`. Simplified: one subline, 14px/600 `#6b7280`. Legacy: pink lead-in line (12px, weight 700, uppercase, letter-spacing wide, `#e50695`, margin-bottom 8px) + attraction list (14px, weight 600, `#4b5563`, relaxed line-height, centered, one attraction per line).
  6. CTA (see Interactions → CTA pills); margin-top 24px.
- **Simplified cells** (class `sp-only`):
  | Cell | Price | Descriptor | Subline | CTA |
  |---|---|---|---|---|
  | Unlimited Play | $29.99 | All Day Play Ticket | Every attraction. All day long. | outline |
  | Unlimited Play + (`gk-only`) | $39.99 | Includes Go-Karts | All Day Play, plus unlimited laps. | solid |
- **Legacy cells** (class `lg-only`; cumulative attraction lists):
  | Cell | Price | Descriptor | Lead-in | List (placeholder data) | CTA |
  |---|---|---|---|---|---|
  | Deluxe | $19.99 | Classic Thrills | Includes: | APEX Trampolines · Ultimate Dodgeball · Battle Beam · Tubes Playground · Runway (Tumble Track) · Kids Area 7 & Under | outline |
  | Ultimate | $23.99 | More Adventure | Everything in Deluxe, plus: | Climbing Walls · Warrior Course · Ropes Course · Tube Slides · Leap of Faith | outline |
  | Platinum | $29.99 | Every Attraction | Everything in Ultimate and Deluxe, plus: | Go-Kart Tracks · Sky Rider · Spin Zone Bumper Cars · Virtual Reality | solid |

#### Membership panel (right, pink)
- Card: background `#e50695`, same radius/shadow/hover as tickets panel. Same cell anatomy and slot heights.
- **Halftone texture**: absolutely-positioned overlay; `radial-gradient(rgba(255,255,255,0.18) 1.5px, transparent 1.5px)`, background-size 14px×14px, masked with `linear-gradient(115deg, black 0%, transparent 45%)` so dots fade out toward the lower right.
- Title "MONTHLY MEMBERSHIP" in `#e0e621`; accent bar `#e0e621`.
- Price row (inside the 100px slot, flex, gap 16px): "$19⁹⁹" 72px/900 `#e0e621` + "/mo" 24px/800; next to it the **HALF badge** (simplified mode only — hidden in legacy mode and when `data-half="off"`):
  - 100×100px circle. Outline drawn as an SVG: two semicircular arcs (radius 42 in a 100 viewBox, stroke `#e0e621`, width 3) with two triangular arrowheads (`53,86 53,98 41,92` and `47,2 47,14 59,8`) forming clockwise "chasing arrows".
  - Content centered, white: "HALF" 16px/900 + "the cost of Unlimited Play +" 9px/700 (use non-breaking spaces in "Unlimited Play +" so the + never wraps alone).
- Descriptor: "UNLIMITED VISITS, GO-KARTS INCLUDED!" white. Subline: "Plus member pricing on everything below." `rgba(255,255,255,0.85)`.
- CTA: member style (yellow).

#### Add-on cards (below each panel)
- Grid per column, 20px gap. Simplified mode: 2 columns; first two cards side by side, third spans both ("2 + wide"). Legacy mode: all cards stack full-width in BOTH columns (this keeps the two columns equal height so the CTAs above stay aligned). Below 480px: always single column.
- Card: height 112px, border-radius 25px, shadow as above, horizontal padding 24px, flex row, vertically centered, 16px gap. Name 16px/800 uppercase; description 12px/600 below it; price right-aligned 30px/900 with superscript cents, no wrap.
- **Ticket side (white cards + 4px solid `#e50695` bottom border, name `#383838`, desc `#6b7280`, price `#e50695`):**
  | Item | Description | Price |
  |---|---|---|
  | Shorty 40″ | For children 40″ & under. | $14.99 |
  | Parent Ticket | With purchase of a child's pass. | $14.99 |
  | Urban Air Socks | Urban Air Socks are required. | $3.99 |
- **Member side (pink `#e50695` cards, no bottom border, name white, desc `rgba(255,255,255,0.85)`, price `#e0e621`):**
  | Item | Description | Price |
  |---|---|---|
  | Shorty 40″ | For children 40″ & under. | $9.99 |
  | Parent Membership | With purchase of a child's pass. | $9.99 |
  | Urban Air Socks | Included on the initial visit. | FREE |
- **Fine print** below the grid: 11px, `#9ca3af`, centered, max-width 896px, margin-top 40px. Exact copy is in the HTML files.

### 2. Attractions Gallery (`section[data-purpose="attractions-gallery"]`)
- **Purpose**: Showcase the location's attractions; each tile links to its attraction detail page.
- Container: max-width 1280px, padding 24px/64px, white background. Header centered: eyebrow "EXPERIENCE THE THRILL" (same eyebrow style) + H2 "ATTRACTIONS GALLERY" 48px/900 uppercase `#383838`.
- Grid: 4 columns desktop / 2 columns mobile, gap 24px, `grid-auto-rows: 16rem`; every tile fills its grid area (`height: 100%`).
- **Featured tile** (first child, class `featured-card gk-only`): spans 2 columns × 2 rows. "FEATURED" pill top-left (pink bg, white, 12px/900 uppercase, padding 6px 16px, radius 50px, small shadow); attraction-name pill bottom-left (yellow `#e0e621` bg, `#383838`, 16px/900 uppercase, padding 8px 20px).
- **Regular tiles**: 16rem tall, border-radius 25px, shadow, image `object-fit: cover`; name pill bottom-left (yellow bg, 12px/900 uppercase, padding 4px 12px).
- **Hover overlay** (all tiles): `rgba(56,56,56,0.78)` fades in 0.3s; centered white description (14px/600; 18px on featured) + "LEARN MORE" link in `#e0e621`, 12px/700 uppercase (14px on featured), underline on hover.
- Footer CTA: "VIEW ALL ATTRACTIONS" pill (see CTA pills), centered, margin-top 48px.

## Interactions & Behavior
- **CTA pills** (all: border-radius 50px, weight 700, uppercase, letter-spacing ~0.05em, padding 14px, 3px border, width 100% capped at 240px, centered text, `transition: all 0.3s ease`):
  - *Outline (Unlimited Play; Deluxe; Ultimate)*: transparent bg, `#e50695` border + text → hover: pink bg, white text.
  - *Solid (Unlimited Play +; Platinum)*: pink bg, white text, pink border → hover: white bg, pink text, `scale(1.04)`.
  - *Join Now (member)*: `#e0e621` bg + border, `#383838` text → hover: white bg + border, `#e50695` text, `scale(1.04)`.
  - *View All Attractions (wide)*: auto width, padding 14px 48px, pink bg, white text, letter-spacing 0.1em, shadow → hover: yellow bg, `#383838` text, `scale(1.04)`.
- **Panel hover**: lift `translateY(-6px)` + deeper shadow (pricing panels only, not add-on cards).
- **Gallery tile hover**: dark overlay fade-in (above).
- **All links open in a new tab** (`target="_blank" rel="noopener"`).
- Link destinations:
  - All "Select Pass" CTAs (both models) → `https://store.unleashedbrands.com/urban-air/{location-slug}/purchase/ticket` (prototype uses `westlake-oh`; must be the page's location slug).
  - "Join Now" → `https://store.unleashedbrands.com/urban-air/{location-slug}/purchase/membership`.
  - Gallery "Learn More" → each attraction's detail page on urbanair.com (exact URLs in the HTML).
  - "View All Attractions" → `https://www.urbanair.com/attractions/`.

## Variant logic (location configuration)
Driven in the prototypes by `data-*` attributes on `<html>`; in production these are server-side conditions per location:
- **`data-model="simplified" | "legacy"`** — which pricing model the location uses:
  - `simplified`: shows the 2 `.sp-only` ticket cells (1 if Go-Karts off), panel grid `1.16fr 0.84fr`, add-ons in 2+wide, HALF badge eligible, header "UNLIMITED PLAY".
  - `legacy`: shows the 3 `.lg-only` tier cells, hides `.sp-only`, panel grid `2.1fr 0.9fr`, ticket-cell side padding 20px, price size 60px, HALF badge hidden, ALL add-on cards stacked full-width, header "TICKET OPTIONS".
- **`data-gokarts="off"`** (simplified-model locations without Go-Karts / Unlimited Play +):
  - Hide every `.gk-only` element: the Unlimited Play + cell (tickets panel becomes a single centered cell) and the featured Go-Karts gallery tile (grid reflows with no hole).
  - Panel grid becomes `1fr 1fr`.
  - Copy swaps (`.gk-on-text` / `.gk-off-text` spans): membership descriptor "Unlimited Visits, Go-Karts Included!" → "Unlimited Visits, Every Month!"; HALF badge "the cost of Unlimited Play +" → "the cost of Unlimited Play".
- **`data-half="off"`**: hides the HALF badge (`.half-badge`).
- **`data-addons="stacked"`** (optional alternative for simplified mode): add-on cards stack full-width instead of 2 + wide.

## State Management
None — the section is static content. The only dynamic inputs are per-location server-rendered values: pricing model, prices, location slug in purchase URLs, Go-Karts availability flag, tier-attraction lists, and the gallery attraction list.

## Data requirements
**All prices are placeholders.** Production values come from the location pricing feed: base/upgrade ticket or three tier prices, membership price, Shorty 40″, Parent, Socks (both retail and member values). **The legacy tier→attraction mapping is also placeholder data** — each location defines which attractions belong to Deluxe / Ultimate / Platinum (lists are cumulative: each tier lists only what it adds). The gallery (names, images, descriptions, detail URLs) comes from the location's attraction data.

## Design Tokens
- **Colors**: Pink (primary) `#e50695` · Yellow (accent) `#e0e621` · Charcoal `#383838` · Section bg `#f6f2f5` · Panel divider / ticket-side dividers `#fdeaf5` · Body gray text `#6b7280` · List text `#4b5563` · Fine print `#9ca3af` · White `#ffffff`. Per the 2026 UA style guide, **purple `#5d328c` is birthday-only** and is intentionally absent here. Teal `#88dbdf` and gold `#ffb600` are brand accents, unused in this section.
- **Typography**: Prototype uses **Montserrat** (Google Fonts, weights 400/600/700/800/900) as a stand-in for **Azo Sans**, the primary typeface in the 2026 style guide. If an Azo Sans web license is available, use it; otherwise keep Montserrat (the current site font). All headings/labels uppercase.
- **Type scale**: H1 60px/900 · H2 48px/900 · panel titles 26px/900 · big price 72px/900 (60px in legacy cells) · descriptors 20px/800 · tier lead-ins 12px/700 · tier lists 14px/600 · add-on price 30px/900 · add-on names 16px/800 · body/sublines 14px/600 · descriptions 12px/600 · eyebrows 14px/800 ls 0.25em · fine print 11px. Superscript cents: 0.42em of the price size.
- **Radii**: cards/panels/tiles 25px · pills/CTAs/badges 50px.
- **Shadows**: resting `0 0 20px rgba(0,0,0,0.2)` · panel hover `0 18px 36px rgba(0,0,0,0.18)`.
- **Spacing**: section pad 64px v / 24px h · panel gap 28px · column gap (panel↔add-ons) 20px · add-on grid gap 20px · gallery gap 24px · cell pad 40px/32px (40px/20px legacy).
- **Motion**: all transitions 0.3s ease; CTA hover scale 1.04.

## Assets
- **Attraction photos**: hotlinked from `https://www.urbanair.com/wp-content/uploads/...` (exact URLs in the HTML files) — already production CDN assets. Featured Go-Karts photo: `2018/03/go-karts-1600x900-1-1080x675.jpg`.
- **No logos in this section** (site header already has one). Official logo files exist in the design workspace (`uploads/`) if needed elsewhere.
- The halftone texture and HALF badge are pure CSS/inline-SVG — no image assets.

## Files
- `pricing-section-static.html` — clean static reference, both pricing models included (start here; flip `data-model` on `<html>` to preview each).
- `Simplified Pricing (tweakable).html` — same design with the review-only tweak harness.
- `tweaks-panel.jsx` — harness dependency; not for production.
