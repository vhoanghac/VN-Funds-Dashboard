"""Backfill and update stock corporate actions from VCI through vnstock.

Local backfill:
    python -X utf8 scripts/stocks/update_vnstock_divs.py --symbol ACB

GitHub Actions mode:
    python -X utf8 scripts/stocks/update_vnstock_divs.py \
      --symbols-file scripts/stocks/div_symbols.txt --require-existing

The script fetches the complete requested date range because corporate-action
history is small. Existing rows are keyed by VCI event id, kind, and ex-date.
New events are appended; changed existing events stop the run before any file
is written.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import tempfile
from datetime import date
from pathlib import Path
from typing import Any, Iterable


ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "public" / "data" / "stocks"
DEFAULT_FROM_DATE = "2007-01-01"
DEFAULT_TAX_RATE = 0.05
DEFAULT_RIGHTS_PRICE = 10_000
PAGE_SIZE = 50
CSV_FIELDS = [
    "kind",
    "ex_date",
    "record_date",
    "pay_date",
    "last_date",
    "settlement_date",
    "amount_per_share",
    "tax_rate",
    "shares_per_share",
    "rights_per_share",
    "subscription_price",
    "choice",
    "funding",
    "source",
]
PENDING_CSV_FIELDS = [
    "kind",
    "ex_date",
    "record_date",
    "ratio",
    "subscription_price",
    "source",
]
SOURCE_ID_RE = re.compile(r"VCI event ([0-9a-f]+)", re.IGNORECASE)


class CorporateActionCorrection(RuntimeError):
    """Raised when VCI changes an event that is already in the CSV."""


class IncompleteCorporateAction(ValueError):
    """Raised when VCI has not published dates needed by the account ledger."""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", action="append", help="Stock symbol; repeat for multiple symbols")
    parser.add_argument("--symbols-file", type=Path, help="File containing one symbol per line")
    parser.add_argument("--from", dest="from_date", default=DEFAULT_FROM_DATE, help="First date, YYYY-MM-DD")
    parser.add_argument("--to", dest="to_date", default=date.today().isoformat(), help="Last date, YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true", help="Check and report without writing")
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="Replace each target file with the complete normalized VCI history",
    )
    parser.add_argument(
        "--require-existing",
        action="store_true",
        help="Fail if a target <SYMBOL>_div.csv does not already exist",
    )
    parser.add_argument(
        "--rights-price",
        type=int,
        default=DEFAULT_RIGHTS_PRICE,
        help="Assumed rights subscription price in VND (default: 10000)",
    )
    args = parser.parse_args(argv)
    validate_iso_date(args.from_date, "--from")
    validate_iso_date(args.to_date, "--to")
    if args.from_date > args.to_date:
        parser.error("--from must be before --to")
    if args.rights_price < 0:
        parser.error("--rights-price must be non-negative")
    if args.backfill and args.require_existing:
        parser.error("--backfill cannot be combined with --require-existing")
    return args


def load_symbols(args: argparse.Namespace) -> list[str]:
    symbols: list[str] = []
    for symbol in args.symbol or []:
        symbols.extend(parse_symbol_list(symbol))
    if args.symbols_file:
        symbols.extend(read_symbols_file(args.symbols_file))
    if not symbols:
        raise ValueError("Provide --symbol or --symbols-file")
    return list(dict.fromkeys(symbols))


def parse_symbol_list(value: str) -> list[str]:
    symbols = [item.strip().upper() for item in value.split(",") if item.strip()]
    for symbol in symbols:
        if not re.fullmatch(r"[A-Z0-9]{1,12}", symbol):
            raise ValueError(f"Invalid stock symbol: {symbol}")
    return symbols


def read_symbols_file(path: Path) -> list[str]:
    if not path.exists():
        raise FileNotFoundError(f"Symbols file not found: {path}")
    symbols: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            symbols.extend(parse_symbol_list(line))
    return symbols


def fetch_vci_events(symbol: str, from_date: str, to_date: str) -> list[dict[str, Any]]:
    """Fetch all DIV/ISS pages through vnstock's VCI provider adapter."""
    from vnstock import Company

    company = Company(source="VCI", symbol=symbol)
    provider = company.provider
    fetch_page = getattr(provider, "_fetch_events", None)
    if fetch_page is None:
        raise RuntimeError("Installed vnstock version has no VCI event pagination adapter")

    rows: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    page = 0
    while True:
        page_rows = fetch_page(
            event_codes="DIV,ISS",
            from_date=from_date.replace("-", ""),
            to_date=to_date.replace("-", ""),
            page=page,
            size=PAGE_SIZE,
        ) or []
        if not page_rows:
            break
        for row in page_rows:
            event_id = str(row.get("id", "")).strip()
            if event_id and event_id not in seen_ids:
                seen_ids.add(event_id)
                rows.append(row)
        if len(page_rows) < PAGE_SIZE:
            break
        page += 1
    return rows


