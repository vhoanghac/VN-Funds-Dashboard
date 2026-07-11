"""
Update ETF and missing fund price data using vnstock library.

Handles tickers that are NOT available on fmarket API:
- ETFs: E1VFVN30, FUEVFVND, FUEDCMID
- Missing mutual funds from fmarket catalog

Reads existing CSV, fetches only new data after last date, appends.

Usage:  python scripts/update_etf.py
"""

import os
import sys
import io
import json
import pandas as pd
from datetime import datetime, timedelta

# Fix Windows console encoding for Unicode output
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ─── Config ──────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'public', 'data')
METADATA_FILE = os.path.join(DATA_DIR, 'fund_metadata.json')

# ETFs traded on exchange (use Quote from VCI source)
ETF_TICKERS = ['E1VFVN30', 'FUEVFVND', 'FUEDCMID', 'FUESSVFL', 'FUEVN100']

# Funds with different names on fmarket: our_id → fmarket short_name
FMARKET_NAME_MAP = {
    'DFVNCAF': 'DCAF',
    'SSIVLGF': 'VLGF',
    'MBBMFF': 'BMFF',
}

# Funds truly not on fmarket (no data source available)
NOT_ON_FMARKET = ['PRULINK', 'VSF', 'TCFIN', 'TCSME']

# vnstock API key
API_KEY = '***REMOVED***'

TODAY = datetime.now().strftime('%Y-%m-%d')


# ─── Helpers ─────────────────────────────────────────────

def get_last_date(csv_path):
    """Read a CSV and return the last date string, or None."""
    if not os.path.exists(csv_path):
        return None
    df = pd.read_csv(csv_path)
    if df.empty:
        return None
    return str(df['date'].iloc[-1])


def append_to_csv(csv_path, new_rows):
    """Append new rows (list of dicts with date, price) to existing CSV."""
    if not new_rows:
        return 0
    new_df = pd.DataFrame(new_rows)
    new_df.to_csv(csv_path, mode='a', header=False, index=False)
    return len(new_rows)


# ─── Register vnstock ───────────────────────────────────

def setup_vnstock():
    """Register user and return ready-to-use vnstock modules."""
    # Suppress vnstock info logs
    import logging
    logging.getLogger('vnstock').setLevel(logging.WARNING)

    from vnstock import Vnstock
    # Register with API key (non-interactive)
    try:
        from vnstock import register_user
        register_user(api_key=API_KEY)
    except Exception:
        # If register_user doesn't accept api_key param, try environment variable
        os.environ['VNSTOCK_API_KEY'] = API_KEY
        try:
            from vnstock import register_user
            register_user()
        except Exception as e:
            print(f"   Warning: register_user failed: {e}")

    return Vnstock


# ─── Update ETF prices ──────────────────────────────────

