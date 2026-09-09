import unittest

from scripts.stocks.update_vnstock_divs import (
    CorporateActionCorrection,
    merge_rows,
    normalize_events,
    normalize_pending_events,
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

    def test_tracks_incomplete_current_events_without_applying_them(self):
        rows = normalize_pending_events([
            event("d00001", "ISS", "Trả Cổ tức bằng Cổ phiếu", "2026-08-11", "2026-08-12", exerciseRatio=0.15),
            event("d00002", "ISS", "Quyền mua CP cho Cổ đông hiện hữu", "2026-08-11", "2026-08-12", exerciseRatio=0.1),
        ], rights_price=10_000)

        by_kind = {row["kind"]: row for row in rows}
        self.assertEqual(by_kind["stock_dividend"]["ratio"], "0.15")
        self.assertEqual(by_kind["rights_issue"]["ratio"], "0.1")
        self.assertEqual(by_kind["rights_issue"]["subscription_price"], "10000")


if __name__ == "__main__":
    unittest.main()
