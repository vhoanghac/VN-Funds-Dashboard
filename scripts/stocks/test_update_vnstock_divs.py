import argparse
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from scripts.stocks.update_vnstock_divs import (
    REQUEST_ATTEMPTS,
    RETRY_ATTEMPTS,
    RETRY_DELAYS,
    CorporateActionCorrection,
    fetch_vci_events,
    fetch_vci_page,
    is_transient_error,
    main,
    merge_rows,
    normalize_events,
    normalize_pending_events,
    update_symbol,
    update_symbol_with_retry,
    write_csv,
)


def event(event_id, code, title, ex_date, record_date, **values):
    return {
        "id": event_id,
        "eventCode": code,
        "eventTitleVi": title,
        "exrightDate": f"{ex_date}T00:00:00",
        "recordDate": f"{record_date}T00:00:00",
        **values,
    }


class UpdateVnstockDivsTests(unittest.TestCase):
    def test_normalizes_supported_events_and_ignores_other_issuances(self):
        rows = normalize_events([
            event("a00001", "DIV", "Trả cổ tức bằng tiền mặt", "2026-01-01", "2026-01-02", payoutDate="2026-01-10T00:00:00", valuePerShare=700),
            event("a00002", "ISS", "Trả Cổ tức bằng Cổ phiếu", "2026-02-01", "2026-02-02", listingDate="2026-02-10T00:00:00", exerciseRatio=0.13),
            event("a00003", "ISS", "Quyền mua CP cho Cổ đông hiện hữu", "2026-03-01", "2026-03-02", listingDate="2026-03-10T00:00:00", exerciseRatio=0.2),
            event("a00004", "ISS", "Phát hành cổ phiếu cho CBCNV", "2026-04-01", "2026-04-02", listingDate="2026-04-10T00:00:00", exerciseRatio=0.1),
        ], rights_price=10_000)

        self.assertEqual([row["kind"] for row in rows], ["cash_dividend", "stock_dividend", "rights_issue"])
        self.assertEqual(rows[0]["amount_per_share"], "700")
        self.assertEqual(rows[1]["shares_per_share"], "0.13")
        self.assertEqual(rows[2]["subscription_price"], "10000")
        self.assertEqual(rows[2]["last_date"], "2026-03-10")

    def test_merge_is_idempotent_and_appends_new_events(self):
        existing = normalize_events([
            event("b00001", "DIV", "Trả cổ tức bằng tiền mặt", "2026-01-01", "2026-01-02", payoutDate="2026-01-10T00:00:00", valuePerShare=700),
        ], rights_price=10_000)
        incoming = normalize_events([
            event("b00001", "DIV", "Trả cổ tức bằng tiền mặt", "2026-01-01", "2026-01-02", payoutDate="2026-01-10T00:00:00", valuePerShare=700),
            event("b00001", "DIV", "Trả cổ tức bằng tiền mặt", "2026-02-01", "2026-02-02", payoutDate="2026-02-10T00:00:00", valuePerShare=500),
        ], rights_price=10_000)

        merged, new_count = merge_rows(existing, incoming)
        self.assertEqual(new_count, 1)
        self.assertEqual(len(merged), 2)
        merged_again, new_count_again = merge_rows(merged, incoming)
        self.assertEqual(new_count_again, 0)
        self.assertEqual(merged_again, merged)

    def test_merge_rejects_corrections_to_existing_events(self):
        existing = normalize_events([
            event("c00001", "DIV", "Trả cổ tức bằng tiền mặt", "2026-01-01", "2026-01-02", payoutDate="2026-01-10T00:00:00", valuePerShare=700),
        ], rights_price=10_000)
        changed = normalize_events([
            event("c00001", "DIV", "Trả cổ tức bằng tiền mặt", "2026-01-01", "2026-01-02", payoutDate="2026-01-10T00:00:00", valuePerShare=800),
        ], rights_price=10_000)

        with self.assertRaises(CorporateActionCorrection):
            merge_rows(existing, changed)

    def test_ignores_incomplete_current_events_until_vci_has_all_dates(self):
        rows = normalize_events([
            event("d00001", "ISS", "Trả Cổ tức bằng Cổ phiếu", "2026-08-11", "2026-08-12", exerciseRatio=0.15),
        ], rights_price=10_000)

        self.assertEqual(rows, [])

    def test_ignores_unsupported_issuance_without_ratio(self):
        raw_event = event("e00001", "ISS", "Phát hành cổ phiếu - Chuyển từ trái phiếu chuyển đổi", "", "")

        self.assertEqual(normalize_events([raw_event], rights_price=10_000), [])
        self.assertEqual(normalize_pending_events([raw_event], rights_price=10_000), [])

    def test_tracks_incomplete_current_events_without_applying_them(self):
        rows = normalize_pending_events([
            event("d00001", "ISS", "Trả Cổ tức bằng Cổ phiếu", "2026-08-11", "2026-08-12", exerciseRatio=0.15),
            event("d00002", "ISS", "Quyền mua CP cho Cổ đông hiện hữu", "2026-08-11", "2026-08-12", exerciseRatio=0.1),
        ], rights_price=10_000)

        by_kind = {row["kind"]: row for row in rows}
        self.assertEqual(by_kind["stock_dividend"]["ratio"], "0.15")
        self.assertEqual(by_kind["rights_issue"]["ratio"], "0.1")
        self.assertEqual(by_kind["rights_issue"]["subscription_price"], "10000")


