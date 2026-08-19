# Fund Report Pipeline — từ báo cáo quỹ đến tab Overlap

Thư mục này chứa toàn bộ script liên quan đến **báo cáo tài chính quỹ mở** và **danh
mục đầu tư (holdings)** cho tab Overlap. Đây là xương sống dữ liệu của dashboard: từ
file báo cáo tháng do quỹ công bố, pipeline biến thành dữ liệu sạch mà trình duyệt đọc.

README này viết để **AI và người mới đọc lại sau này hiểu ngay** — mỗi bước ghi rõ
làm gì, hoạt động ra sao, tại sao làm vậy, và kết quả của bước đó đưa workflow đi đâu.

---

## Tổng quan pipeline

```
        Bước 1                 Bước 2              Bước 3                Bước 4
  ┌─────────────────┐    ┌────────────────┐    ┌───────────────┐    ┌──────────────────────┐
  │ download_...    │    │ fund_reports_  │    │ fund_reports_ │    │ fund_reports_to_     │
  │ dragoncapital   │───▶│ update         │───▶│ verify        │───▶│ holdings             │
  │ (xlsx về raw/)  │    │ (xlsx→tidied)  │    │ (Docling so)  │    │ (tidied→holdings)    │
  └─────────────────┘    └────────────────┘    └───────────────┘    └──────────┬───────────┘
       tải báo cáo          chuyển đổi           đối chiếu độc lập     sinh dữ liệu tab Overlap
                                                                                │
                                                                                ▼
                                                          ┌───────────────────────────────┐
                                                           │ public/data/holdings/          │
                                                           │ <FUND>_holdings.csv            │
                                                           │ <FUND>_industry.csv            │
                                                          │ + holdings_index.json          │
                                                          │ + industry_map.json            │
                                                          └───────────────────────────────┘
```

Mỗi bước nhận **đầu vào ổn định**, xuất **đầu ra ổn định**. Không bước nào sửa
output của bước trước trực tiếp; muốn thay đổi thì chạy lại bước đó. Nhờ vậy, một
mắt xích hỏng chỉ cần sửa đúng chỗ, không lan.

---

## Kiến trúc dữ liệu (bắt buộc nắm trước)

Tất cả dữ liệu nằm trong `public/data/`, mỗi quỹ một thư mục riêng:

```
public/data/
  <FUND>/                      ← thư mục của từng quỹ (vd DCDS)
    raw/                       ← file xlsx gốc, GITIGNORED (không commit)
      <FUND>_<YYYY>_<MM>.xlsx
    tidied/                    ← dữ liệu sạch, long-format, COMMIT (audit được bằng mắt)
      tidy_assets.csv          ← bảng cân đối tài sản (BCTaiSan)
      tidy_income.csv          ← kết quả hoạt động (BCKetQuaHoatDong)
      tidy_portfolio.csv       ← danh mục đầu tư (BCDanhMucDauTu) ← nguồn của holdings
      tidy_indicators.csv      ← chỉ số khác (Khac)
      tidy_borrowing.csv       ← hoạt động vay (BCHoatDongVay)
      tidy_metadata.json       ← thông tin từng file nguồn
      tidied_index.json        ← bản kê (audit manifest)

  holdings/                     ← dữ liệu danh mục cho tab Overlap
    <FUND>_holdings.csv         ← danh mục đầy đủ (STOCK/BOND/CASH/OTHER)
    <FUND>_industry.csv         ← tổng tỷ trọng theo ngành (chỉ cổ phiếu)
  holdings_index.json          ← quỹ nào có holdings, kỳ mới nhất, nguồn dữ liệu
  industry_map.json            ← map ticker → ngành (vnstock), tĩnh, COMMIT
```

**Tên file chuẩn `<FUND>_<YYYY>_<MM>.xlsx` là khóa của toàn pipeline.** Quỹ được
xác định từ phần trước dấu `_` đầu tiên. File sai tên hoặc để sai thư mục sẽ bị
từ chối (ValueError) — không bao giờ đoán, không bao giờ ghi nhầm vào quỹ khác.

---

