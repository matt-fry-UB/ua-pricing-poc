"""
UA Simplified Pricing QA Runner
================================
Fetches Command Center (CC API) and Website data for specified locations,
compares against Reference Values already in the QA Checklist, and writes
results to the Command Center, Website, and Mismatch columns.

Usage:
  python pricing_qa_runner.py --locations ohio-akron,ohio-westlake   # dry run
  python pricing_qa_runner.py --locations ohio-akron --execute        # write
  python pricing_qa_runner.py --all                                   # dry run all
  python pricing_qa_runner.py --all --execute                         # write all

Requires:
  - SMARTSHEET_ACCESS_TOKEN env var
  - Node.js with Playwright (msedge channel) installed
  - pricing_scrape.js in the same directory as this script
"""

import argparse
import decimal
import json
import os
import subprocess
import sys

import requests

from sp_qa_checklist_sync import (
    api, get_sheet, put_rows_batched, col_map, row_values,
    QA_SHEET_ID, QA_COL, REQUEST_PAUSE_SEC,
)

CC_API_BASE = "https://ua-pricing-poc.vercel.app/api"
SCRAPER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pricing_scrape.js")

# Items with no automated data in any source -- skip entirely
SKIP_ITEMS = {
    "Membership Attractions",
    "Ultimate to Unlimited (GTM)",
    "Small Squad Pop Up (GTM)",
}

# Items where CC has no value (website-only check)
CC_SKIP_ITEMS = {
    "$100/25% Off Birthday Promo",
    "$100/25% Off Birthday Promo Discount",
}


# ============================================================
# Formatting helpers
# ============================================================

def fmt_price(v):
    """Format a numeric price as '$X.XX', or return None."""
    if v is None:
        return None
    try:
        f = float(v)
        return f"${f:.2f}"
    except (TypeError, ValueError):
        return str(v) if v else None


def fmt_list(items):
    """Format a list as a sorted comma-separated string, or None."""
    if not items:
        return None
    return ", ".join(str(i) for i in sorted(items))


def round_price(v):
    """Round to 2dp using half-up (handles fractional ref values like 14.985 -> 14.99)."""
    try:
        return float(
            decimal.Decimal(str(v)).quantize(
                decimal.Decimal("0.01"), rounding=decimal.ROUND_HALF_UP
            )
        )
    except Exception:
        return None


def norm_for_compare(v):
    """Normalise a value for comparison: strip $, round prices to 2dp, lowercase text."""
    if v is None or v == "":
        return None
    s = str(v).replace("$", "").strip()
    rounded = round_price(s)
    if rounded is not None:
        return rounded
    return s.lower()


# ============================================================
# CC API
# ============================================================

def fetch_cc(wp_slug):
    url = f"{CC_API_BASE}/location?slug={wp_slug}"
    try:
        resp = requests.get(url, timeout=30)
        return resp.json() if resp.ok else None
    except Exception as e:
        print(f"  CC API error for {wp_slug}: {e}")
        return None


