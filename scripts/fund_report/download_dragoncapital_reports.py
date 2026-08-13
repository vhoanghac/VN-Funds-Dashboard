#!/usr/bin/env python
"""
Download monthly open-end fund reports from dragoncapital.com.vn into raw/.

The site's document archive is a Salesforce Lightning page. Monthly reports
have been named several ways on Azure Blob over the years:
  - <FUND>_BC_THANG_<MM><YYYY>.xlsx               (2024-08 onwards, no prefix)
  - <id>_<FUND>_BC_Thang_<MM><YYYY>.xlsx          (~2022-2024, numeric prefix)
  - <id>_VFMVF1_BC_Thang_<MM><YYYY>.xlsx          (~2018-2019, old fund name)
The numeric prefix is a CMS content id and cannot be guessed, so this script
enumerates the page (year filter + scroll) instead of probing URLs.

Every saved file is normalized to the <FUND>_<YYYY>_<MM>.xlsx convention
(e.g. DCDS_2026_07.xlsx), regardless of the naming era it came from. Old
fund names (VFMVF1 for DCDS) map to the current fund id.

Usage:
  python scripts/fund_report/download_dragoncapital_reports.py                      # DCDS, all years
  python scripts/fund_report/download_dragoncapital_reports.py --fund DCDS --url <product-page>
  python scripts/fund_report/download_dragoncapital_reports.py --start-year 2024 --end-year 2026

Idempotent: existing <FUND>_YYYY_MM.xlsx files are skipped; old-named files
already in raw/ are renamed to the new convention (duplicates by size are
dropped).

Depends on: playwright + requests (already installed on the dev machine).
"""

import argparse
import re
import sys
import time
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT / "public" / "data"

BLOB_HOST = "dragoncapitalprod.blob.core.windows.net"
DEFAULT_URL = (
    "https://www.dragoncapital.com.vn/individual/vi/product/"
    "a0eJ2000001X9btIAC/dcds#documents"
)

# Old fund names -> current fund id. VFMVF1 was DCDS before the rename.
ALIASES = {
    "DCDS": ["DCDS", "VFMVF1"],
}

# Monthly report file name, any era: [<id>_] <FUND> _BC_ (THANG|Thang) _ <MM><YYYY> .xlsx
REPORT_RE = re.compile(
    r"(?:^|_)([A-Z0-9]+)_BC_(?:THANG|Thang)_(\d{6})\.xlsx$",
    re.IGNORECASE,
)

MIN_SIZE = 50 * 1024  # a real Thong tu 98 report is ~100-400 KB

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    )
}

SHADOW_URLS_JS = """
() => {
  const urls = new Set();
  (function walk(root) {
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of all) {
      if (el.shadowRoot) walk(el.shadowRoot);
    }
    for (const a of root.querySelectorAll ? root.querySelectorAll('a') : []) {
      const h = a.href || '';
      if (h.includes('blob.core.windows.net')) urls.add(h);
    }
  })(document);
  return Array.from(urls);
}
"""

SCROLL_ALL_JS = """
() => {
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollHeight > el.clientHeight + 10) el.scrollTop = el.scrollHeight;
  }
  window.scrollTo(0, document.body.scrollHeight);
}
"""


def find_chromium():
    """Reuse a locally installed Playwright chromium instead of re-downloading."""
    base = Path.home() / "AppData" / "Local" / "ms-playwright"
    if not base.exists():
        return None
    for pat in (
        "chromium-*/chrome-win64/chrome.exe",
        "chromium-*/chrome-win/chrome.exe",
        "chromium_headless_shell-*/chrome-headless-shell-win64/chrome-headless-shell.exe",
    ):
        hits = sorted(base.glob(pat))
        if hits:
            return str(hits[-1])
    return None


def normalize_raw_dir(fund, raw_dir):
    """Rename old-named files to <FUND>_<YYYY>_<MM>.xlsx; drop exact dups."""
    aliases = ALIASES.get(fund, [fund])
    renamed = deduped = 0
    for f in sorted(raw_dir.iterdir()):
        if f.suffix.lower() != ".xlsx":
            continue
        m = REPORT_RE.search(f.name)
        if not m or m.group(1).upper() not in aliases:
            continue
        digits = m.group(2)
        target = raw_dir / f"{fund}_{digits[2:]}_{digits[:2]}.xlsx"
        if f == target:
            continue
        if target.exists():
            if target.stat().st_size == f.stat().st_size:
                f.unlink()
                deduped += 1
            else:
                print(f"  [warn] {f.name} and {target.name} differ, keeping both")
        else:
            f.rename(target)
            renamed += 1
            print(f"  rename {f.name} -> {target.name}")
    return renamed, deduped


def collect_year_links(page):
    """All blob URLs rendered for the currently selected year."""
    return set(page.evaluate(SHADOW_URLS_JS))


def year_options(page):
    """Visible year options in the open 'Năm' dropdown."""
    opts = []
    for li in page.locator("li[role='option'], [role='option'], li").all():
        try:
            txt = (li.inner_text() or "").strip()
        except Exception:
            continue
        if re.fullmatch(r"\d{4}", txt):
            opts.append((int(txt), li))
    return opts


