#!/usr/bin/env python
"""
Generate holdings CSVs for the Overlap tab from official fund reports (tidied).

Source: public/data/<FUND>/tidied/tidy_portfolio.csv — the BCDanhMucDauTu
(investment portfolio) sheet of monthly Thong tu 98/2020/TT-BTC reports,
produced by fund_reports_update.py. This is the OFFICIAL portfolio the fund
publishes (92 periods for DCDS, 2018-12 .. 2026-07), richer than the
digiinvest/fmarket sources currently backing the Overlap tab.

Output (same schema as update_holdings.py / backfill_holdings_digiinvest.py):
  public/data/holdings/<FUND>_holdings.csv  -> date,stock_code,industry,weight_pct,asset_value,type_asset
  public/data/holdings/<FUND>_industry.csv  -> date,industry,weight_pct
  holdings_index.json              -> {id, update_at, source: 'report'} upsert

Mapping rules (verified across the 3 template eras):
  - period_end (YYYY-MM-DD, end of month) -> date (YYYY-MM-01, matches fmarket
    reportTime format so period selectors line up across funds).
  - STOCK: rows whose section contains SHARES / EQUITY / FUND CERTIFICATES and
    whose ticker is a 3-char code (the only real equity tickers). All subtotal
    rows (2247/2249/2250...) have an empty ticker and are dropped automatically.
  - BOND / CASH: the section total row = the single weighted row with an EMPTY
    ticker in the BONDS / CASH section (2252 / 2262 in the coded era). Aggregated
    into one row per type, matching the existing digiinvest file shape.
  - OTHER: OTHER ASSETS total (2257) + OTHER SECURITIES subtotal. The OTHER
    SECURITIES section ALSO contains a grand-total row ("tong chung khoan dau tu",
    ~stocks+bonds weight) which is excluded by comparing against the sum of
    STOCK + BOND rows already computed.
  - weight (fraction, 1.0 = 100% NAV) -> weight_pct (x100, round 2).
  - asset_value: value (VND) of the same rows; aggregated rows sum their parts.
  - industry: read from the STATIC public/data/industry_map.json (ticker -> industry,
    Vietnamese names, committed to the repo). The map is a snapshot of vnstock
    Listing.symbols_by_industries() + MANUAL_INDUSTRY below. To refresh it when new
    tickers appear, run this script with --refresh (calls vnstock live and rewrites
    the file); a plain run NEVER rewrites it, so a vnstock outage can't degrade the map.

Merge semantics (same as digiinvest backfill): periods present in tidy_portfolio
OVERWRITE whatever was in <FUND>_holdings.csv; periods NOT in tidy (a newer
period appended by update_holdings.py / fmarket) are kept untouched.

Usage:  python -X utf8 scripts/fund_report/fund_reports_to_holdings.py [FUND...] [--refresh]
        (default: every fund that has a tidied/tidy_portfolio.csv)
        --refresh: update industry_map.json from vnstock before generating.
"""

import io
import json
import os
import re
import sys

import pandas as pd

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'data')
HOLDINGS_DIR = os.path.join(DATA_DIR, 'holdings')
INDEX_FILE = os.path.join(DATA_DIR, 'holdings_index.json')
INDUSTRY_MAP_FILE = os.path.join(DATA_DIR, 'industry_map.json')

TICKER_RE = re.compile(r'^[A-Z0-9]{3}$')
STOCK_SECTION = re.compile(r'SHARES|EQUITY|FUND CERTIFICATES')
GRAND_TOTAL_SECTION = 'Total value of portfolio'
BONDS = 'BONDS'
CASH = 'CASH'
OTHER_ASSETS = 'OTHER ASSETS'
OTHER_SEC = 'OTHER SECURITIES'


def is_stock_row(section, ticker):
    """A row is a stock holding if:
    - its section is a SHARES / EQUITY / FUND CERTIFICATES section, AND
    - its ticker is a 3-char code (listed equities), OR it is an UNLISTED
      section (tickers there are long company names, e.g. 'VPBANK SECURITIES
      JOINT STOCK COMPANY'). Subtotal rows have an empty ticker → dropped.
    """
    if not STOCK_SECTION.search(section):
        return False
    if not ticker:
        return False
    if TICKER_RE.match(ticker):
        return True
    return 'UNLISTED' in section.upper()