class RetryTests(unittest.TestCase):
    @patch("scripts.stocks.update_vnstock_divs.time.sleep")
    @patch("scripts.stocks.update_vnstock_divs.update_symbol")
    def test_non_transient_error_raises_without_retry(self, m_update, m_sleep):
        m_update.side_effect = CorporateActionCorrection("bad")
        with self.assertRaises(CorporateActionCorrection):
            update_symbol_with_retry("ACB", argparse.Namespace())
        self.assertEqual(m_update.call_count, 1)
        m_sleep.assert_not_called()

    @patch("scripts.stocks.update_vnstock_divs.time.sleep")
    @patch("scripts.stocks.update_vnstock_divs.update_symbol")
    def test_transient_error_retries_then_raises(self, m_update, m_sleep):
        m_update.side_effect = ConnectionError("Read timed out")
        with self.assertRaises(ConnectionError):
            update_symbol_with_retry("ACB", argparse.Namespace())
        self.assertEqual(m_update.call_count, RETRY_ATTEMPTS)
        self.assertEqual(m_sleep.call_count, RETRY_ATTEMPTS - 1)

    @patch("scripts.stocks.update_vnstock_divs.time.sleep")
    @patch("scripts.stocks.update_vnstock_divs.update_symbol")
    def test_transient_error_succeeds_on_second_attempt(self, m_update, m_sleep):
        m_update.side_effect = [ConnectionError("timeout"), 3]
        self.assertEqual(update_symbol_with_retry("ACB", argparse.Namespace()), 3)
        self.assertEqual(m_update.call_count, 2)
        self.assertEqual(m_sleep.call_count, 1)

    def test_is_transient_error_classification(self):
        self.assertFalse(is_transient_error(CorporateActionCorrection("x")))
        self.assertFalse(is_transient_error(FileNotFoundError("x")))
        self.assertFalse(is_transient_error(ValueError("invalid date")))
        self.assertTrue(is_transient_error(ConnectionError("Read timed out")))
        self.assertTrue(is_transient_error(RuntimeError("API request failed")))
        self.assertTrue(is_transient_error(RuntimeError("connection reset")))

    @patch("scripts.stocks.update_vnstock_divs.time.sleep")
    @patch("scripts.stocks.update_vnstock_divs.update_symbol")
    def test_transient_error_uses_backoff_ladder(self, m_update, m_sleep):
        m_update.side_effect = ConnectionError("Read timed out")

        with self.assertRaises(ConnectionError):
            update_symbol_with_retry("ACB", argparse.Namespace())

        delays = [call.args[0] for call in m_sleep.call_args_list]
        self.assertEqual(delays, list(RETRY_DELAYS))