def map_cc_to_qa(cc):
    """Map CC API response dict -> {qa_item_name: formatted_value}."""
    p = cc.get("pricing", {})
    b = cc.get("birthday", {})
    out = {}

    # Tickets
    tickets = {t["name"]: t["price"] for t in p.get("tickets", [])}
    out["Unlimited Play Ticket"]   = fmt_price(tickets.get("Unlimited Play"))
    out["Unlimited Play + Ticket"] = fmt_price(tickets.get("Unlimited Play +"))
    out["Has Unlimited Play +?"]   = "Yes" if p.get("goKartsIncluded") else "No"

    secondary = {t["name"]: t["price"] for t in p.get("secondaryTickets", [])}
    out["Parent Pass"] = fmt_price(secondary.get("Parent"))
    out["Shorty 40"]   = fmt_price(secondary.get("Shorty 40"))

    merch = {m["name"]: m["price"] for m in p.get("merch", [])}
    out["Socks"] = fmt_price(merch.get("Urban Air Socks"))

    # Birthday packages
    pkg_list = b.get("packages", [])
    pkg_by_id = {pkg["productLevelId"]: pkg for pkg in pkg_list}
    # Main package = productLevelId 4 (Unlimited Play); fallback = highest price
    main_pkg = pkg_by_id.get(4) or (
        max(pkg_list, key=lambda x: x.get("minCombinedPrice", 0)) if pkg_list else None
    )
    small_pkg = pkg_by_id.get(1)

    out["Unlimited Play Birthday"] = fmt_price(main_pkg["minCombinedPrice"] if main_pkg else None)
    out["Small Squad Promo Price"] = fmt_price(small_pkg["minCombinedPrice"] if small_pkg else None)

    if main_pkg:
        attrs = fmt_list(a["name"] for a in main_pkg.get("attractions", []))
        out["Ticket Attractions"]   = attrs
        out["Birthday Attractions"] = attrs

    # Hangouts
    hangouts = {h["name"]: h for h in b.get("hangouts", [])}
    pr    = hangouts.get("Private Room")
    vip   = hangouts.get("VIP Suite")
    table = hangouts.get("Table")

    out["Private Room"]           = fmt_price(pr["price"] if pr else None)
    out["Private Room Amenities"] = fmt_list(pr["amenities"]) if pr else None
    out["VIP Suite"]              = fmt_price(vip["price"] if vip else None)
    out["VIP Suite Amenities"]    = fmt_list(vip["amenities"]) if vip else None

    # Small Squad Promo: Table hangout must list "Shared Party Host"
    if table:
        host_found = any(
            "shared party host" in a.lower() for a in table.get("amenities", [])
        )
        out["Small Squad Promo"] = "shared party host" if host_found else None

    # Memberships
    for m in p.get("memberships", []):
        n = m["name"]
        if "Unlimited Play" in n and "+" not in n:
            out["Unlimited Play Membership"] = fmt_price(m["price"])
        elif "Shorty" in n:
            out["Shorty 40 Membership"] = fmt_price(m["price"])
        elif "Parent Pass" in n:
            out["Parent Pass Membership"] = fmt_price(m["price"])

    return out


# ============================================================
# Website scraper
# ============================================================

def run_scraper(targets):
    """Shell out to pricing_scrape.js; return {location_name: scrape_dict}."""
    loc_arg = json.dumps([{"name": t["name"], "wpSlug": t["wp_slug"]} for t in targets])
    try:
        result = subprocess.run(
            ["node", SCRAPER_PATH, loc_arg],
            capture_output=True, text=True, timeout=600,
        )
    except FileNotFoundError:
        sys.exit("ERROR: 'node' not found. Ensure Node.js is installed and on PATH.")

    if result.returncode != 0:
        print(f"  Scraper stderr: {result.stderr[:500]}")

    out = {}
    for line in result.stdout.strip().splitlines():
        try:
            d = json.loads(line)
            out[d["location"]] = d
        except (json.JSONDecodeError, KeyError):
            pass
    return out