def norm_industry(name):
    """Remove commas from industry names. Both this script's CSV output and the
    TS parser (src/utils/overlap.ts) split fields on ',' without quote handling,
    so a name like 'Dich vu tu van, ho tro' would corrupt the columns."""
    return name.replace(', ', ' - ').replace(',', ' - ')


# Industries vnstock's symbols_by_industries() no longer returns (delisted /
# renamed before 2022, or tickers vnstock simply does not classify). These are
# hand-mapped to the vnstock industry vocabulary. Keep this list updated when a
# new report surfaces a ticker vnstock cannot classify.
MANUAL_INDUSTRY = {
    'ABB': 'Ngân hàng',
    'ACV': 'Vận tải - kho bãi',
    'BCG': 'Bất động sản',
    'C4G': 'Xây dựng',
    'CLX': 'Thực phẩm - Đồ uống',
    'DDV': 'Vật liệu xây dựng',
    'DRI': 'Sản phẩm cao su',
    'FOX': 'Công nghệ và thông tin',
    'GDA': 'Vật liệu xây dựng',      # CTCP Tôn Đông Á
    'HBC': 'Xây dựng',
    'LTG': 'Thực phẩm - Đồ uống',    # CTCP Tập đoàn Lộc Trời
    'MSR': 'Khai khoáng',
    'OIL': 'Khai khoáng',
    'PHP': 'Vận tải - kho bãi',      # CTCP Cảng Hải Phòng
    'PME': 'Chăm sóc sức khỏe',      # CTCP Pymepharco (dược)
    'QNS': 'Thực phẩm - Đồ uống',
    'ROS': 'Xây dựng',
    'TTN': 'Công nghệ và thông tin',
    'TVN': 'Xây dựng',
    'VEA': 'SX Thiết bị, máy móc',   # VEAM (máy động lực & nông nghiệp)
    'VGI': 'Công nghệ và thông tin',
    # Unlisted stocks carry long company names as ticker; map the few seen.
    'Dien May Xanh Investment Joint Stock Co.': 'Bán lẻ',
    'TECHCOM SECURITIES JOINT STOCK COMPANY': 'Chứng khoán',
    'VPBANK SECURITIES JOINT STOCK COMPANY': 'Chứng khoán',
}
MANUAL_INDUSTRY = {k: norm_industry(v) for k, v in MANUAL_INDUSTRY.items()}


# Unlisted stocks appear in tidy_portfolio with their LONG company name as the
# ticker (e.g. 'Dien May Xanh Investment Joint Stock Co.'), not the 3-char code
# the rest of the pipeline uses. Map the long name -> canonical ticker so a
# stock is stored consistently and can match the same company in other funds.
# A plain run rewrites holdings from tidy, so WITHOUT this the long name would
# come back on the next run and break the Overlap layout (a nowrap cell that
# wide blows the 2-column grid). Keep updated when a new long name surfaces.
TICKER_ALIAS = {
    'Dien May Xanh Investment Joint Stock Co.': 'DMX',
}


def vnstock_industry_map():
    """symbol -> industry (Vietnamese, comma-free). vnstock live; empty if unavailable."""
    try:
        from vnstock import Listing
        df = Listing().symbols_by_industries()
        return {row['symbol']: norm_industry(row['industry_name']) for _, row in df.iterrows()}
    except Exception as e:
        print(f'  ⚠️  vnstock industries unavailable: {e} (using manual map only)')
        return {}


