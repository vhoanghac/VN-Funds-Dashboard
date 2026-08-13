#!/usr/bin/env python
"""
Cross-check fund report numbers with Docling (independent reader).

Usage (run with the docling venv python, or let this script re-exec itself):
  python scripts/fund_report/fund_reports_verify.py                      # all funds' raw/ dirs
  python scripts/fund_report/fund_reports_verify.py <file.xlsx|pdf>...   # specific files
  python scripts/fund_report/fund_reports_verify.py <file.pdf> --fund DCDS   # PDF without standard name

Converts every input file with Docling, extracts all numeric cells from the
DoclingDocument, and compares against the matching fund's tidied CSVs
(public/data/<FUND>/tidied/*.csv) in both directions:
  - numbers in the report but not in tidied  -> discrepancy (with exceptions)
  - numbers in tidied but not in the report  -> discrepancy

The fund is taken from the standard <FUND>_BC_THANG_<MM><YYYY>.xlsx file
name; for inputs that do not follow that pattern (e.g. a future PDF), pass
--fund <FUND> explicitly.

Two kinds of source numbers are expected to be absent from tidied and are
classified as "expected" instead of errors (see
process/2026-08-12_BaoCaoTaiChinhTidied.md):
  - BCTaiSan column F ("%/cung ky nam truoc"): stale values, dropped by design
  - STT sequence-number columns (1..51): redundant, the code column carries
    the hierarchy
Both are detected from the header cell text, not hardcoded column indexes.

PDF inputs work the same way (Docling parses PDF natively; the first PDF run
downloads the layout model once). With PDFs the BCTaiSan/STT exceptions do
not apply, so any mismatch between the PDF and the tidied numbers is a real
discrepancy.

Exit codes: 0 = clean, 1 = discrepancies found, 2 = docling not available.

Depends on: docling (installed in its own venv, outside the repo).
"""

import argparse
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import fund_reports_update as ufr  # reuses fund_from_name / fund_dirs

ROOT = Path(__file__).resolve().parent.parent.parent

NUM_RE = re.compile(r"^-?\d+(\.\d+)?$")

# Known venv locations used to re-exec this script with a docling-enabled
# interpreter when it was started with a plain python.
DOCLING_VENVS = [
    Path.home() / ".venvs" / "docling",
    ROOT / ".venv-docling",
]


def docling_available():
    return importlib_has("docling")


def importlib_has(module):
    try:
        import importlib.util  # noqa: PLC0415

        return importlib.util.find_spec(module) is not None
    except Exception:
        return False


def ensure_docling():
    """Re-exec via a docling venv, or print setup help and exit 2."""
    if docling_available():
        return
    for venv in DOCLING_VENVS:
        py = venv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        if py.exists():
            try:
                code = subprocess.call([str(py), *sys.argv])
            except KeyboardInterrupt:
                code = 130
            sys.exit(code)
    print("docling is not installed in the current interpreter.")
    print("Create the venv once (outside the repo):")
    print(f"  python -m venv {DOCLING_VENVS[0]}")
    print(f"  {DOCLING_VENVS[0] / 'Scripts' / 'python'} -m pip install docling")
    print("Then run this script with that interpreter:")
    print(f"  {DOCLING_VENVS[0] / 'Scripts' / 'python'} scripts\\fund_report\\fund_reports_verify.py")
    sys.exit(2)


def is_target_sheet(name):
    """Only sheets the converter reads are cross-checked.

    Some reports carry extra sheets from an older circular format
    (BCThuNhap_*, BCTinhHinhTaiChinh_*) or a logo sheet (LogoFMS). The
    converter deliberately ignores them, so their numbers are not expected
    in tidied and must not be flagged.
    """
    return any(
        spec.get("prefix") and name.startswith(spec["prefix"])
        for spec in ufr.SHEET_NAMES.values()
    )


def is_futures_table(name, table):
    """Tables in the portfolio sheet that the converter deliberately skips.

    The 2018-2020 reports append a futures-position table (headers 'Vị thế',
    'Tổng giá trị cam kết') below the grand total; the converter stops at
    'Total value of portfolio', so their numbers are not expected in tidied.
    """
    if table_for_sheet(name) != "portfolio":
        return False
    for c in table.data.table_cells:
        txt = unicodedata.normalize("NFC", c.text or "")
        if "V\u1ecb th\u1ebf" in txt or "cam k\u1ebft" in txt:
            return True
    return False


def sheet_tables(doc):
    """Yield (sheet_name, table_item) pairs for the target sheets.

    A sheet may be fragmented into several tables; children whose cref does
    not reference a table (or references one out of range) are skipped, as
    are futures-position tables inside the portfolio sheet.
    """
    for group in doc.groups:
        if not is_target_sheet(group.name):
            continue
        for child in group.children:
            m = re.match(r"#/tables/(\d+)$", child.cref)
            if not m:
                continue
            idx = int(m.group(1))
            if idx >= len(doc.tables):
                continue
            table = doc.tables[idx]
            if is_futures_table(group.name, table):
                continue
            yield group.name, table