def normalize_events(raw_rows: Iterable[dict[str, Any]], rights_price: int) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for row in raw_rows:
        try:
            event = normalize_event(row, rights_price)
        except IncompleteCorporateAction as error:
            print(f"WARNING: skipped incomplete corporate action: {error}")
            continue
        if event is not None:
            normalized.append(event)
    normalized.sort(key=lambda row: (row["ex_date"], row["kind"], source_id(row["source"])))
    return normalized


def normalize_pending_events(raw_rows: Iterable[dict[str, Any]], rights_price: int) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for row in raw_rows:
        try:
            event = normalize_pending_event(row, rights_price)
        except IncompleteCorporateAction as error:
            print(f"WARNING: skipped untrackable corporate action: {error}")
            continue
        if event is not None:
            normalized.append(event)
    normalized.sort(key=lambda row: (row["ex_date"], row["kind"], source_id(row["source"])))
    return normalized


def normalize_event(row: dict[str, Any], rights_price: int) -> dict[str, str] | None:
    event_id = str(value(row, "id") or "").strip()
    if not event_id:
        raise ValueError("VCI event has no id")
    event_code = str(value(row, "eventCode", "event_code") or "").strip().upper()
    title = " ".join(
        str(value(row, "eventTitleVi", "event_title_vi", "eventTitleEn", "event_title_en") or "")
        .lower()
        .split()
    )
    ex_date = iso_date(value(row, "exrightDate", "exright_date"))
    record_date = iso_date(value(row, "recordDate", "record_date"))
    listing_date = iso_date(value(row, "listingDate", "listing_date"))
    source = f"VCI event {event_id}"

    if event_code == "DIV":
        amount = positive_number(value(row, "valuePerShare", "value_per_share"), "valuePerShare", event_id)
        pay_date = iso_date(value(row, "payoutDate", "payout_date"))
        if not ex_date or not record_date or not pay_date:
            raise IncompleteCorporateAction(f"cash dividend {event_id} is missing an event date")
        return make_row(
            kind="cash_dividend",
            ex_date=ex_date,
            record_date=record_date,
            pay_date=pay_date,
            amount_per_share=format_number(amount),
            tax_rate=format_number(DEFAULT_TAX_RATE),
            source=source,
        )

    if event_code != "ISS":
        return None

    if "quyền mua" in title or "rights issue" in title:
        ratio = positive_number(value(row, "exerciseRatio", "exercise_ratio"), "exerciseRatio", event_id)
        if ratio <= 0:
            return None
        if not ex_date or not record_date or not listing_date:
            raise IncompleteCorporateAction(f"rights issue {event_id} is missing ex-date, record date, or listing date")
        return make_row(
            kind="rights_issue",
            ex_date=ex_date,
            record_date=record_date,
            last_date=listing_date,
            settlement_date=listing_date,
            rights_per_share=format_number(ratio),
            subscription_price=str(rights_price),
            choice="exercise",
            funding="external",
            source=f"{source}; price assumption",
        )

    if "cổ tức bằng cổ phiếu" in title or "cổ phiếu thưởng" in title or "stock dividend" in title:
        ratio = positive_number(value(row, "exerciseRatio", "exercise_ratio"), "exerciseRatio", event_id)
        if ratio <= 0:
            return None
        if not ex_date or not record_date or not listing_date:
            raise IncompleteCorporateAction(f"stock dividend {event_id} is missing ex-date, record date, or listing date")
        return make_row(
            kind="stock_dividend",
            ex_date=ex_date,
            record_date=record_date,
            pay_date=listing_date,
            shares_per_share=format_number(ratio),
            source=source,
        )

    return None


