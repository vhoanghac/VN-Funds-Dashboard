"""Update ETF prices and BTC/VND from public endpoints.

ETF prices come from CafeF's price history endpoint, the same source the stock
pipeline already uses. This script used to go through vnstock's Quote(VCI)
adapter; vnstock 4.x stopped authenticating on 2026-11-10 and the vendor index
now answers HTTP 410, so that adapter is gone. CafeF carries the same numbers:
GiaDieuChinh * 1000 equals the VCI-sourced rows already stored in
public/data/<symbol>.csv, compared row by row on 2026-11-11 for all 7 ETFs.

BTC/VND comes from CoinGecko and never involved vnstock.

The file name is historical. Nothing here imports vnstock any more.

Usage:  python -X utf8 scripts/update_vnstock.py
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import pandas as pd

# ─── Config ────────────────────────────────────────────────

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')

# ETFs — listed securities on HOSE, priced through CafeF like the stock pipeline
ETF_FUNDS = ['E1VFVN30', 'FUEVFVND', 'FUEDCMID', 'FUESSVFL', 'FUEVN100', 'FUESSV50', 'FUEIP100']

# CafeF returns at most 30 rows per request whatever PageSize asks for
# (measured 2026-11-11: PageSize=5000 still returned 30). A daily run only ever
# needs the newest page, so paging stays at 1.
CAFEF_PRICE_URL = 'https://cafef.vn/du-lieu/Ajax/PageNew/DataHistory/PriceHistory.ashx'
CAFEF_PAGE_ROWS = 30
# PageIndex walks back in 30-session blocks (measured 2026-11-11: page 1 covers
# 30/09..10/11, page 2 goes back to 14/08). 40 pages covers roughly five years,
# which is far more than a normal gap, and only a repair ever needs that many.
CAFEF_MAX_PAGES = 40
CAFEF_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (compatible; VN-Funds-Dashboard/1.0)',
}



# ─── Helpers ───────────────────────────────────────────────

def get_last_date(csv_path):
    """Read the last date from a CSV file."""
    if not os.path.exists(csv_path):
        return None
    df = pd.read_csv(csv_path)
    if df.empty:
        return None
    return str(df['date'].iloc[-1])


def append_to_csv(csv_path, new_df):
    """Append new rows to existing CSV (date,price format)."""
    if new_df.empty:
        return 0
    existing = pd.read_csv(csv_path)
    last_date = str(existing['date'].iloc[-1]) if not existing.empty else ''

    # Only keep rows strictly after last_date
    new_df = new_df[new_df['date'] > last_date].copy()
    if new_df.empty:
        return 0

    # Ensure file ends with newline before appending
    with open(csv_path, 'rb') as f:
        f.seek(-1, 2)
        needs_newline = f.read(1) != b'\n'

    with open(csv_path, 'a', newline='') as f:
        if needs_newline:
            f.write('\n')
        new_df.to_csv(f, header=False, index=False, lineterminator='\n')

    return len(new_df)


def fetch_cafef_rows(symbol, page):
    """One page of CafeF price history, newest row first.

    CafeF caps a page at 30 rows and ignores StartDate/EndDate entirely, so the
    only way to reach older sessions is PageIndex (measured 2026-11-11).
    """
    url = (
        f'{CAFEF_PRICE_URL}?Symbol={quote(symbol)}'
        f'&PageIndex={page}&PageSize={CAFEF_PAGE_ROWS}'
    )
    request = urllib.request.Request(url, headers=CAFEF_HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode('utf-8'))

    if not payload.get('Success'):
        raise RuntimeError(f'CafeF rejected the request: {payload.get("Message")!r}')

    return (payload.get('Data') or {}).get('Data') or []


def cafef_prices(rows):
    """CafeF rows -> {iso_date: price in VND}. Rows without a price are skipped."""
    prices = {}
    for row in rows:
        raw_date = row.get('Ngay')
        raw_price = row.get('GiaDieuChinh')
        if not raw_date or raw_price is None:
            continue
        iso = datetime.strptime(raw_date, '%d/%m/%Y').strftime('%Y-%m-%d')
        # CafeF quotes in thousand VND; the CSV files store VND.
        prices[iso] = int(round(float(raw_price) * 1000))
    return prices


def fetch_cafef_since(symbol, since):
    """Every CafeF row with date >= since, as {iso_date: price}.

    Walks PageIndex backwards until it reaches `since`, so a run resuming after
    a long outage backfills the hole instead of appending past it.
    """
    prices = {}
    for page in range(1, CAFEF_MAX_PAGES + 1):
        rows = fetch_cafef_rows(symbol, page)
        if not rows:
            break
        prices.update(cafef_prices(rows))
        if min(prices) <= since or len(rows) < CAFEF_PAGE_ROWS:
            break
    return {day: price for day, price in prices.items() if day >= since}


def check_junction(symbol, csv_path, last_date, remote):
    """-> (ok, message). The stored row we append after must agree on both sides.

    The existing CSV came from VCI, the new rows come from CafeF. The two agree
    on every recent session except 2026-10-06, where they still disagree for all
    7 ETFs, so comparing the whole tail would wedge the run forever over a
    historical vendor difference we cannot repair from here. What matters is the
    junction: when the last stored row matches, the appended series has no step.
    """
    existing = pd.read_csv(csv_path)
    if existing.empty:
        return True, 'no stored rows'

    if last_date not in remote:
        return False, f'{last_date} not reachable within {CAFEF_MAX_PAGES} pages'

    stored = int(existing['price'].iloc[-1])
    if stored != remote[last_date]:
        return False, f'{last_date}: csv {stored} vs CafeF {remote[last_date]}'

    return True, f'{last_date} at {stored} on both sides'


# ─── ETF prices via CafeF ─────────────────────────────────

def update_etf(symbol):
    """Append new CafeF price rows for one ETF."""

    csv_path = os.path.join(DATA_DIR, f'{symbol}.csv')
    last_date = get_last_date(csv_path)

    if last_date:
        start = (datetime.strptime(last_date, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
    else:
        start = '2014-01-01'
    end = datetime.now().strftime('%Y-%m-%d')

    if start > end:
        print(f'  ✅ {symbol}: already up to date (last: {last_date})')
        return True

    try:
        remote = fetch_cafef_since(symbol, last_date or start)

        if last_date:
            junction_ok, detail = check_junction(symbol, csv_path, last_date, remote)
            if not junction_ok:
                print(f'  ❌ {symbol}: no clean junction with CafeF ({detail}).')
                print('     Refusing to append: the series would step. Rebuild that CSV first.')
                return False

        new_prices = {day: price for day, price in remote.items() if day >= start}

        if not new_prices:
            print(f'  ✅ {symbol}: no new data available (last: {last_date})')
            return True

        df_new = pd.DataFrame(sorted(new_prices.items()), columns=['date', 'price'])

        count = append_to_csv(csv_path, df_new)
        if count > 0:
            new_last = df_new['date'].iloc[-1]
            print(f'  📈 {symbol}: +{count} rows ({last_date or "start"} → {new_last})')
        else:
            print(f'  ✅ {symbol}: already up to date (last: {last_date})')

        return True

    except Exception as e:
        print(f'  ❌ {symbol}: {e}')
        return False



# ─── BTC/VND via CoinGecko ───────────────────────────────

def update_btc_vnd():
    """Update BTC/VND price data using CoinGecko free API (direct BTC→VND).

    Returns True on success or already-up-to-date, False on failure.
    Retries up to 3 times with exponential backoff to handle transient
    rate limits or network errors from GitHub Actions shared IPs.
    """
    import urllib.request
    import json
    import time

    csv_path = os.path.join(DATA_DIR, 'BTC.csv')
    last_date = get_last_date(csv_path)

    if not last_date:
        print(f'  ❌ BTC: CSV file not found, need initial data file')
        return False

    # Calculate days since last update
    last_dt = datetime.strptime(last_date, '%Y-%m-%d')
    days_diff = (datetime.now() - last_dt).days

    if days_diff <= 0:
        print(f'  ✅ BTC: already up to date (last: {last_date})')
        return True

    # CoinGecko free API: market_chart returns daily prices for last N days.
    # Use days_diff + 2 to ensure overlap, then filter by date.
    # Note: for days <= 90 the API returns hourly granularity regardless of
    # interval param. We dedup by date (keep last) to get one price per day.
    days_to_fetch = min(days_diff + 2, 365)

    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            url = (
                f'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart'
                f'?vs_currency=vnd&days={days_to_fetch}'
            )
            req = urllib.request.Request(url, headers={
                'Accept': 'application/json',
                'User-Agent': 'VN-Funds-Dashboard/1.0',
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())

            prices = data.get('prices', [])
            if not prices:
                print(f'  ⚠️  BTC: CoinGecko returned empty prices list')
                return True

            # CoinGecko returns [[timestamp_ms, price], ...]
            rows = []
            for ts_ms, price in prices:
                date_str = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime('%Y-%m-%d')
                rows.append({'date': date_str, 'price': int(round(price))})

            df = (pd.DataFrame(rows)
                    .drop_duplicates(subset='date', keep='last')
                    .sort_values('date')
                    .reset_index(drop=True))

            count = append_to_csv(csv_path, df)
            if count > 0:
                new_last = df['date'].iloc[-1]
                print(f'  📈 BTC: +{count} rows ({last_date} → {new_last})')
            else:
                print(f'  ✅ BTC: already up to date (last: {last_date})')
            return True

        except Exception as e:
            wait = 2 ** attempt  # 2s, 4s, 8s
            if attempt < max_retries:
                print(f'  ⚠️  BTC attempt {attempt}/{max_retries} failed: {e}. Retrying in {wait}s...')
                time.sleep(wait)
            else:
                print(f'  ❌ BTC: all {max_retries} attempts failed. Last error: {e}')
                return False


# ─── Main ─────────────────────────────────────────────────

def main():
    print(f'\n🚀 ETF & BTC updater — {datetime.now().strftime("%Y-%m-%d %H:%M")}\n')



    # ── 1. ETFs ──
    print('📊 Updating ETFs via CafeF...')
    etf_failures = []
    for symbol in ETF_FUNDS:
        if not update_etf(symbol):
            etf_failures.append(symbol)
    print()

    # ── 2. BTC/VND ──
    print('₿  Updating Bitcoin (BTC/VND) via CoinGecko...')
    btc_ok = update_btc_vnd()
    print()

    if etf_failures or not btc_ok:
        if etf_failures:
            print(f'❌ ETF update failed for: {", ".join(etf_failures)}')
        if not btc_ok:
            print('❌ BTC update failed.')
        print('Exiting with error so GitHub Actions alerts.\n')
        sys.exit(1)

    print('✅ Done!\n')


if __name__ == '__main__':
    main()