def map_web_to_qa(scrape):
    """Map scraper output dict -> {qa_item_name: formatted_value}."""
    tix  = scrape.get("tickets",    {})
    bday = scrape.get("birthday",   {})
    off  = scrape.get("offers",     {})
    mem  = scrape.get("membership", {})
    out  = {}

    # Tickets page
    pkgs = tix.get("packages", {})
    out["Unlimited Play Ticket"]   = pkgs.get("Unlimited Play")
    out["Unlimited Play + Ticket"] = pkgs.get("Unlimited Play +")
    out["Has Unlimited Play +?"]   = "Yes" if "Unlimited Play +" in pkgs else "No"

    for label, v in tix.get("features", {}).items():
        if "shorty" in label.lower():
            out["Shorty 40"] = v
        elif "parent" in label.lower():
            out["Parent Pass"] = v

    out["Socks"] = tix.get("socks")
    attrs = tix.get("attractions", [])
    out["Ticket Attractions"] = fmt_list(attrs) if attrs else None

    # Birthday page
    b_pkgs = bday.get("packages", {})
    out["Unlimited Play Birthday"] = (
        b_pkgs.get("Unlimited Play") or b_pkgs.get("Unlimited Play +")
    )

    b_attrs = bday.get("attractions", [])
    out["Birthday Attractions"] = fmt_list(b_attrs) if b_attrs else None

    venues = bday.get("venues", {})
    pr  = venues.get("Private Room", {})
    vip = venues.get("VIP Suite",    {})
    out["Private Room"]           = pr.get("price")
    out["Private Room Amenities"] = fmt_list(pr["amenities"]) if pr.get("amenities") else None
    out["VIP Suite"]              = vip.get("price")
    out["VIP Suite Amenities"]    = fmt_list(vip["amenities"]) if vip.get("amenities") else None

    # PARTY-TIME / SAVE-100: must pass on BOTH birthday and offers pages
    bday_pass  = bday.get("partyTimeFound", False) and not bday.get("save100Found", False)
    offers_pass = off.get("partyTimeFound", False) and not off.get("save100Found", False)
    if bday_pass and offers_pass:
        out["$100/25% Off Birthday Promo"] = "PARTY-TIME"
    else:
        issues = []
        if not bday.get("partyTimeFound"):  issues.append("PARTY-TIME missing on birthday")
        if bday.get("save100Found"):        issues.append("SAVE-100 on birthday")
        if not off.get("partyTimeFound"):   issues.append("PARTY-TIME missing on offers")
        if off.get("save100Found"):         issues.append("SAVE-100 on offers")
        out["$100/25% Off Birthday Promo"] = "FAIL: " + "; ".join(issues)

    out["$100/25% Off Birthday Promo Discount"] = bday.get("promoDiscount")

    host_found = bday.get("smallSquadHostFound") or off.get("smallSquadHostFound")
    out["Small Squad Promo"]       = "shared party host" if host_found else None
    out["Small Squad Promo Price"] = off.get("smallSquadPrice")

    # Membership page
    out["Unlimited Play Membership"] = mem.get("upPrice")
    out["Shorty 40 Membership"]      = mem.get("shortyPrice")
    out["Parent Pass Membership"]    = mem.get("parentPrice")

    return out


# ============================================================
# Comparison
# ============================================================

def build_mismatch(item_name, ref_val, cc_val, web_val):
    """Return a mismatch description string, or None if everything agrees."""
    if item_name in SKIP_ITEMS:
        return None

    # List-type items: compare as sets, report symmetric difference
    def is_list(v):
        return v and ", " in str(v)

    if is_list(cc_val) or is_list(web_val):
        cc_set  = set(str(cc_val).split(", "))  if cc_val  else set()
        web_set = set(str(web_val).split(", ")) if web_val else set()
        if cc_set and web_set and cc_set != web_set:
            cc_only  = sorted(cc_set  - web_set)
            web_only = sorted(web_set - cc_set)
            parts = []
            if cc_only:
                sample = cc_only[:2]
                parts.append(f"CC only: {', '.join(sample)}" +
                             (f" (+{len(cc_only)-2} more)" if len(cc_only) > 2 else ""))
            if web_only:
                sample = web_only[:2]
                parts.append(f"Web only: {', '.join(sample)}" +
                             (f" (+{len(web_only)-2} more)" if len(web_only) > 2 else ""))
            return "; ".join(parts)
        return None

    ref_n = norm_for_compare(ref_val)
    cc_n  = norm_for_compare(cc_val)  if item_name not in CC_SKIP_ITEMS else None
    web_n = norm_for_compare(web_val)

    issues = []
    if ref_n is not None:
        if cc_n  is not None and cc_n  != ref_n:
            issues.append(f"CC {cc_val} vs Ref {ref_val}")
        if web_n is not None and web_n != ref_n:
            issues.append(f"Web {web_val} vs Ref {ref_val}")
    elif cc_n is not None and web_n is not None and cc_n != web_n:
        issues.append(f"CC {cc_val} vs Web {web_val}")

    return "; ".join(issues) if issues else None


# ============================================================
# Main
# ============================================================