def normalize_pending_event(row: dict[str, Any], rights_price: int) -> dict[str, str] | None:
    event_id = str(value(row, "id") or "").strip()
    if not event_id:
        raise ValueError("VCI event has no id")
    event_code = str(value(row, "eventCode", "event_code") or "").strip().upper()
    title = " ".join(
        str(value(row, "eventTitleVi", "event_title_vi", "eventTitleEn", "event_title_en") or "")
        .lower()
        .split()
    )
    ex_date = iso_date(value(row, "exrightDate", "exright_date"))
    record_date = iso_date(value(row, "recordDate", "record_date"))
    listing_date = iso_date(value(row, "listingDate", "listing_date"))
    source = f"VCI event {event_id}"

    if event_code != "ISS":
        return None

    if "quyền mua" in title or "rights issue" in title:
        ratio = positive_number(value(row, "exerciseRatio", "exercise_ratio"), "exerciseRatio", event_id)
        if ratio <= 0 or listing_date:
            return None
        if not ex_date or not record_date:
            raise IncompleteCorporateAction(f"issuance {event_id} is missing ex-date or record date")
        return make_pending_row(
            kind="rights_issue",
            ex_date=ex_date,
            record_date=record_date,
            ratio=format_number(ratio),
            subscription_price=str(rights_price),
            source=f"{source}; price assumption",
        )

    if "cổ tức bằng cổ phiếu" in title or "cổ phiếu thưởng" in title or "stock dividend" in title:
        ratio = positive_number(value(row, "exerciseRatio", "exercise_ratio"), "exerciseRatio", event_id)
        if ratio <= 0 or listing_date:
            return None
        if not ex_date or not record_date:
            raise IncompleteCorporateAction(f"issuance {event_id} is missing ex-date or record date")
        return make_pending_row(
            kind="stock_dividend",
            ex_date=ex_date,
            record_date=record_date,
            ratio=format_number(ratio),
            source=source,
        )

    return None


def merge_rows(existing: list[dict[str, str]], incoming: list[dict[str, str]]) -> tuple[list[dict[str, str]], int]:
    existing_by_key: dict[tuple[str, str, str], dict[str, str]] = {}
    for row in existing:
        event_id = source_id(row["source"])
        if not event_id:
            raise ValueError(f"Missing VCI event id in source: {row['source']}")
        key = event_key(row)
        if key in existing_by_key:
            raise ValueError(f"Duplicate corporate action key in CSV: {key}")
        existing_by_key[key] = row

    merged = list(existing)
    new_count = 0
    for row in incoming:
        event_id = source_id(row["source"])
        key = event_key(row)
        previous = existing_by_key.get(key)
        if previous is None:
            merged.append(row)
            existing_by_key[key] = row
            new_count += 1
            continue
        if any(previous.get(field, "") != row.get(field, "") for field in comparable_fields(row["kind"])):
            raise CorporateActionCorrection(
                f"VCI changed event {event_id}: {describe_row(previous)} -> {describe_row(row)}"
            )

    merged.sort(key=lambda row: (row["ex_date"], row["kind"], source_id(row["source"])))
    return merged, new_count


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != CSV_FIELDS:
            raise ValueError(f"Unexpected CSV header in {path}: {reader.fieldnames}")
        rows = []
        for raw_row in reader:
            row = {field: (raw_row.get(field) or "") for field in CSV_FIELDS}
            # Early ACB exports had one fewer empty field, putting source in funding.
            if not row["source"] and row["funding"].startswith("VCI event "):
                row["source"], row["funding"] = row["funding"], ""
            rows.append(row)
    validate_rows(rows)
    return rows


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f"{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS, lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def read_pending_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != PENDING_CSV_FIELDS:
            raise ValueError(f"Unexpected CSV header in {path}: {reader.fieldnames}")
        rows = [{field: (raw_row.get(field) or "") for field in PENDING_CSV_FIELDS} for raw_row in reader]
    validate_pending_rows(rows)
    return rows