## Ba nguồn dữ liệu danh mục (quan trọng cho tab Overlap)

Tab Overlap đọc `holdings/<FUND>_holdings.csv`. Dữ liệu đó đến từ **3 nguồn**, phân biệt qua
field `source` trong `holdings_index.json`:

| source | Nguồn | Ghi chú |
|---|---|---|
| `report` | Báo cáo tài chính chính thức (pipeline này) | **Tin cậy nhất**, đầy đủ, có lịch sử theo kỳ |
| `digiinvest` | digiinvest.vn (backfill) | Danh mục đầy đủ, có lịch sử 2025→ |
| `fmarket` | fmarket API (top-10) | Chỉ top-10, không có BOND/CASH/OTHER, cho quỹ chưa có nguồn khác |

**Quy tắc bảo vệ:** quỹ nào đã có `source: 'report'` thì **không bị** `update_holdings.py`
(fmarket) hay `backfill_holdings_digiinvest.py` (digiinvest) ghi đè. Báo cáo chính thức
là nguồn cuối cùng. Hai script kia có guard từ đầu vòng lặp:
```python
if any(e.get('source') == 'report' for e in index if e.get('id') == fund_id):
    continue  # bỏ qua, không append
```

---

## Bước 1: Download — `download_dragoncapital_reports.py`

**Làm gì:** tải báo cáo tháng (xlsx) từ trang công bố của quỹ về `public/data/<FUND>/raw/`,
chuẩn hoá tên về `<FUND>_<YYYY>_<MM>.xlsx`.

**Hoạt động ra sao:** trang công bố (dragoncapital.com.vn) là Salesforce Lightning với
shadow DOM — thẻ `<a>` nằm sâu trong DOM chìm. Script mở trình duyệt thật (Playwright
headless, tái dùng Chromium đã cài sẵn), quét toàn bộ shadow root để gom link
`blob.core.windows.net`, chọn từng năm trong dropdown "Năm", cuộn cho đến khi danh
sách ổn định. Tên file trên Azure Blob trải qua **3 thời kỳ**:
- `DCDS_BC_THANG_<MM><YYYY>.xlsx` (2024-08 trở đi, không prefix)
- `<id>_DCDS_BC_Thang_<MM><YYYY>.xlsx` (~2022-2024, có prefix số CMS — không đoán được)
- `<id>_VFMVF1_BC_Thang_<MM><YYYY>.xlsx` (2018-2019, quỹ còn tên cũ VFMVF1)

Script cũng **probe thẳng blob** cho tháng bị sót (era không prefix, thử cả 2 cách viết
THANG/Thang) — vì cuộn trang có thể bỏ lọt tháng. Tên cũ trong `raw/` được rename về
chuẩn, file trùng (cùng dung lượng) bị xoá.

**Tại sao làm vậy:** tên file chuẩn là khóa của pipeline (xem mục Kiến trúc). Vì không
thể đoán prefix CMS nên phải scrape trang; vì scrape có thể sót nên phải probe bù.

**Workflow ra sao:** mỗi khi quỹ công bố báo cáo tháng mới, chạy lệnh này → file mới
nằm trong `raw/`. Đây là **bước thủ công duy nhất** trong pipeline (không tự động qua
workflow) vì cần xác nhận báo cáo đã công bố.

```bash
python -X utf8 scripts/fund_report/download_dragoncapital_reports.py                        # DCDS, mọi năm
python -X utf8 scripts/fund_report/download_dragoncapital_reports.py --fund DCBF --url <page> # quỹ DC khác
python -X utf8 scripts/fund_report/download_dragoncapital_reports.py --start-year 2024 --end-year 2026
```

Idempotent: file đã có thì skip; chạy lại không nhân đôi.

---

## Bước 2: Convert — `fund_reports_update.py`

**Làm gì:** đọc mọi file xlsx trong `raw/`, chuyển thành **CSV long-format** trong
`tidied/` (5 bảng + metadata + index), kèm kiểm tra nội bộ.

