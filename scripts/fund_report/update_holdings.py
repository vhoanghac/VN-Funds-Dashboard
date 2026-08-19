#!/usr/bin/env python
"""
Update fund holdings data (Overlap tab) from fmarket API.

For each equity/balanced open fund in fund_metadata.json, fetch:
  1. top holdings (stocks only, type_asset == 'STOCK')  -> holdings/<ID>_holdings.csv
  2. industry allocation (full)                          -> holdings/<ID>_industry.csv
and write holdings_index.json listing which funds have stock holdings and
their last update date.

Why direct fmarket API instead of vnstock: vnstock's community tier is
rate-limited to 60 requests/minute, and its top_holding() + industry_holding()
make 2 HTTP calls per fund. The fmarket endpoint /res/products/<id> returns
both lists in ONE response, no rate limiting on the public API. This is the
same source update_nav.mjs already uses (fmarket product API).

Output files (public/data/holdings/):
  <ID>_holdings.csv  -> date,stock_code,industry,weight_pct,type_asset
  <ID>_industry.csv  -> date,industry,weight_pct
  holdings_index.json -> [{id, update_at}]

History: `date` column = REPORT PERIOD (fundReport.reportTime), not the daily
update timestamp. Holdings only change per reporting period, so we APPEND one
snapshot per new period and skip periods already present — this accumulates a
monthly history of each fund's portfolio. fmarket only exposes the latest
period when first enabled, so history starts from today (no backfill).

Usage:  python -X utf8 scripts/fund_report/update_holdings.py
"""

import os
import sys
import json
import time
import urllib.request

# ─── Config ────────────────────────────────────────────────

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'data')
HOLDINGS_DIR = os.path.join(DATA_DIR, 'holdings')
INDEX_FILE = os.path.join(DATA_DIR, 'holdings_index.json')
BASE_URL = 'https://api.fmarket.vn/res/products'
HEADERS = {'User-Agent': 'Mozilla/5.0 (VN-Funds-Dashboard/1.0)'}

# Fund types tracked for overlap: equity, balanced & bond. Bond funds (DCBF...)
# have no stock holdings; update_holdings only records their fmarket top-10 when
# the API returns one. digiinvest backfill is the richer source for bond funds.
TRACKED_TYPES = {'mutual_fund', 'balanced', 'bond'}


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
    os.makedirs(HOLDINGS_DIR, exist_ok=True)

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

    # Load existing index so funds whose period is already recorded (skipped
    # this run) are NOT dropped when we rewrite the index below.
    if os.path.exists(INDEX_FILE):
        try:
            with open(INDEX_FILE, encoding='utf-8') as fh:
                index = json.load(fh)
        except Exception:
            index = []

    for fund in funds:
        fund_id = fund['id']
        holdings_path = os.path.join(HOLDINGS_DIR, f'{fund_id}_holdings.csv')
        industry_path = os.path.join(HOLDINGS_DIR, f'{fund_id}_industry.csv')

        # Funds backed by official fund reports (source 'report', written by
        # fund_reports_to_holdings.py) are NOT fmarket's to append to: the report
        # portfolio is the authoritative source. A fmarket top-10 snapshot for a
        # NEW period would mix two sources and show an incomplete portfolio.
        if any(e.get('source') == 'report' for e in index if e.get('id') == fund_id):
            print(f'⏭️  {fund_id}: source=report (official fund reports) — fmarket skipped')
            continue

        fmid = id_to_fmid.get(fund_id.upper())
        if not fmid:
            print(f'⚠️  {fund_id}: not found in fmarket catalog — skipped')
            continue

        try:
            data = fetch_fund(fmid)

            top = data.get('productTopHoldingList') or []
            ind = data.get('productIndustriesHoldingList') or []

            # Report PERIOD (fundReport.reportTime) — holdings are a snapshot at
            # the end of this period. Funds without a report period yet (brand-new,
            # no published report) are SKIPPED entirely: falling back to the daily
            # update timestamp would append a near-identical snapshot every day and
            # bloat the file.
            fr = data.get('fundReport') or {}
            report_period = parse_date_ms(fr.get('reportTime'))
            if not report_period:
                print(f'✅ {fund_id}: no report period yet — skipped')
                continue

            # ── top holdings (stocks only) — cần sớm để so chữ ký trong nhánh skip ──
            stocks = [h for h in top if (h.get('type') or '').upper() == 'STOCK']

            # ── skip if this period already recorded ──
            existing = read_csv_dates(holdings_path)
            if report_period in existing:
                # File đã có dữ liệu kỳ này — quỹ vẫn có holdings, chỉ không append
                # lại. Upsert index để không bị mất khỏi danh sách. Giữ nguyên
                # `source` nếu có (digiinvest backfill); quỹ mới → 'fmarket'.
                idx_entry = next((e for e in index if e['id'] == fund_id), None)
                if idx_entry:
                    idx_entry['update_at'] = report_period
                    idx_entry.setdefault('source', 'fmarket')
                else:
                    index.append({'id': fund_id, 'update_at': report_period, 'source': 'fmarket'})

                # Cảnh báo (không ghi đè): nếu holdings HIỆN TẠI khác bản đang lưu
                # trong khi reportTime không đổi, tức quỹ đã sửa lại báo cáo giữa
                # kỳ — chúng ta cố tình bỏ qua (phương án A), chỉ log để người dùng
                # biết. So sánh bằng chữ ký (stock_code + weight_pct) sắp xếp.
                #
                # Từ 11/08/2026, các quỹ đã được backfill bởi digiinvest với danh
                # mục ĐẦY ĐỦ (44 cổ phiếu) trong khi fmarket chỉ trả top-10. Khi số
                # lượng khác nhau như vậy thì không phải quỹ sửa giữa kỳ mà là hai
                # nguồn khác nhau — bỏ cảnh báo để không báo giả mỗi ngày.
                if stocks:
                    current = signature(stocks)
                    stored = read_holdings_signature(holdings_path, report_period)
                    if stored and len(stored) == len(current) and current != stored:
                        print(f'⚠️  {fund_id}: holdings CHANGED for period {report_period} but reportTime unchanged — skipped (would be missed revision). Run investigate if unexpected.')
                print(f'✅ {fund_id}: period {report_period} already recorded — skipped')
                continue

            if stocks:
                rows = []
                for h in stocks:
                    rows.append({
                        'date': report_period,
                        'stock_code': h.get('stockCode', ''),
                        'industry': h.get('industry', ''),
                        'weight_pct': fmt_pct(h.get('netAssetPercent', 0)),
                        'asset_value': int(round(h.get('assetValue', 0) or 0)),
                        'type_asset': 'STOCK',
                    })
                rows.sort(key=lambda r: r['weight_pct'], reverse=True)
                append_csv(holdings_path, ['date', 'stock_code', 'industry', 'weight_pct', 'asset_value', 'type_asset'], rows)
            else:
                if os.path.exists(holdings_path):
                    os.remove(holdings_path)

            # ── industry allocation ──
            if ind:
                rows = []
                for h in ind:
                    rows.append({
                        'date': report_period,
                        'industry': h.get('industry', ''),
                        'weight_pct': fmt_pct(h.get('assetPercent', 0)),
                    })
                rows.sort(key=lambda r: r['weight_pct'], reverse=True)
                append_csv(industry_path, ['date', 'industry', 'weight_pct'], rows)
            else:
                if os.path.exists(industry_path):
                    os.remove(industry_path)

            if stocks:
                # Upsert: quỹ đã có entry (từ lần chạy cũ) thì cập nhật update_at,
                # chưa có thì thêm mới. Không append trùng id. Giữ `source` cũ nếu
                # có (digiinvest backfill); quỹ mới → 'fmarket'.
                idx_entry = next((e for e in index if e['id'] == fund_id), None)
                if idx_entry:
                    idx_entry['update_at'] = report_period
                    idx_entry.setdefault('source', 'fmarket')
                else:
                    index.append({'id': fund_id, 'update_at': report_period, 'source': 'fmarket'})
                print(f'📈 {fund_id}: +{len(stocks)} stocks / {len(ind)} industries @ {report_period}')
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