def write_pending_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f"{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=PENDING_CSV_FIELDS, lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def validate_rows(rows: list[dict[str, str]]) -> None:
    seen_keys: set[tuple[str, str, str]] = set()
    for row in rows:
        if row["kind"] not in {"cash_dividend", "stock_dividend", "rights_issue"}:
            raise ValueError(f"Unsupported corporate action kind: {row['kind']}")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", row["ex_date"]):
            raise ValueError(f"Invalid ex_date: {row['ex_date']}")
        event_id = source_id(row["source"])
        if not event_id:
            raise ValueError(f"Missing VCI event id in source: {row['source']}")
        key = event_key(row)
        if key in seen_keys:
            raise ValueError(f"Duplicate corporate action key: {key}")
        seen_keys.add(key)


def validate_pending_rows(rows: list[dict[str, str]]) -> None:
    seen_keys: set[tuple[str, str, str]] = set()
    for row in rows:
        if row["kind"] not in {"stock_dividend", "rights_issue"}:
            raise ValueError(f"Unsupported pending corporate action kind: {row['kind']}")
        for field in ("ex_date", "record_date"):
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", row[field]):
                raise ValueError(f"Invalid {field}: {row[field]}")
        if not row["ratio"] or float(row["ratio"]) <= 0:
            raise ValueError(f"Invalid pending ratio: {row['ratio']}")
        if row["kind"] == "rights_issue" and (not row["subscription_price"] or float(row["subscription_price"]) < 0):
            raise ValueError(f"Invalid pending subscription_price: {row['subscription_price']}")
        event_id = source_id(row["source"])
        if not event_id:
            raise ValueError(f"Missing VCI event id in pending source: {row['source']}")
        key = event_key(row)
        if key in seen_keys:
            raise ValueError(f"Duplicate pending corporate action key: {key}")
        seen_keys.add(key)


def value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row:
            return row[key]
    return None


def iso_date(raw: Any) -> str:
    if raw is None or str(raw).strip() in {"", "nan", "None"}:
        return ""
    return str(raw).strip().split("T", 1)[0]


def positive_number(raw: Any, field: str, event_id: str) -> float:
    try:
        number = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"Event {event_id} has invalid {field}: {raw}") from None
    if number < 0:
        raise ValueError(f"Event {event_id} has negative {field}: {raw}")
    return number


def format_number(number: float) -> str:
    return f"{number:g}"


def make_row(kind: str, source: str, **values: str) -> dict[str, str]:
    row = {field: "" for field in CSV_FIELDS}
    row.update(values)
    row["kind"] = kind
    row["source"] = source
    return row


def make_pending_row(kind: str, source: str, **values: str) -> dict[str, str]:
    row = {field: "" for field in PENDING_CSV_FIELDS}
    row.update(values)
    row["kind"] = kind
    row["source"] = source
    return row


def source_id(source: str) -> str:
    match = SOURCE_ID_RE.search(source or "")
    return match.group(1).lower() if match else ""


def event_key(row: dict[str, str]) -> tuple[str, str, str]:
    # VCI reuses some ids across years, so kind and ex-date are part of identity.
    return source_id(row["source"]), row["kind"], row["ex_date"]


def comparable_fields(kind: str) -> tuple[str, ...]:
    fields = {
        "cash_dividend": ("kind", "ex_date", "record_date", "pay_date", "amount_per_share", "tax_rate"),
        "stock_dividend": ("kind", "ex_date", "record_date", "pay_date", "shares_per_share"),
        "rights_issue": (
            "kind",
            "ex_date",
            "record_date",
            "last_date",
            "settlement_date",
            "rights_per_share",
            "subscription_price",
            "choice",
            "funding",
        ),
    }
    return fields[kind]