**Hoạt động ra sao:** dùng openpyxl (không dùng Excel) + pandas. Mỗi sheet tương ứng
một bảng (BCTaiSan, BCKetQuaHoatDong, BCDanhMucDauTu, Khac, BCHoatDongVay). Cột
`line_item` lấy **phần tiếng Anh** của ô "Tiếng Việt\nEnglish" (template báo cáo
Thông tư 98/2020). Dòng `...`/rỗng bị bỏ. Dedupe giữ bản `asOf` mới nhất.

**3 era template phải xử lý** (đã kiểm chứng trên toàn bộ kho DCDS 2018-2026):
- **2018-2020:** Unicode NFD (chuẩn hoá NFC), bảng phái sinh append sau portfolio chính
  (dừng đọc ở "Total value of portfolio"), mã sheet vay 2287-2297 không có cột code,
  label NAV lệch template ('= I.8 - II.3' vs '= I.10 - II.4' — chuẩn hoá).
- **2021-2022:** cột mã để trống toàn bộ. Backfill mã từ bản đồ 2023+ cho nhãn không
  mơ hồ; nhãn mơ hồ giữ code rỗng (không đoán).
- **2023+:** mẫu chuẩn, có code đầy đủ.

**Tại sao CSV long-format:** dễ audit bằng mắt, ổn định, đọc được bằng mọi công cụ.
Mỗi dòng một số liệu với đủ (code, line_item, period, value, asOf).

**Workflow ra sao:** chạy sau khi có file mới trong `raw/`. File mới được merge vào
bảng đã có (không ghi đè lịch sử), dedupe theo (code, line_item, period). Sau bước
này `tidied/` đầy đủ cho đến kỳ mới nhất.

```bash
python -X utf8 scripts/fund_report/fund_reports_update.py                    # toàn bộ quỹ
python -X utf8 scripts/fund_report/fund_reports_update.py <file.xlsx> ...    # file cụ thể
python -X utf8 scripts/fund_report/fund_reports_update.py --check            # so, không ghi
```

**`--check` là kiểm tra hồi quy:** dựng lại toàn bộ từ xlsx rồi so với `tidied/` trên
đĩa — lệch bất kỳ đâu là báo. Chạy sau mỗi lần đụng logic chuyển đổi.

**Trước khi ghi bất kỳ file nào, `validate_file` chạy đối soát nội bộ** (tài sản =
nợ + NAV, thu nhập = doanh thu − chi phí, tổng danh mục = tổng section...). Lệch là
dừng ngay, không âm thầm sửa.

---

## Bước 3: Verify — `fund_reports_verify.py`

**Làm gì:** đối chiếu độc lập toàn bộ con số trong xlsx với `tidied/`, dùng một công
cụ đọc khác hẳn (Docling) thay vì openpyxl.

**Hoạt động ra sao:** Docling (IBM, đọc cả xlsx lẫn PDF tương lai) nằm trong venv
riêng ngoài repo (`C:\Users\vohac\.venvs\docling`, vì repo trong Google Drive ~2.5GB).
Script tự dò venv và re-exec nếu bị gọi bằng python hệ thống. Docling tách sheet
thành các ô số, script so **2 chiều** với tidied: số nào tidied thiếu (MISSING), số
nào thừa (EXTRA). Hai implementation độc lập đọc cùng file → nếu cả hai cho cùng
kết quả thì tin được.

**Ngoại lệ cố tình:** cột STT và cột F ("%/cùng kỳ") của BCTaiSan bị bỏ (nhận diện
bằng text header, không hardcode). Số thuộc (code, period) đã có trong tidied với
`asOf` mới hơn = bị quỹ hiệu chỉnh (restatement), không phải lỗi.

**Tại sao làm vậy:** báo cáo là nguồn chính thức, phải chắc chắn converter không
sót/không bịa số nào. Chạy trên **toàn bộ** các file (không phải subset) mới có ý
nghĩa — subset sẽ báo EXTRA ồ ạt vì tidied còn kỳ khác.

**Workflow ra sao:** sau bước Convert, chạy verify. Chỉ khi ra `RESULT: CLEAN` mới
coi là xong. Lệch chỗ nào là dừng lại, soi số đó trước khi làm tiếp.

