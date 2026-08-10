#!/usr/bin/env python
"""
Update fund holdings data (Overlap tab) from fmarket API.

For each equity/balanced open fund in fund_metadata.json, fetch:
  1. top holdings (stocks only, type_asset == 'STOCK')  -> <ID>_holdings.csv
  2. industry allocation (full)                          -> <ID>_industry.csv
and write holdings_index.json listing which funds have stock holdings and
their last update date.

Why direct fmarket API instead of vnstock: vnstock's community tier is
rate-limited to 60 requests/minute, and its top_holding() + industry_holding()
make 2 HTTP calls per fund. The fmarket endpoint /res/products/<id> returns
both lists in ONE response, no rate limiting on the public API. This is the
same source update_nav.mjs already uses (fmarket product API).

Output files (public/data/):
  <ID>_holdings.csv  -> date,stock_code,industry,weight_pct,type_asset
  <ID>_industry.csv  -> date,industry,weight_pct
  holdings_index.json -> [{id, update_at}]

Schema note: `date` column = report date. fmarket only exposes the latest
period today (no history). The schema already supports future periods —
when a source with monthly history appears, append rows with other dates,
no schema change needed.

Usage:  python -X utf8 scripts/update_holdings.py
"""

import os
import sys
import json
import time
import urllib.request

# ─── Config ────────────────────────────────────────────────

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
INDEX_FILE = os.path.join(DATA_DIR, 'holdings_index.json')
BASE_URL = 'https://api.fmarket.vn/res/products'
HEADERS = {'User-Agent': 'Mozilla/5.0 (VN-Funds-Dashboard/1.0)'}

# Fund types tracked for overlap: equity & balanced only. Bond funds hold
# bonds (not stocks), crypto/gold/etf have no stock holdings.
TRACKED_TYPES = {'mutual_fund', 'balanced'}


# ─── Helpers ───────────────────────────────────────────────

def fmt_pct(v):
    return round(float(v), 2)