def merge_pending_rows(existing: list[dict[str, str]], incoming: list[dict[str, str]]) -> tuple[list[dict[str, str]], int]:
    existing_by_key: dict[tuple[str, str, str], dict[str, str]] = {}
    for row in existing:
        key = event_key(row)
        if key in existing_by_key:
            raise ValueError(f"Duplicate pending corporate action key in CSV: {key}")
        existing_by_key[key] = row

    merged = list(existing)
    new_count = 0
    for row in incoming:
        key = event_key(row)
        previous = existing_by_key.get(key)
        if previous is None:
            merged.append(row)
            existing_by_key[key] = row
            new_count += 1
            continue
        if previous != row:
            raise CorporateActionCorrection(
                f"VCI changed pending event {source_id(row['source'])}: {previous} -> {row}"
            )

    merged.sort(key=lambda row: (row["ex_date"], row["kind"], source_id(row["source"])))
    return merged, new_count


def remove_resolved_pending_rows(pending_rows: list[dict[str, str]], applied_rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], int]:
    resolved_keys = {event_key(row) for row in applied_rows}
    remaining = [row for row in pending_rows if event_key(row) not in resolved_keys]
    return remaining, len(pending_rows) - len(remaining)


def describe_row(row: dict[str, str]) -> str:
    return ",".join(f"{field}={row.get(field, '')}" for field in CSV_FIELDS if field != "source")


def validate_iso_date(value: str, label: str) -> None:
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{label} must be YYYY-MM-DD: {value}") from None
    if parsed.isoformat() != value:
        raise ValueError(f"{label} must be YYYY-MM-DD: {value}")


def update_symbol(symbol: str, args: argparse.Namespace) -> int:
    path = DATA_DIR / f"{symbol}_div.csv"
    pending_path = DATA_DIR / f"{symbol}_pending.csv"
    if args.require_existing and not path.exists():
        raise FileNotFoundError(f"Missing {path}; run local backfill first")
    raw_events = fetch_vci_events(symbol, args.from_date, args.to_date)
    incoming = normalize_events(raw_events, args.rights_price)
    pending_incoming = normalize_pending_events(raw_events, args.rights_price)
    if not incoming and not pending_incoming:
        raise ValueError(f"{symbol}: VCI returned no supported corporate actions")
    validate_rows(incoming)
    validate_pending_rows(pending_incoming)
    if args.backfill:
        print(f"{symbol}: backfill checked {len(raw_events)} VCI events, {len(incoming)} applied actions, {len(pending_incoming)} pending actions")
        if args.dry_run:
            print(f"{symbol}: dry run, no file written")
            return len(incoming) + len(pending_incoming)
        write_csv(path, incoming)
        if pending_incoming or pending_path.exists():
            write_pending_csv(pending_path, pending_incoming)
        print(f"{symbol}: backfilled {path} ({len(incoming)} rows), {pending_path} ({len(pending_incoming)} rows)")
        return len(incoming) + len(pending_incoming)

    existing = read_csv(path)
    merged, new_count = merge_rows(existing, incoming)
    existing_pending = read_pending_csv(pending_path)
    merged_pending, pending_new_count = merge_pending_rows(existing_pending, pending_incoming)
    merged_pending, resolved_count = remove_resolved_pending_rows(merged_pending, incoming)
    change_count = new_count + pending_new_count + resolved_count
    print(f"{symbol}: checked {len(raw_events)} VCI events, {len(incoming)} applied actions, {len(pending_incoming)} pending actions, {new_count} applied new, {pending_new_count} pending new, {resolved_count} resolved")
    if change_count == 0:
        print(f"{symbol}: already up to date ({len(existing)} applied, {len(existing_pending)} pending rows)")
        return 0
    if args.dry_run:
        print(f"{symbol}: dry run, no file written")
        return change_count
    write_csv(path, merged)
    if pending_path.exists() or pending_incoming or resolved_count:
        write_pending_csv(pending_path, merged_pending)
    print(f"{symbol}: wrote {path} ({len(existing)} -> {len(merged)} rows), {pending_path} ({len(existing_pending)} -> {len(merged_pending)} rows)")
    return change_count


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    symbols = load_symbols(args)
    api_key = os.environ.get("VNSTOCK_API_KEY")
    if api_key:
        from vnstock import register_user

        register_user(api_key=api_key)
    total_new = 0
    for symbol in symbols:
        total_new += update_symbol(symbol, args)
    print(f"Completed {len(symbols)} symbol(s), {total_new} new corporate action(s)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}")
        raise SystemExit(1) from error