```bash
python -X utf8 scripts/fund_report/fund_reports_verify.py                     # toàn bộ quỹ
python -X utf8 scripts/fund_report/fund_reports_verify.py <file.xlsx|pdf>...  # file cụ thể
python -X utf8 scripts/fund_report/fund_reports_verify.py <file.pdf> --fund DCDS  # PDF không tên chuẩn
```

---

## Bước 4: Sinh holdings Overlap — `fund_reports_to_holdings.py`

**Làm gì:** đọc `tidied/tidy_portfolio.csv` (bảng danh mục đầu tư) → sinh
`holdings/<FUND>_holdings.csv` + `holdings/<FUND>_industry.csv`, cập nhật `holdings_index.json`
(`source: 'report'`). Đây là bước biến "báo cáo" thành "dữ liệu tab Overlap".

**Hoạt động ra sao — chuyển đổi portfolio** (đã kiểm chứng 3 era):

- **STOCK** = dòng trong section chứa SHARES/EQUITY/FUND CERTIFICATES, ticker 3 ký tự.
  Dòng subtotal (2247/2249/2250...) có ticker rỗng → tự loại. Cổ phiếu **unlisted**
  có tên dài ("VPBANK SECURITIES...") được giữ (section chứa UNLISTED); ETF bị loại.
- **BOND / CASH / OTHER** gom thành **1 dòng** từ dòng tổng (ticker rỗng) của section.
- **Bẫy lớn nhất:** dòng `2255` trong section "OTHER SECURITIES" là **grand-total** của
  toàn bộ chứng khoán (stocks+bonds+other, ~72-96% NAV), KHÔNG phải "tài sản khác".
  Loại bằng ngưỡng `weight > 0.5` — subtotal thật (rights, futures) luôn nhỏ, grand
  total luôn chiếm phần lớn danh mục.
- `weight` (fraction, 1.0 = 100% NAV) ×100 → `weight_pct`; `period_end` (cuối tháng)
  → `date` `YYYY-MM-01` khớp format digiinvest/fmarket để selector kỳ nối được giữa
  các quỹ khác nguồn.
- **Ngành** đọc từ `industry_map.json` tĩnh (không gọi API khi chạy thường).

**Merge semantics:** kỳ nào `tidy_portfolio` có → ghi đè; kỳ không có (kỳ mới do
fmarket/digiinvest append) → giữ nguyên. Không xoá lịch sử của nhau.

**Tại sao làm vậy:** báo cáo chính thức là nguồn tin cậy nhất — đầy đủ, do quỹ công
bố, có lịch sử theo kỳ (DCDS: 92 kỳ 2018-2026, gấp ~5 lần digiinvest 18 kỳ).

**Workflow ra sao:** sau khi Convert + Verify xanh, chạy bước này → tab Overlap có
danh mục đầy đủ + lịch sử. Chạy lại khi muốn cập nhật quỹ có `tidied/`.

```bash
python -X utf8 scripts/fund_report/fund_reports_to_holdings.py DCDS          # một quỹ
python -X utf8 scripts/fund_report/fund_reports_to_holdings.py               # mọi quỹ có tidied/
python -X utf8 scripts/fund_report/fund_reports_to_holdings.py DCDS --refresh # + cập nhật industry_map
```

**`--refresh` và `industry_map.json`:** ngành cổ phiếu gần như không đổi, nên map
ticker→ngành được **chụp thành file tĩnh commit vào repo** (720 mã từ vnstock +
24 mã fallback thủ công). Chạy thường chỉ **đọc** file — nếu vnstock lỗi lúc chạy
thì không bị ảnh hưởng. Chỉ khi có mã mới / muốn cập nhật mới cần `--refresh`
(gọi vnstock, ghi đè file); API lỗi lúc đó thì **dừng**, giữ file cũ.

**Chuẩn hoá tên ngành:** `norm_industry` thay dấu phẩy trong tên ngành (', ' → ' - ')
vì cả Python lẫn TS parser (`src/utils/overlap.ts`) split CSV theo dấu phẩy không
xử lý quote. Ngoài ra `overlap.ts` có `INDUSTRY_NORMALIZE` map từ vựng digiinvest
(BĐS, Vật liệu, Dầu khí...) → vnstock (Bất động sản, Vật liệu xây dựng, Khai
khoáng...) để sector drift giữa quỹ khác nguồn nối đúng ngành.