def refresh_industry_map():
    """Chạy với --refresh: gọi vnstock live, merge MANUAL_INDUSTRY, ghi industry_map.json.

    Chạy thường KHÔNG gọi hàm này — script chỉ đọc file tĩnh để không bao giờ
    tự làm nghèo map khi vnstock lỗi đúng lúc chạy."""
    m = vnstock_industry_map()
    if not m:
        print('❌ vnstock industries unavailable — not overwriting industry_map.json')
        sys.exit(1)
    m.update(MANUAL_INDUSTRY)
    with open(INDUSTRY_MAP_FILE, 'w', encoding='utf-8') as fh:
        json.dump(dict(sorted(m.items())), fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    print(f'✅ industry_map.json refreshed: {len(m)} symbols')
    return m


def load_industry_map():
    """Đọc industry_map.json tĩnh (đã commit). Nếu thiếu file, fallback vnstock live."""
    if os.path.exists(INDUSTRY_MAP_FILE):
        try:
            with open(INDUSTRY_MAP_FILE, encoding='utf-8') as fh:
                m = json.load(fh)
            m.update(MANUAL_INDUSTRY)
            return m
        except Exception:
            pass
    print('  ⚠️  industry_map.json missing — falling back to vnstock live')
    m = vnstock_industry_map()
    m.update(MANUAL_INDUSTRY)
    return m


def load_index():
    if os.path.exists(INDEX_FILE):
        try:
            with open(INDEX_FILE, encoding='utf-8') as fh:
                return json.load(fh)
        except Exception:
            return []
    return []


def read_csv_by_date(path):
    """Existing CSV -> {date: [rows]} for MERGE (periods tidy lacks are kept)."""
    by_date = {}
    if not os.path.exists(path):
        return by_date
    with open(path, encoding='utf-8') as fh:
        header = fh.readline().strip().split(',')
        try:
            idx_date = header.index('date')
        except ValueError:
            return by_date
        for line in fh:
            cells = line.strip().split(',')
            if len(cells) <= idx_date:
                continue
            d = cells[idx_date]
            if d:
                by_date.setdefault(d, []).append(cells)
    return by_date


def write_merged_csv(path, header, merged):
    with open(path, 'w', encoding='utf-8', newline='') as fh:
        fh.write(','.join(header) + '\n')
        for date in sorted(merged):
            for row in merged[date]:
                padded = list(row) + [''] * (len(header) - len(row))
                fh.write(','.join(str(c) for c in padded) + '\n')


def period_to_date(period_end):
    """'2026-07-31' -> '2026-07-01' (first of month, fmarket convention)."""
    return period_end[:7] + '-01'


def parse_portfolio(csv_path):
    """tidy_portfolio rows -> {period: [row_dict]} with numeric fields parsed."""
    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    per = {}
    for _, r in df.iterrows():
        if not r['period_end'] or not r['weight']:
            continue
        section = r['section'].strip()
        if section == GRAND_TOTAL_SECTION or not section:
            continue
        try:
            w = float(r['weight'])
        except ValueError:
            continue
        val = 0.0
        if r['value']:
            try:
                val = float(r['value'])
            except ValueError:
                val = 0.0
        per.setdefault(r['period_end'], []).append({
            'section': section,
            'ticker': r['ticker'].strip(),
            'weight': w,
            'value': val,
        })
    return per


def build_period_rows(rows, stocks_total):
    """Aggregate one period's tidy rows into holdings rows + industry totals.

    Returns (holdings, industry_weights) where holdings are tuples
    (stock_code, industry, weight_pct, asset_value, type_asset).
    stocks_total = weight fraction of all stocks (used to exclude the OTHER
    SECURITIES grand-total row, which equals stocks+bonds+other).
    """
    stocks = []      # (ticker, w, value)
    bond_w = bond_v = 0.0
    cash_w = cash_v = 0.0
    other_w = other_v = 0.0

    for r in rows:
        sec = r['section']
        if is_stock_row(sec, r['ticker']):
            ticker = TICKER_ALIAS.get(r['ticker'], r['ticker'])
            stocks.append((ticker, r['weight'], r['value']))
        elif sec == BONDS and not r['ticker']:
            bond_w += r['weight']
            bond_v += r['value']
        elif sec == CASH and not r['ticker']:
            cash_w += r['weight']
            cash_v += r['value']
        elif sec == OTHER_ASSETS and not r['ticker']:
            other_w += r['weight']
            other_v += r['value']
        elif sec == OTHER_SEC and not r['ticker']:
            # OTHER SECURITIES section contains BOTH its subtotal and a
            # grand-total row ("tong chung khoan dau tu", code 2255) whose weight
            # equals stocks + bonds + other securities. The subtotal (rights,
            # futures...) is always small; the grand total always carries most of
            # the portfolio. Skip any row over 50% — that is the grand total.
            if not (stocks_total > 0 and r['weight'] > 0.5):
                other_w += r['weight']
                other_v += r['value']

    stocks.sort(key=lambda x: x[1], reverse=True)
    holdings = []
    for ticker, w, val in stocks:
        holdings.append((ticker, '', w, val, 'STOCK'))
    if bond_w > 0:
        holdings.append(('BOND', '', bond_w, bond_v, 'BOND'))
    if cash_w > 0:
        holdings.append(('CASH', '', cash_w, cash_v, 'CASH'))
    if other_w > 0:
        holdings.append(('OTHER', '', other_w, other_v, 'OTHER'))

    # Industry allocation: only stocks, grouped by industry.
    ind = {}
    for ticker, w, _ in stocks:
        ind[ticker] = ind.get(ticker, 0.0) + w
    return holdings, ind


def main():
    os.makedirs(HOLDINGS_DIR, exist_ok=True)

    refresh = '--refresh' in sys.argv
    args = [a for a in sys.argv[1:] if a != '--refresh']
    funds = args or sorted(
        d for d in os.listdir(DATA_DIR)
        if os.path.isdir(os.path.join(DATA_DIR, d))
        and os.path.exists(os.path.join(DATA_DIR, d, 'tidied', 'tidy_portfolio.csv'))
    )
    if not funds:
        print('no funds with tidied/tidy_portfolio.csv found', file=sys.stderr)
        sys.exit(1)

    industry_map = refresh_industry_map() if refresh else load_industry_map()
    print(f'📊 Industry map: {len(industry_map)} symbols' + (' (refreshed from vnstock)' if refresh else ' (static file)'))

    index = load_index()
    index_by_id = {e['id']: e for e in index}
    unknown = set()

    for fund in funds:
        tidy_path = os.path.join(DATA_DIR, fund, 'tidied', 'tidy_portfolio.csv')
        holdings_path = os.path.join(HOLDINGS_DIR, f'{fund}_holdings.csv')
        industry_path = os.path.join(HOLDINGS_DIR, f'{fund}_industry.csv')

        periods = parse_portfolio(tidy_path)
        if not periods:
            print(f'✅ {fund}: no weighted portfolio rows — skipped')
            continue

        holdings_merged = read_csv_by_date(holdings_path)
        industry_merged = read_csv_by_date(industry_path)
        latest = max(periods)

        for period in sorted(periods):
            rows = periods[period]
            stocks_total = sum(r['weight'] for r in rows if is_stock_row(r['section'], r['ticker']))
            holdings, ind_by_ticker = build_period_rows(rows, stocks_total)
            date = period_to_date(period)

            h_rows = []
            for code, _ind, w, val, typ in holdings:
                pct = round(w * 100, 2)
                ind = ''
                if typ == 'STOCK':
                    ind = industry_map.get(code, '')
                    if not ind:
                        unknown.add(code)
                h_rows.append([date, code, ind, pct, int(round(val)), typ])
            holdings_merged[date] = h_rows

            ind_sum = {}
            for ticker, wfrac in ind_by_ticker.items():
                ind = industry_map.get(ticker, '')
                if not ind:
                    unknown.add(ticker)
                    continue
                ind_sum[ind] = ind_sum.get(ind, 0.0) + wfrac * 100
            ind_list = sorted(ind_sum.items(), key=lambda x: x[1], reverse=True)
            industry_merged[date] = [[date, ind, round(w, 2)] for ind, w in ind_list]

            # Sanity: all asset types should sum to ~100% of NAV. Tolerance 15%
            # because unlisted stocks with long names (kept out, like digiinvest)
            # and the OTHER SECURITIES grand-total exclusion can leave a gap.
            total_pct = sum(row[3] for row in h_rows)
            if abs(total_pct - 100) > 15:
                print(f'  ⚠️  {fund} {date}: asset weights sum {total_pct:.2f}% (off >15%)')

        write_merged_csv(holdings_path,
                         ['date', 'stock_code', 'industry', 'weight_pct', 'asset_value', 'type_asset'],
                         holdings_merged)
        write_merged_csv(industry_path, ['date', 'industry', 'weight_pct'], industry_merged)

        n_hold = sum(len(v) for v in holdings_merged.values())
        n_periods = len(holdings_merged)
        print(f'📈 {fund}: {n_periods} periods ({min(holdings_merged)}..{max(holdings_merged)}), '
              f'{n_hold} holdings rows')

        if fund in index_by_id:
            index_by_id[fund]['update_at'] = period_to_date(latest)
            index_by_id[fund]['source'] = 'report'
        else:
            index_by_id[fund] = {'id': fund, 'update_at': period_to_date(latest), 'source': 'report'}

    index_out = sorted(index_by_id.values(), key=lambda r: r['id'])
    with open(INDEX_FILE, 'w', encoding='utf-8') as fh:
        json.dump(index_out, fh, ensure_ascii=False, indent=2)
        fh.write('\n')

    print(f'{"─" * 60}')
    print(f'✅ wrote {len(funds)} funds from official reports → {len(index_out)} funds in index')
    if unknown:
        print(f'⚠️  {len(unknown)} tickers without industry (left empty): {sorted(unknown)}')
    print(f'{"─" * 60}\n')


if __name__ == '__main__':
    main()