def select_year(page, year):
    """Open the 'Năm' filter and pick the given year; return True if found."""
    for _attempt in range(2):
        try:
            page.get_by_role("textbox", name="Năm").click(timeout=8000)
        except Exception:
            return False
        page.wait_for_timeout(600)
        for y, li in year_options(page):
            if y == year:
                li.click()
                return True
        # dropdown may have toggled closed; close firmly and retry
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    return False


def scrape_year(page, year):
    """Select year, scroll until stable, return all monthly report URLs."""
    if not select_year(page, year):
        print(f"  year {year}: not available, skipped")
        return set()
    page.wait_for_timeout(1500)
    seen = set()
    for _ in range(12):
        page.evaluate(SCROLL_ALL_JS)
        page.wait_for_timeout(700)
        urls = collect_year_links(page)
        monthlies = {u for u in urls if REPORT_RE.search(u.rsplit("/", 1)[-1])}
        if monthlies == seen:
            break
        seen = monthlies
    print(f"  year {year}: {len(seen)} monthly report link(s)")
    return seen


def add_no_prefix_urls(found, fund, raw_dir, start_yy, end_yy):
    """Complement page scraping: probe the no-prefix blob patterns for gaps.

    The no-prefix era (2024-08 onwards) uses <FUND>_BC_(THANG|Thang)_<MM><YYYY>.
    Page scraping can miss a month if the list does not fully load, so probe
    both casings directly for every month not already present.
    """
    added = 0
    for yy in range(start_yy, end_yy + 1):
        for mm in range(1, 13):
            key = (str(yy), f"{mm:02d}")
            if key in found:
                continue
            if (raw_dir / f"{fund}_{yy}_{mm:02d}.xlsx").exists():
                continue
            for casing in ("THANG", "Thang"):
                url = f"https://{BLOB_HOST}/cms1public/{fund}_BC_{casing}_{mm:02d}{yy}.xlsx"
                try:
                    r = requests.head(url, headers=HEADERS, timeout=15)
                except Exception:
                    continue
                if r.status_code == 200:
                    found[key] = url
                    added += 1
                    break
    if added:
        print(f"  direct probe added {added} report URL(s)")
    return found


def download(url, target):
    """Download to target; return True on success."""
    r = requests.get(url, headers=HEADERS, timeout=60)
    if r.status_code != 200:
        return False
    data = r.content
    if len(data) < MIN_SIZE or not data.startswith(b"PK\x03\x04"):
        print(f"    [bad] {target.name}: {len(data)} bytes, not a valid xlsx")
        return False
    target.write_bytes(data)
    return True


def main():
    ap = argparse.ArgumentParser(description="Download monthly fund reports from dragoncapital.com.vn")
    ap.add_argument("--fund", default="DCDS", help="fund id (default DCDS)")
    ap.add_argument("--url", default=DEFAULT_URL, help="product documents page")
    ap.add_argument("--start-year", type=int, default=None, help="oldest year to fetch")
    ap.add_argument("--end-year", type=int, default=None, help="newest year to fetch")
    args = ap.parse_args()

    raw_dir = DATA_DIR / args.fund / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    aliases = ALIASES.get(args.fund, [args.fund])

    print(f"== normalize {raw_dir}")
    renamed, deduped = normalize_raw_dir(args.fund, raw_dir)
    print(f"  renamed {renamed}, deduped {deduped}")

    print(f"== scrape {args.fund}")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=find_chromium())
        page = browser.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2000)

        # discover available years from the 'Năm' dropdown
        page.get_by_role("textbox", name="Năm").click(timeout=8000)
        page.wait_for_timeout(600)
        years = {y for y, _li in year_options(page)}
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        if not years:
            print("  could not read year options", file=sys.stderr)
            browser.close()
            sys.exit(1)
        print(f"  years available: {sorted(years)}")

        end = args.end_year or max(years)
        start = args.start_year or min(years)
        year_range = [y for y in range(end, start - 1, -1) if y in years]

        found = {}
        for y in year_range:
            for u in scrape_year(page, y):
                name = u.rsplit("/", 1)[-1]
                m = REPORT_RE.search(name)
                if m and m.group(1).upper() in aliases:
                    found[(m.group(2)[2:], m.group(2)[:2])] = u  # (YYYY, MM) -> url
        browser.close()

    found = add_no_prefix_urls(found, args.fund, raw_dir, start, end)
    print(f"== unique monthly reports found: {len(found)}")
    downloaded = skipped = failed = 0
    for (yy, mm), url in sorted(found.items()):
        target = raw_dir / f"{args.fund}_{yy}_{mm}.xlsx"
        if target.exists():
            skipped += 1
            continue
        if download(url, target):
            downloaded += 1
            print(f"  + {target.name}")
        else:
            failed += 1
            print(f"  ! failed {target.name} ({url})")

    print("== summary")
    print(f"  downloaded {downloaded}, already present {skipped}, failed {failed}")
    print(f"  raw/ now holds {len(list(raw_dir.glob('*.xlsx')))} xlsx files")


if __name__ == "__main__":
    main()