---

## Quan hệ với workflow hàng ngày

Có **một** script trong pipeline này được `.github/workflows/update_daily.yml` gọi
mỗi ngày: `update_holdings.py` (fmarket holdings cho tab Overlap). Ba bước còn lại
(download → convert → verify) chạy **thủ công** khi có báo cáo mới — workflow không
tự tải báo cáo vì cần xác nhận quỹ đã công bố.

Chi tiết về pipeline giá/NAV hàng ngày nằm ở `scripts/README.md`.

---

## Bước 5: Các nguồn holdings khác

### `update_holdings.py` — fmarket (chạy hàng ngày qua workflow)

Lấy top-10 cổ phiếu + ngành từ fmarket API (1 request/quỹ, không rate limit).
`date` = kỳ báo cáo (reportTime), append 1 snapshot/kỳ mới, skip kỳ đã có. Quỹ
`source: 'report'` bị bỏ qua từ đầu vòng lặp.

Chạy tự động mỗi ngày qua `.github/workflows/update_daily.yml`.

### `backfill_holdings_digiinvest.py` — digiinvest (thủ công, GITIGNORED)

Backfill lịch sử holdings đầy đủ từ digiinvest Firestore (playwright đọc IndexedDB
sau App Check). Merge với file hiện có: kỳ digiinvest có → ghi đè bằng danh mục đầy
đủ; kỳ không có → giữ. Quỹ `source: 'report'` bị bỏ qua. File bị gitignore vì là
công cụ một lần cho máy local (theo yêu cầu), chạy thủ công khi cần snapshot mới.

```bash
python -X utf8 scripts/fund_report/backfill_holdings_digiinvest.py
```

---

## Mở rộng quỹ mới (kiến trúc tương lai)

Pipeline thiết kế để thêm quỹ nhanh, nhất quán. Checklist thêm một quỹ:

1. **Metadata:** thêm quỹ vào `public/data/fund_metadata.json` (id, name, type).
2. **Download:** quỹ Dragon Capital → chạy `download_dragoncapital_reports.py --fund <ID> --url <trang-sản-phẩm>`.
   Quỹ khác công ty → viết script download riêng (tên `download_<nguồn>_reports.py`),
   nhưng **đầu ra phải cùng chuẩn**: file `raw/<FUND>_<YYYY>_<MM>.xlsx`.
3. **Convert:** `fund_reports_update.py <FUND>` — nếu mẫu báo cáo khác, sửa
   `SHEET_NAMES`/`VALUE_COLS`; script dừng to khi không hiểu, không đoán.
4. **Verify:** `fund_reports_verify.py <FUND>` → phải `RESULT: CLEAN`.
5. **Holdings:** `fund_reports_to_holdings.py <FUND>` → tự set `source: 'report'`
   → tự được bảo vệ khỏi fmarket/digiinvest.

Các bước 2-5 dùng chung toàn bộ phần còn lại. Chỉ phần "lấy file xlsx về raw/ theo
tên chuẩn" là khác nhau theo nguồn công bố.

---

## Bảo trì

- `public/data/<FUND>/raw/` **gitignored** (xlsx gốc nặng, không lên repo). Chỉ commit
  `tidied/` + `holdings/<FUND>_holdings.csv` + `holdings/<FUND>_industry.csv` + index + map.
- Quỹ đổi mẫu báo cáo → script **dừng to và báo**, không âm thầm đổi cách hiểu.
- Muốn thay đổi cách chuyển đổi → sửa logic + chạy `--check` của convert và toàn bộ
  verify để không lệch con số nào.
- Đối chiếu với thực tế: Docling venv tại `C:\Users\vohac\.venvs\docling` (ngoài repo).
- Mọi quyết định lớn và lý do chọn: xem `process/2026-08-10_TabOverlap.md` và
  `process/2026-08-12_BaoCaoTaiChinhTidied.md` trong `process/`.
