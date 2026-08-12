#!/usr/bin/env python
"""
Cross-check fund report numbers with Docling (independent reader).

Usage (run with the docling venv python, or let this script re-exec itself):
  python scripts/fund_reports_verify.py                      # all funds' raw/ dirs
  python scripts/fund_reports_verify.py <file.xlsx|pdf>...   # specific files
  python scripts/fund_reports_verify.py <file.pdf> --fund DCDS   # PDF without standard name

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
from pathlib import Path

import fund_reports_update as ufr  # reuses fund_from_name / fund_dirs

ROOT = Path(__file__).resolve().parent.parent

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
    print(f"  {DOCLING_VENVS[0] / 'Scripts' / 'python'} scripts\\fund_reports_verify.py")
    sys.exit(2)


def sheet_tables(doc):
    """Yield (sheet_name, table_item) pairs from the DoclingDocument."""
    for group in doc.groups:
        for child in group.children:
            idx = int(child.cref.split("/")[-1])
            yield group.name, doc.tables[idx]


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
        for cell in table.data.table_cells:
            txt = (cell.text or "").strip()
            if not NUM_RE.match(txt):
                continue
            all_numbers.add(txt)
            col = cell.start_col_offset_idx
            if col in stt_cols or (f_exception and col in f_cols):
                expected.add(txt)
    return all_numbers, expected


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
    missing_real = sorted(n for n in missing if n not in expected)
    missing_expected = sorted(n for n in missing if n in expected)

    print(f"  numeric cells in report: {len(numbers)}")
    print(f"  missing from tidied: {len(missing)} "
          f"(expected by design: {len(missing_expected)}, real: {len(missing_real)})")
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