def _fail_on(symbol_to_fail):
    def run(symbol, _args):
        if symbol == symbol_to_fail:
            raise ConnectionError("Read timed out")
        return 1

    return run


class EmptyWindowTests(unittest.TestCase):
    def _existing_rows(self):
        return normalize_events([
            event("a00001", "DIV", "Trả cổ tức bằng tiền mặt", "2020-01-01", "2020-01-02", payoutDate="2020-01-10T00:00:00", valuePerShare=700),
        ], rights_price=10_000)

    @patch("scripts.stocks.update_vnstock_divs.fetch_vci_events", return_value=[])
    def test_empty_window_is_a_noop_and_keeps_the_file(self, _m_fetch):
        from scripts.stocks import update_vnstock_divs as mod

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            div = tmp_dir / "ZZZ_div.csv"
            write_csv(div, self._existing_rows())
            before = div.read_text(encoding="utf-8")
            args = argparse.Namespace(
                from_date="2025-01-01", to_date="2026-01-01",
                require_existing=True, backfill=False, dry_run=False, rights_price=10_000,
            )

            with patch.object(mod, "DATA_DIR", tmp_dir):
                self.assertEqual(update_symbol("ZZZ", args), 0)

            self.assertEqual(div.read_text(encoding="utf-8"), before)

    @patch("scripts.stocks.update_vnstock_divs.fetch_vci_events", return_value=[])
    def test_empty_result_fails_a_backfill(self, _m_fetch):
        from scripts.stocks import update_vnstock_divs as mod

        with tempfile.TemporaryDirectory() as tmp:
            args = argparse.Namespace(
                from_date="2007-01-01", to_date="2026-01-01",
                require_existing=False, backfill=True, dry_run=False, rights_price=10_000,
            )

            with patch.object(mod, "DATA_DIR", Path(tmp)):
                with self.assertRaises(ValueError):
                    update_symbol("ZZZ", args)


class MainLoopTests(unittest.TestCase):
    @patch("scripts.stocks.update_vnstock_divs.update_symbol_with_retry")
    @patch("scripts.stocks.update_vnstock_divs.load_symbols")
    @patch("scripts.stocks.update_vnstock_divs.parse_args")
    def test_continues_after_a_symbol_fails_and_returns_1(self, m_parse, m_load, m_retry):
        m_parse.return_value = argparse.Namespace(symbol=None, symbols_file=None)
        m_load.return_value = ["AAA", "BBB", "CCC"]
        m_retry.side_effect = _fail_on("BBB")

        with patch.dict(os.environ, {"VNSTOCK_API_KEY": ""}):
            exit_code = main([])

        self.assertEqual(exit_code, 1)
        self.assertEqual([call.args[0] for call in m_retry.call_args_list], ["AAA", "BBB", "CCC"])

    @patch("scripts.stocks.update_vnstock_divs.update_symbol_with_retry")
    @patch("scripts.stocks.update_vnstock_divs.load_symbols")
    @patch("scripts.stocks.update_vnstock_divs.parse_args")
    def test_returns_0_when_all_symbols_succeed(self, m_parse, m_load, m_retry):
        m_parse.return_value = argparse.Namespace(symbol=None, symbols_file=None)
        m_load.return_value = ["AAA", "BBB"]
        m_retry.return_value = 2

        with patch.dict(os.environ, {"VNSTOCK_API_KEY": ""}):
            exit_code = main([])

        self.assertEqual(exit_code, 0)
        self.assertEqual(m_retry.call_count, 2)