def sheet_exception_cols(doc):
    """Per sheet: (stt_cols, f_cols) unioned across that sheet's tables.

    Docling fragments one sheet into several tables; a fragment (e.g. the
    cash section of the portfolio) may not contain the 'STT' header cell,
    so the exception columns must be collected per sheet, not per table.
    """
    per_sheet = {}
    for sheet_name, table in sheet_tables(doc):
        stt_cols, f_cols = per_sheet.get(sheet_name, (set(), set()))
        for cell in table.data.table_cells:
            txt = (cell.text or "").strip()
            col = cell.start_col_offset_idx
            if txt.startswith("STT"):
                stt_cols.add(col)
            if "%/cùng kỳ" in txt or "against last year" in txt:
                f_cols.add(col)
        per_sheet[sheet_name] = (stt_cols, f_cols)
    return per_sheet


def collect_numbers(doc):
    """Extract numeric cells; return (all_numbers, expected_dropped)."""
    per_sheet = sheet_exception_cols(doc)
    all_numbers = set()
    expected = set()
    for sheet_name, table in sheet_tables(doc):
        stt_cols, f_cols = per_sheet[sheet_name]
        f_exception = sheet_name.startswith("BCTaiSan")
        tk = table_for_sheet(sheet_name)
        for cell in table.data.table_cells:
            txt = (cell.text or "").strip()
            if not NUM_RE.match(txt):
                continue
            all_numbers.add(txt)
            col = cell.start_col_offset_idx
            # borrowing has no code column in tidied (schema keeps only
            # item/amount/balance), so its codes (2287-2297 in 2018-2020)
            # are metadata, not captured values.
            if (col in stt_cols or (f_exception and col in f_cols)
                    or (tk == "borrowing" and col == CODE_COL)):
                expected.add(txt)
    return all_numbers, expected


# Column offsets (0-based) in the period-bearing tables: C=code, D=value,
# E=previous, F=income YTD.
CODE_COL = 2
CUR_COL = 3
PREV_COL = 4
YTD_COL = 5
PERIOD_SHEETS = ("assets", "income", "indicators")


def table_for_sheet(name):
    """Map a Docling sheet (group) name to the converter table key."""
    for table, spec in ufr.SHEET_NAMES.items():
        if spec.get("prefix") and name.startswith(spec["prefix"]):
            return table
    return None


def build_value_map(doc):
    """value -> set of (code, period_end, measure) keys the report claims.

    For the period-bearing tables a value cell in column D/E/F is tied to its
    code (column C) and the period from the sheet's date headers. Used to tell
    a restatement (tidied has the same key with a newer value) apart from a
    genuinely dropped number (no such key in tidied at all).
    """
    periods = {}
    for sheet_name, table in sheet_tables(doc):
        if table_for_sheet(sheet_name) not in PERIOD_SHEETS:
            continue
        for cell in table.data.table_cells:
            txt = (cell.text or "").strip().split("\n")[0]
            d = ufr.parse_vn_date(txt)
            if d is None:
                continue
            iso = d.isoformat()
            slot = periods.setdefault(sheet_name, {})
            col = cell.start_col_offset_idx
            if col == CUR_COL and "cur" not in slot:
                slot["cur"] = iso
            elif col == PREV_COL and "prev" not in slot:
                slot["prev"] = iso

    vmap = {}
    for sheet_name, table in sheet_tables(doc):
        tk = table_for_sheet(sheet_name)
        if tk not in PERIOD_SHEETS:
            continue
        p = periods.get(sheet_name, {})
        row_code = {}
        for c in table.data.table_cells:
            if c.start_col_offset_idx == CODE_COL:
                row_code.setdefault(c.start_row_offset_idx, (c.text or "").strip())
        for cell in table.data.table_cells:
            txt = (cell.text or "").strip()
            if not NUM_RE.match(txt):
                continue
            code = row_code.get(cell.start_row_offset_idx)
            if not code:
                continue
            col = cell.start_col_offset_idx
            if tk == "assets":
                keys = []
                if col == CUR_COL and "cur" in p:
                    keys.append((code, p["cur"], None))
                elif col == PREV_COL and "prev" in p:
                    keys.append((code, p["prev"], None))
            elif tk == "income":
                keys = []
                if col == CUR_COL and "cur" in p:
                    keys.append((code, p["cur"], "month"))
                elif col == PREV_COL and "prev" in p:
                    keys.append((code, p["prev"], "month"))
                elif col == YTD_COL and "cur" in p:
                    keys.append((code, p["cur"], "ytd"))
            else:  # indicators
                keys = []
                if col == CUR_COL and "cur" in p:
                    keys.append((code, p["cur"], "month"))
                elif col == PREV_COL and "prev" in p:
                    keys.append((code, p["prev"], "month"))
            for k in keys:
                vmap.setdefault(txt, set()).add(k)
    return vmap