def read_csv_dates(path):
    """Tập hợp các `date` (kỳ báo cáo) đã có trong file CSV. Rỗng nếu chưa có file."""
    if not os.path.exists(path):
        return set()
    with open(path, encoding='utf-8') as fh:
        header = fh.readline().strip().split(',')
        try:
            idx = header.index('date')
        except ValueError:
            return set()
        dates = set()
        for line in fh:
            cells = line.strip().split(',')
            if len(cells) > idx and cells[idx]:
                dates.add(cells[idx])
        return dates


def signature(stocks):
    """Chữ ký holdings: (stock_code, weight_pct) sắp xếp — để so khác biệt giữa 2 bản."""
    return tuple(sorted((h.get('stockCode', ''), round(float(h.get('netAssetPercent', 0)), 2)) for h in stocks))


def read_holdings_signature(path, period):
    """Đọc holdings của một kỳ trong file CSV → chữ ký. None nếu file/kỳ không tồn tại."""
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as fh:
        header = fh.readline().strip().split(',')
        try:
            idx_date = header.index('date')
            idx_code = header.index('stock_code')
            idx_w = header.index('weight_pct')
        except ValueError:
            return None
        pairs = []
        for line in fh:
            cells = line.strip().split(',')
            if len(cells) <= max(idx_date, idx_code, idx_w):
                continue
            if cells[idx_date] != period:
                continue
            try:
                pairs.append((cells[idx_code], round(float(cells[idx_w]), 2)))
            except ValueError:
                continue
    if not pairs:
        return None
    return tuple(sorted(pairs))


def append_csv(path, header, rows):
    """Append snapshot cho kỳ mới xuống cuối file (giữ các kỳ cũ). Tạo header nếu file mới."""
    existed = os.path.exists(path) and os.path.getsize(path) > 0
    with open(path, 'a', encoding='utf-8', newline='') as fh:
        if not existed:
            fh.write(','.join(header) + '\n')
        for r in rows:
            fh.write(','.join(str(r[c]) for c in header) + '\n')


if __name__ == '__main__':
    main()