def fetch_catalog():
    """Mirror of update_nav.mjs fetchFmarketCatalog: POST /res/products/filter,
    returns {shortName: id, code: id, dash-less: id} lookup."""
    body = json.dumps({
        'types': ['NEW_FUND', 'TRADING_FUND'],
        'issuerIds': [],
        'sortOrder': 'DESC',
        'sortField': 'navTo6Months',
        'page': 1,
        'pageSize': 200,
        'isIpo': False,
        'fundAssetTypes': [],
        'bondRemainPeriods': [],
        'searchField': '',
        'isBuyByReward': False,
        'thirdAppIds': [],
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://api.fmarket.vn/res/products/filter',
        data=body,
        headers={**HEADERS, 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        j = json.loads(resp.read().decode('utf-8'))
    rows = j.get('data') or {}
    rows = rows.get('rows') if isinstance(rows, dict) else rows
    catalog = {}
    for row in rows or []:
        for key in (row.get('shortName'), row.get('code')):
            if key:
                catalog[key.upper()] = row['id']
    return catalog


def fetch_fund(fmid):
    """GET /res/products/<id> → dict of product data."""
    url = f'{BASE_URL}/{fmid}'
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        j = json.loads(resp.read().decode('utf-8'))
    data = j.get('data') or {}
    if not data:
        raise ValueError(f'empty product data for id {fmid}')
    return data


def parse_date_ms(ts):
    """fmarket timestamps are ms epoch → YYYY-MM-DD (Asia/Ho_Chi_Minh)."""
    import datetime as dt
    if not ts:
        return ''
    # +07:00
    return (dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc) + dt.timedelta(hours=7)).strftime('%Y-%m-%d')


# ─── Main ─────────────────────────────────────────────────

def main():
    # Register vnstock API key if present (same pattern as update_vnstock.py).
    api_key = os.environ.get('VNSTOCK_API_KEY')
    if api_key:
        try:
            from vnstock import register_user
            register_user(api_key=api_key)
        except Exception as e:
            print(f'⚠️  vnstock register_user failed (non-fatal): {e}')

    # Load metadata
    meta_path = os.path.join(DATA_DIR, 'fund_metadata.json')
    with open(meta_path, encoding='utf-8') as fh:
        metadata = json.load(fh)

    funds = [f for f in metadata if f.get('type') in TRACKED_TYPES]
    print(f'\n📊 Update holdings — {len(funds)} equity/balanced funds\n')

    # Build normalized short_name → fmarket id via the catalog (same approach
    # as update_nav.mjs). Dashboard ids are dash-less (SSIEF, VCBFAIF); fmarket
    # short names may carry dashes (SSI-EF) — normalize both sides.
    catalog = fetch_catalog()
    id_to_fmid = {}
    for short, fid in catalog.items():
        id_to_fmid[short.replace('-', '').upper()] = fid

    index = []
    errors = []

    for fund in funds:
        fund_id = fund['id']
        holdings_path = os.path.join(DATA_DIR, f'{fund_id}_holdings.csv')
        industry_path = os.path.join(DATA_DIR, f'{fund_id}_industry.csv')

        fmid = id_to_fmid.get(fund_id.upper())
        if not fmid:
            print(f'⚠️  {fund_id}: not found in fmarket catalog — skipped')
            continue

        try:
            data = fetch_fund(fmid)

            top = data.get('productTopHoldingList') or []
            ind = data.get('productIndustriesHoldingList') or []

            # report date: prefer holding update time
            update_at = ''
            if top:
                update_at = parse_date_ms(top[0].get('updateAt'))
            elif ind:
                update_at = parse_date_ms(data.get('updateAt'))

            # ── top holdings (stocks only) ──
            stocks = [h for h in top if (h.get('type') or '').upper() == 'STOCK']
            if stocks:
                rows = []
                for h in stocks:
                    rows.append({
                        'date': update_at,
                        'stock_code': h.get('stockCode', ''),
                        'industry': h.get('industry', ''),
                        'weight_pct': fmt_pct(h.get('netAssetPercent', 0)),
                        'type_asset': 'STOCK',
                    })
                rows.sort(key=lambda r: r['weight_pct'], reverse=True)
                write_csv(holdings_path, ['date', 'stock_code', 'industry', 'weight_pct', 'type_asset'], rows)
            else:
                if os.path.exists(holdings_path):
                    os.remove(holdings_path)

            # ── industry allocation ──
            if ind:
                rows = []
                for h in ind:
                    rows.append({
                        'date': update_at,
                        'industry': h.get('industry', ''),
                        'weight_pct': fmt_pct(h.get('assetPercent', 0)),
                    })
                rows.sort(key=lambda r: r['weight_pct'], reverse=True)
                write_csv(industry_path, ['date', 'industry', 'weight_pct'], rows)
            else:
                if os.path.exists(industry_path):
                    os.remove(industry_path)

            if stocks:
                index.append({'id': fund_id, 'update_at': update_at})
                print(f'📈 {fund_id}: {len(stocks)} stocks / {len(ind)} industries @ {update_at or "?"}')
            else:
                print(f'✅ {fund_id}: no stock holdings (skipped)')

        except Exception as e:
            errors.append(f'{fund_id}: {e}')
            print(f'❌ {fund_id}: {e}')

        time.sleep(0.15)

    # ── write index ──
    index.sort(key=lambda r: r['id'])
    with open(INDEX_FILE, 'w', encoding='utf-8') as fh:
        json.dump(index, fh, ensure_ascii=False, indent=2)
        fh.write('\n')

    # ── summary ──
    print(f'\n{"─" * 60}')
    print(f'✅ {len(index)} funds with stock holdings → holdings_index.json')
    if errors:
        print(f'❌ {len(errors)} errors:')
        for e in errors:
            print(f'   {e}')
    print(f'{"─" * 60}\n')


def write_csv(path, header, rows):
    with open(path, 'w', encoding='utf-8', newline='') as fh:
        fh.write(','.join(header) + '\n')
        for r in rows:
            fh.write(','.join(str(r[c]) for c in header) + '\n')


if __name__ == '__main__':
    main()