def build_tidied_keys(tidy_dir):
    """(code, period_end, measure) keys present in the tidied CSVs."""
    import pandas as pd  # noqa: PLC0415

    keys = set()
    df = pd.read_csv(tidy_dir / "tidy_assets.csv", dtype=str, keep_default_na=False)
    for code, pe in zip(df["code"], df["period_end"]):
        if code:
            keys.add((code, pe, None))
    for name in ("tidy_income.csv", "tidy_indicators.csv"):
        df = pd.read_csv(tidy_dir / name, dtype=str, keep_default_na=False)
        for code, pe, measure in zip(df["code"], df["period_end"], df["measure"]):
            if code:
                keys.add((code, pe, measure))
    return keys


def tidied_cells(tidy_dir):
    """Every cell string in the tidied CSVs (values, codes, dates, labels)."""
    strings = set()
    numbers = set()
    for path in sorted(tidy_dir.glob("tidy_*.csv")):
        import pandas as pd  # noqa: PLC0415

        df = pd.read_csv(path, dtype=str, keep_default_na=False)
        for col in df.columns:
            for v in df[col].astype(str):
                v = v.strip()
                strings.add(v)
                if NUM_RE.match(v):
                    numbers.add(v)
    return strings, numbers


def resolve_fund(path, fallback):
    try:
        return ufr.fund_from_name(path.name)
    except ValueError:
        if fallback:
            return fallback
        raise


def check_file(path, fund):
    from docling.document_converter import DocumentConverter  # noqa: PLC0415

    tidy_dir = ufr.fund_dirs(fund)[1]
    if not tidy_dir.exists():
        raise ValueError(f"no tidied data for fund '{fund}' at {tidy_dir}")

    print(f"== {path.name} (fund {fund})")
    result = DocumentConverter().convert(str(path))
    doc = result.document
    numbers, expected = collect_numbers(doc)
    tidied_strings, _ = tidied_cells(tidy_dir)

    missing = sorted(numbers - tidied_strings)
    missing_expected = sorted(n for n in missing if n in expected)
    vmap = build_value_map(doc)
    tidied_keys = build_tidied_keys(tidy_dir)
    restated = []
    missing_real = []
    for n in missing:
        if n in expected:
            continue
        claimed = vmap.get(n, set())
        if any(k in tidied_keys for k in claimed):
            restated.append(n)  # superseded by a newer report, not dropped
        else:
            missing_real.append(n)

    print(f"  numeric cells in report: {len(numbers)}")
    print(f"  missing from tidied: {len(missing)} "
          f"(expected by design: {len(missing_expected)}, "
          f"restated by newer report: {len(restated)}, real: {len(missing_real)})")
    for n in missing_expected[:8]:
        print(f"    [expected] {n}")
    for n in missing_real[:20]:
        print(f"    [MISSING] {n}")
    return numbers, not missing_real


def main():
    ap = argparse.ArgumentParser(description="Cross-check fund report numbers with Docling")
    ap.add_argument("paths", nargs="*", help="files to check (default: all funds' raw/)")
    ap.add_argument("--fund", help="fund id when a file name does not follow the standard pattern")
    args = ap.parse_args()

    ensure_docling()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    if args.paths:
        files = [Path(p) for p in args.paths]
    else:
        files = ufr.all_raw_files()
    if not files:
        print("no files found in public/data/*/raw/", file=sys.stderr)
        sys.exit(1)

    ok = True
    union = set()
    tidied_values = set()
    for f in files:
        if f.is_dir():
            continue
        try:
            fund = resolve_fund(f, args.fund)
            numbers, file_ok = check_file(f, fund)
            union |= numbers
            tidied_values |= tidied_cells(ufr.fund_dirs(fund)[1])[1]
            ok = file_ok and ok
        except Exception as exc:  # noqa: BLE001
            ok = False
            print(f"  [ERROR] {exc}")

    # 'extra' is evaluated once against the union of ALL reports: a tidied
    # value may legitimately come from another month's file.
    extra = sorted(tidied_values - union)
    print(f"tidied values not in ANY report: {len(extra)}")
    for n in extra[:20]:
        print(f"    [EXTRA] {n}")
    if extra:
        ok = False

    print("RESULT: " + ("CLEAN — every number in the reports is present in tidied" if ok
                        else "DISCREPANCIES FOUND — inspect the [MISSING]/[EXTRA] rows above"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
