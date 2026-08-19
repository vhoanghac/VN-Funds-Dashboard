"""
Update fund NAV & ETF prices using vnstock library.
Handles:
  1. ETFs (E1VFVN30, FUEVFVND, FUEDCMID) via vnstock Quote (VCI source)
  2. Mutual funds with different names on fmarket (DFVNCAF→DCAF, SSIVLGF→VLGF, MBBMFF→BMFF)
  3. Funds not on fmarket at all (PRULINK, VSF, TCFIN, TCSME) — skipped with warning

Usage:  python -X utf8 scripts/update_vnstock.py
"""

import os
import sys
import pandas as pd
from datetime import datetime, timedelta, timezone

# ─── Config ────────────────────────────────────────────────

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')

# ETFs — use Quote(source='VCI') to get stock prices
ETF_FUNDS = ['E1VFVN30', 'FUEVFVND', 'FUEDCMID', 'FUESSVFL', 'FUEVN100', 'FUESSV50']



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


# ─── ETF update via Quote ─────────────────────────────────

def update_etf(symbol):
    """Update ETF price data using vnstock Quote (VCI source)."""
    from vnstock import Quote

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
        quote = Quote(symbol=symbol, source='VCI')
        df = quote.history(start=start, end=end, interval='1D')

        if df is None or df.empty:
            print(f'  ✅ {symbol}: no new data available (last: {last_date})')
            return True

        # vnstock Quote returns: time, open, high, low, close, volume
        df_filtered = df[['time', 'close']].copy()
        df_filtered = df_filtered.rename(columns={'time': 'date', 'close': 'price'})
        df_filtered['date'] = pd.to_datetime(df_filtered['date']).dt.strftime('%Y-%m-%d')

        # VCI price is in 1000 VND → multiply by 1000
        df_filtered['price'] = (df_filtered['price'] * 1000).astype(int)

        df_filtered = df_filtered.sort_values('date').reset_index(drop=True)

        count = append_to_csv(csv_path, df_filtered)
        if count > 0:
            new_last = df_filtered['date'].iloc[-1]
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
    print(f'\n🚀 vnstock Updater — {datetime.now().strftime("%Y-%m-%d %H:%M")}\n')

    # Register API key (from environment variable)
    from vnstock import register_user
    api_key = os.environ.get('VNSTOCK_API_KEY')
    if not api_key:
        print('❌ VNSTOCK_API_KEY environment variable not set!')
        print('   Set it with: export VNSTOCK_API_KEY=your_key_here')
        return
    print('🔑 Registering vnstock API key...')
    register_user(api_key=api_key)
    print()

    # ── 1. ETFs ──
    print('📊 Updating ETFs via vnstock Quote (VCI)...')
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