def run(location_slugs, execute):
    qa_sheet = get_sheet(QA_SHEET_ID)
    cols = col_map(qa_sheet)

    # Resolve column IDs by title
    wp_col  = cols.get("WP Slug")
    cc_col  = cols.get("Command Center")
    web_col = cols.get("Website")
    mis_col = cols.get("Mismatch")
    ref_col = QA_COL["ref"]
    item_col = QA_COL["qa_item"]
    loc_col  = QA_COL["location_ref"]
    task_col = QA_COL["task"]

    missing_cols = [t for t, c in [("WP Slug", wp_col), ("Command Center", cc_col),
                                    ("Website", web_col), ("Mismatch", mis_col)] if not c]
    if missing_cols:
        sys.exit(f"ERROR: QA sheet is missing columns: {missing_cols}")

    # Single pass: build parent map and child map together
    all_rows = row_values(qa_sheet)
    parents = {}          # name -> {row_id, wp_slug}
    parent_id_to_name = {}
    children_by_loc = {}  # name -> {qa_item: row_dict}

    for r in all_rows:
        if r["_parent_id"] is None:
            name = r.get(task_col)
            if not name:
                continue
            parents[name] = {"row_id": r["_row_id"], "wp_slug": r.get(wp_col)}
            parent_id_to_name[r["_row_id"]] = name
        else:
            loc_name = r.get(loc_col) or parent_id_to_name.get(r["_parent_id"])
            if not loc_name:
                continue
            item_name = r.get(item_col) or r.get(task_col)
            if item_name:
                children_by_loc.setdefault(loc_name, {})[item_name] = r

    # Resolve target locations
    if location_slugs == ["all"]:
        targets = [
            {"name": n, "wp_slug": info["wp_slug"]}
            for n, info in parents.items()
            if info.get("wp_slug")
        ]
    else:
        slug_to_name = {
            info["wp_slug"]: n for n, info in parents.items() if info.get("wp_slug")
        }
        targets = []
        for slug in location_slugs:
            name = slug_to_name.get(slug)
            if not name:
                print(f"  WARNING: '{slug}' not found in QA sheet (no WP Slug match), skipping")
            else:
                targets.append({"name": name, "wp_slug": slug})

    if not targets:
        sys.exit("No matching locations found.")

    print(f"Locations to process ({len(targets)}): {', '.join(t['name'] for t in targets)}")
    print("Running website scraper...")
    web_results = run_scraper(targets)
    if not web_results:
        print("WARNING: scraper returned no results.")

    all_updates = []

    for loc in targets:
        name    = loc["name"]
        wp_slug = loc["wp_slug"]
        print(f"\n--- {name} ({wp_slug}) ---")

        # CC data
        cc_raw = fetch_cc(wp_slug)
        cc_qa  = map_cc_to_qa(cc_raw) if cc_raw else {}
        if not cc_raw:
            print(f"  WARNING: CC API returned nothing for {wp_slug}")

        # Website data
        web_raw = web_results.get(name, {})
        web_qa  = map_web_to_qa(web_raw) if web_raw else {}
        if not web_raw:
            print(f"  WARNING: scraper returned nothing for {name}")

        items = children_by_loc.get(name, {})
        if not items:
            print(f"  WARNING: no child rows found for {name}")
            continue

        for item_name, row in items.items():
            if item_name in SKIP_ITEMS:
                continue

            ref_val = row.get(ref_col)
            cc_val  = cc_qa.get(item_name)  if item_name not in CC_SKIP_ITEMS else None
            web_val = web_qa.get(item_name)

            mismatch = build_mismatch(item_name, ref_val, cc_val, web_val)

            cells = []
            if cc_val is not None:
                cells.append({"columnId": cc_col, "value": str(cc_val)})
            if web_val is not None:
                cells.append({"columnId": web_col, "value": str(web_val)})
            # Always write mismatch to clear stale values from previous runs
            cells.append({"columnId": mis_col, "value": mismatch or ""})

            if cells:
                all_updates.append({"id": row["_row_id"], "cells": cells})

            if mismatch:
                print(f"  MISMATCH  {item_name}: {mismatch}")

    print(f"\nTotal row updates queued: {len(all_updates)}")
    if not execute:
        print("DRY RUN -- re-run with --execute to write.")
        return

    put_rows_batched(all_updates)
    print("Done.")


# ============================================================
if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    grp = ap.add_mutually_exclusive_group(required=True)
    grp.add_argument("--locations",
                     help="Comma-separated WP slugs, e.g. ohio-akron,ohio-westlake")
    grp.add_argument("--all", action="store_true",
                     help="Process every location in the QA sheet that has a WP Slug")
    ap.add_argument("--execute", action="store_true",
                    help="Write changes to Smartsheet (default is dry run)")
    args = ap.parse_args()

    slugs = ["all"] if args.all else [s.strip() for s in args.locations.split(",")]
    run(slugs, args.execute)