def update_etf(symbol, Vnstock):
    """Fetch ETF daily prices via vnstock Quote and append new data."""
    csv_path = os.path.join(DATA_DIR, f'{symbol}.csv')
    last_date = get_last_date(csv_path)

    if last_date:
        # Start from the day after last date
        start_date = (datetime.strptime(last_date, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
        if start_date > TODAY:
            print(f"  ✅ {symbol}: already up to date (last: {last_date})")
            return 'skip'
    else:
        start_date = '2010-01-01'

    try:
        stock = Vnstock().stock(symbol=symbol, source='VCI')
        df = stock.quote.history(start=start_date, end=TODAY, interval='1D')

        if df is None or df.empty:
            print(f"  ✅ {symbol}: no new data available (last: {last_date})")
            return 'skip'

        # vnstock returns columns: time, open, high, low, close, volume
        # ETF price = close * 1000 (VCI returns in 1000 VND)
        df_filtered = df[['time', 'close']].copy()
        df_filtered = df_filtered.rename(columns={'time': 'date', 'close': 'price'})
        df_filtered['date'] = pd.to_datetime(df_filtered['date']).dt.strftime('%Y-%m-%d')
        df_filtered['price'] = (df_filtered['price'] * 1000).astype(int)

        # Filter strictly after last_date
        if last_date:
            df_filtered = df_filtered[df_filtered['date'] > last_date]

        if df_filtered.empty:
            print(f"  ✅ {symbol}: already up to date (last: {last_date})")
            return 'skip'

        new_rows = df_filtered.to_dict('records')
        count = append_to_csv(csv_path, new_rows)
        new_last = new_rows[-1]['date']
        print(f"  📈 {symbol}: +{count} rows ({last_date or 'start'} → {new_last})")
        return 'updated'

    except Exception as e:
        print(f"  ❌ {symbol}: {e}")
        return 'error'


# ─── Update fund with mapped fmarket name ───────────────

def update_missing_fund_with_name(our_id, fmarket_name, Vnstock):
    """Fetch fund NAV using the correct fmarket short_name, save to our CSV."""
    csv_path = os.path.join(DATA_DIR, f'{our_id}.csv')
    last_date = get_last_date(csv_path)

    try:
        from vnstock import Fund
        fund = Fund()
        nav_df = fund.details.nav_report(fmarket_name)

        if nav_df is None or nav_df.empty:
            print(f"  [WARN] {our_id} (as {fmarket_name}): no data -- skipped")
            return 'skip'

        cols = nav_df.columns.tolist()
        date_col = None
        nav_col = None
        for c in cols:
            cl = c.lower()
            if 'date' in cl:
                date_col = c
            if cl in ('nav', 'navpershare', 'nav_per_share'):
                nav_col = c
            if cl == 'nav' and nav_col is None:
                nav_col = c

        if date_col is None or nav_col is None:
            if len(cols) >= 2:
                date_col = cols[0]
                nav_col = cols[1]
            else:
                print(f"  [ERR] {our_id}: cannot identify columns: {cols}")
                return 'error'

        df_filtered = nav_df[[date_col, nav_col]].copy()
        df_filtered.columns = ['date', 'price']
        df_filtered['date'] = pd.to_datetime(df_filtered['date']).dt.strftime('%Y-%m-%d')
        df_filtered = df_filtered.sort_values('date')

        if last_date:
            df_filtered = df_filtered[df_filtered['date'] > last_date]

        if df_filtered.empty:
            print(f"  [OK] {our_id} (as {fmarket_name}): already up to date (last: {last_date})")
            return 'skip'

        new_rows = df_filtered.to_dict('records')
        count = append_to_csv(csv_path, new_rows)
        new_last = new_rows[-1]['date']
        print(f"  [+] {our_id} (as {fmarket_name}): +{count} rows ({last_date or 'start'} -> {new_last})")
        return 'updated'

    except Exception as e:
        print(f"  [ERR] {our_id} (as {fmarket_name}): {e}")
        return 'error'


# ─── Update missing mutual funds via fmarket through vnstock ─

def update_missing_fund(symbol, Vnstock):
    """Try to fetch missing fund NAV via vnstock Fund module."""
    csv_path = os.path.join(DATA_DIR, f'{symbol}.csv')
    last_date = get_last_date(csv_path)

    try:
        from vnstock import Fund
        fund = Fund()

        # Get NAV report for this fund
        nav_df = fund.details.nav_report(symbol)

        if nav_df is None or nav_df.empty:
            print(f"  ⚠️  {symbol}: no data from vnstock Fund — skipped")
            return 'skip'

        # nav_report returns columns like: navDate, nav, ...
        # Find the right column names
        cols = nav_df.columns.tolist()

        # Try to identify date and nav columns
        date_col = None
        nav_col = None
        for c in cols:
            cl = c.lower()
            if 'date' in cl:
                date_col = c
            if cl in ('nav', 'navpershare', 'nav_per_share'):
                nav_col = c
            if cl == 'nav' and nav_col is None:
                nav_col = c

        if date_col is None or nav_col is None:
            # Fallback: assume first col is date, second is nav
            print(f"  ⚠️  {symbol}: columns = {cols}")
            if len(cols) >= 2:
                date_col = cols[0]
                nav_col = cols[1]
            else:
                print(f"  ❌ {symbol}: cannot identify columns")
                return 'error'

        df_filtered = nav_df[[date_col, nav_col]].copy()
        df_filtered.columns = ['date', 'price']
        df_filtered['date'] = pd.to_datetime(df_filtered['date']).dt.strftime('%Y-%m-%d')
        df_filtered = df_filtered.sort_values('date')

        # Filter strictly after last_date
        if last_date:
            df_filtered = df_filtered[df_filtered['date'] > last_date]

        if df_filtered.empty:
            print(f"  ✅ {symbol}: already up to date (last: {last_date})")
            return 'skip'

        new_rows = df_filtered.to_dict('records')
        count = append_to_csv(csv_path, new_rows)
        new_last = new_rows[-1]['date']
        print(f"  📈 {symbol}: +{count} rows ({last_date or 'start'} → {new_last})")
        return 'updated'

    except Exception as e:
        print(f"  ❌ {symbol}: {e}")
        return 'error'


# ─── Main ────────────────────────────────────────────────

def main():
    print(f"\n🚀 vnstock NAV Updater — {TODAY}\n")

    Vnstock = setup_vnstock()

    updated = 0
    skipped = 0
    errors = 0

    # ── ETFs ──
    print("📊 Updating ETFs (via Quote/VCI)...\n")
    for ticker in ETF_TICKERS:
        result = update_etf(ticker, Vnstock)
        if result == 'updated': updated += 1
        elif result == 'error': errors += 1
        else: skipped += 1

    # ── Funds with different fmarket names ──
    print(f"\n📋 Updating funds with name mapping (via Fund)...\n")
    for our_id, fmarket_name in FMARKET_NAME_MAP.items():
        csv_path = os.path.join(DATA_DIR, f'{our_id}.csv')
        if not os.path.exists(csv_path):
            print(f"  [WARN] {our_id}: CSV not found -- skipped")
            skipped += 1
            continue
        result = update_missing_fund_with_name(our_id, fmarket_name, Vnstock)
        if result == 'updated': updated += 1
        elif result == 'error': errors += 1
        else: skipped += 1

    # ── Funds not on fmarket ──
    print(f"\n[INFO] Not on fmarket (no auto-update): {', '.join(NOT_ON_FMARKET)}\n")

    # ── Summary ──
    print(f"\n{'─' * 50}")
    print(f"✅ Updated: {updated}")
    print(f"⏭️  Skipped: {skipped}")
    print(f"❌ Errors:  {errors}")
    print(f"{'─' * 50}\n")


if __name__ == '__main__':
    main()