class FetchVciPageTests(unittest.TestCase):
    """VCI hangs on a share of requests, so each request retries in place."""

    def _response(self, status=200, payload=None, reason="OK"):
        response = Mock()
        response.status_code = status
        response.reason = reason
        if payload is None:
            response.json.side_effect = ValueError("Expecting value: line 1 column 1")
        else:
            response.json.return_value = payload
        return response

    @patch("scripts.stocks.update_vnstock_divs.time.sleep")
    @patch("scripts.stocks.update_vnstock_divs.requests.get")
    def test_retries_a_hang_then_succeeds(self, m_get, m_sleep):
        m_get.side_effect = [
            requests.exceptions.ReadTimeout("Read timed out"),
            requests.exceptions.ReadTimeout("Read timed out"),
            self._response(payload={"data": {"content": [{"id": "a1"}]}}),
        ]

        self.assertEqual(fetch_vci_page("ACB", "2024-09-30", "2026-09-30", 0, 50), [{"id": "a1"}])
        self.assertEqual(m_get.call_count, 3)
        self.assertEqual(m_sleep.call_count, 2)

    @patch("scripts.stocks.update_vnstock_divs.time.sleep")
    @patch("scripts.stocks.update_vnstock_divs.requests.get")
    def test_raises_only_after_every_attempt(self, m_get, m_sleep):
        m_get.side_effect = requests.exceptions.ReadTimeout("Read timed out")

        with self.assertRaises(ConnectionError) as caught:
            fetch_vci_page("ACB", "2024-09-30", "2026-09-30", 0, 50)

        self.assertEqual(m_get.call_count, REQUEST_ATTEMPTS)
        self.assertEqual(m_sleep.call_count, REQUEST_ATTEMPTS - 1)
        self.assertIn(f"after {REQUEST_ATTEMPTS} attempts", str(caught.exception))

    @patch("scripts.stocks.update_vnstock_divs.time.sleep")
    @patch("scripts.stocks.update_vnstock_divs.requests.get")
    def test_retries_a_body_that_is_not_json(self, m_get, _m_sleep):
        m_get.side_effect = [
            self._response(),
            self._response(payload={"data": {"content": [{"id": "b1"}]}}),
        ]

        self.assertEqual(fetch_vci_page("ACB", "2024-09-30", "2026-09-30", 0, 50), [{"id": "b1"}])
        self.assertEqual(m_get.call_count, 2)

    @patch("scripts.stocks.update_vnstock_divs.time.sleep")
    @patch("scripts.stocks.update_vnstock_divs.requests.get")
    def test_retries_a_retryable_status(self, m_get, m_sleep):
        m_get.side_effect = [
            self._response(status=503, reason="Service Unavailable"),
            self._response(payload={"data": {"content": []}}),
        ]

        self.assertEqual(fetch_vci_page("ACB", "2024-09-30", "2026-09-30", 0, 50), [])
        self.assertEqual(m_get.call_count, 2)
        self.assertEqual(m_sleep.call_count, 1)

    @patch("scripts.stocks.update_vnstock_divs.time.sleep")
    @patch("scripts.stocks.update_vnstock_divs.requests.get")
    def test_does_not_retry_a_client_error(self, m_get, m_sleep):
        m_get.side_effect = self._response(status=404, reason="Not Found")

        with self.assertRaises(ConnectionError):
            fetch_vci_page("ACB", "2024-09-30", "2026-09-30", 0, 50)

        self.assertEqual(m_get.call_count, 1)
        m_sleep.assert_not_called()

    @patch("scripts.stocks.update_vnstock_divs.fetch_vci_page")
    def test_pages_until_a_short_page_and_dedupes(self, m_page):
        first = [{"id": f"e{index}"} for index in range(50)]
        m_page.side_effect = [first, [{"id": "e0"}, {"id": "last"}]]

        rows = fetch_vci_events("ACB", "2007-01-01", "2026-09-30")

        self.assertEqual(len(rows), 51)
        self.assertEqual(m_page.call_args_list[0].args, ("ACB", "2007-01-01", "2026-09-30", 0, 50))
        self.assertEqual(m_page.call_args_list[1].args, ("ACB", "2007-01-01", "2026-09-30", 1, 50))


if __name__ == "__main__":
    unittest.main()
