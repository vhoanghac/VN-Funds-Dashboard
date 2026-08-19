# Daily Price Update Pipeline — giá & NAV hàng ngày

Thư mục này chứa các script **tự động chạy mỗi ngày** qua GitHub Actions
(`.github/workflows/update_daily.yml`) để cập nhật **giá** và **NAV** của quỹ, vàng,
Bitcoin. Đây là pipeline "giữ cho dashboard luôn tươi", khác hẳn pipeline báo cáo tài
chính trong `scripts/fund_report/` (chạy thủ công khi quỹ công bố báo cáo).

README này viết để **AI và người mới đọc lại sau này hiểu ngay** — mỗi bước ghi rõ
làm gì, hoạt động ra sao, tại sao làm vậy, và workflow đi đâu.

---

## Tổng quan: hai pipeline, một repo

| | `scripts/` (thư mục này) | `scripts/fund_report/` |
|---|---|---|
| Cập nhật | Giá NAV, vàng, BTC | Danh mục đầu tư (holdings), báo cáo tài chính |
| Khi nào chạy | **Hàng ngày tự động** (workflow) | **Thủ công** khi có báo cáo mới |
| Đầu vào | API công khai (fmarket, vnstock, CoinGecko, SJC, Google Sheet...) | File xlsx do quỹ công bố |
| Đầu ra | `<FUND>.csv`, `GOLD_*.csv`, `BTC.csv`, ETF csv | `holdings/<FUND>_holdings.csv`, `holdings/<FUND>_industry.csv`, `tidied/` |
| Workflow chi tiết | README này | `scripts/fund_report/README.md` |

Hai pipeline **độc lập**: cập nhật giá hàng ngày không đụng holdings, và ngược lại.
Điểm nối duy nhất: `update_holdings.py` (trong `fund_report/`) cũng được workflow
hàng ngày gọi — xem Bước 5.

```
              .github/workflows/update_daily.yml  (mỗi ngày 18:00 VN)
                          │
        ┌─────────────────┼──────────────────┬─────────────────┬───────────────┐
        ▼                 ▼                  ▼                 ▼               ▼
  update_nav.mjs   update_vnstock.py  update_holdings.py  update_TCEF_TCBF  update_gold.mjs
  (NAV quỹ fmarket)(ETF + BTC)        (holdings Overlap)  _digiinvest.mjs  (vàng SJC+DOJI)
        │                 │                (thuộc fund_report)  (NAV TCBF/TCEF)      │
        └─────────────────┴──────────────────────┬───────────────┴───────────────────┘
                                                 ▼
                                    git commit + push public/data/
```

---

## Kiến trúc dữ liệu (bắt buộc nắm trước)

Mọi CSV trong `public/data/` đều theo **một trong hai dạng**:

- **Giá quỹ / ETF / BTC:** `date,price` — một dòng một ngày.
- **Vàng:** `date,buy,sell` — giá mua và giá bán, khác nhau do chênh lệch mua-bán.

**Nguyên tắc bất biến của mọi script trong thư mục này: chỉ append, không bao giờ
ghi đè.** Mỗi script đọc ngày cuối cùng trong CSV (`getLastDate`), tải dữ liệu mới từ
API, rồi **nối thêm các dòng có ngày lớn hơn** ngày cuối. Chạy lại bao nhiêu lần cũng
không nhân đôi — đó là tính **idempotent**.

Hệ quả: lịch sử cũ không bao giờ bị sửa. Nếu một ngày API trả giá khác cho ngày đã
có, script bỏ qua (ngày đó không lớn hơn ngày cuối) — chấp nhận, vì mục đích là theo
dõi, không phải sửa lịch sử.

---

## Bước 1: `update_nav.mjs` — NAV quỹ mở (fmarket)

**Làm gì:** cập nhật giá NAV cho các quỹ mở có trên fmarket.vn, mỗi quỹ một file CSV
`public/data/<FUND>.csv`.

**Hoạt động ra sao:**
1. Đọc `fund_metadata.json` — danh sách quỹ và tên file CSV của từng quỹ.
2. Tách 3 nhóm: quỹ mở thường (qua fmarket), ETF (giao qua sàn — để `update_vnstock.py`
   lo), quỹ chỉ có trên digiinvest (TCBF/TCEF — để `update_TCEF_TCBF_digiinvest.mjs` lo).
3. Gọi `POST /res/products/filter` để lấy **catalog** (map shortName → productId).
   Vì tên quỹ có thể lệch (SSI-EF vs SSIEF), lookup thử cả bản có/không dấu gạch.
4. Với mỗi quỹ: gọi `POST /res/product/get-nav-history`, lấy NAV từ ngày sau ngày cuối
   của CSV, **append các dòng mới** (luôn sắp xếp tăng dần theo ngày).
5. Sleep 300ms giữa các quỹ để tránh rate limit.
6. Cuối cùng gọi `update_vnstock.py` (delegate) cho ETF + quỹ đổi tên (xem Bước 2).

**Tại sao làm vậy:** chỉ lấy đúng số ngày thiếu (không tải lại toàn bộ) → nhanh và ít
gọi API. Dùng catalog để ánh xạ tên quỹ → id vì API fmarket nhận id, còn metadata lưu
tên. Skip quỹ không có trong catalog (PRULINK, VSF...) vì không có nguồn.

**Workflow ra sao:** chạy đầu tiên trong workflow. Nếu quỹ nào lỗi, quỹ đó bị bỏ qua
(log ❌) nhưng các quỹ khác vẫn chạy — một quỹ hỏng không chặn cả pipeline. Output
là các dòng mới được thêm vào `<FUND>.csv`.

```bash
node scripts/update_nav.mjs
```

---

## Bước 2: `update_vnstock.py` — ETF + BTC

**Làm gì:** cập nhật giá ETF (6 mã) và Bitcoin (BTC/VND).

**Hoạt động ra sao:**
1. **ETF** qua `vnstock Quote` (nguồn VCI): gọi lịch sử giá từ ngày sau ngày cuối CSV,
   đổi `close` → `price`, **nhân ×1000** (VCI trả giá theo nghìn VND), append.
   Các ETF: E1VFVN30, FUEVFVND, FUEDCMID, FUESSVFL, FUEVN100, FUESSV50.
2. **BTC** qua CoinGecko free API: `market_chart?vs_currency=vnd&days=N` trả mảng
   `[timestamp_ms, price]`; dedupe theo ngày (giữ tick cuối), append.
   Nếu API lỗi, **retry 3 lần với exponential backoff** (2s, 4s, 8s) — vì GitHub Actions
   dùng IP chung dễ bị rate limit.

**Tại sao làm vậy:** ETF giao dịch trên sàn nên lấy giá chứng khoán (vnstock Quote),
không phải NAV fmarket. BTC lấy trực tiếp VND (không qua USD) để khớp đơn vị của
dashboard. Retry vì mạng của CI không ổn định; nếu thất bại hẳn thì `exit 1` để
workflow báo đỏ — BTC là tài sản 24/7, không được phép lặng lẽ bỏ qua.

**Lưu ý — script này chạy 2 lần mỗi ngày:** một lần qua `update_nav.mjs` (delegate,
dòng cuối của Bước 1) và một lần trực tiếp từ workflow. Đây **không phải lỗi**: lần
thứ hai gặp toàn bộ "already up to date" vì idempotent, nên vô hại. Lý do giữ cả hai:
`update_nav.mjs` cần nó cho ETF + quỹ đổi tên (DFVNCAF→DCAF...), còn workflow gọi riêng
để đảm bảo BTC luôn được chạy kể cả khi `update_nav.mjs` hỏng sớm.

```bash
python -X utf8 scripts/update_vnstock.py
```

---

## Bước 3: `update_TCEF_TCBF_digiinvest.mjs` — NAV TCBF/TCEF

**Làm gì:** cập nhật NAV cho **TCBF và TCEF** — 2 quỹ chỉ xuất hiện trên digiinvest.vn,
không có trên fmarket nên `update_nav.mjs` không đụng tới.

**Hoạt động ra sao:** trang `digiinvest.vn/ccq/<fund>/` đọc dữ liệu từ một **Google
Sheet công khai** qua Sheets v4 API (key đọc-only nhúng trong JS của trang). Một sheet
chứa mọi quỹ, **mỗi quỹ một cột** ("Giá TCBF", "Giá TCEF"), mỗi hàng một ngày. Script
đọc sheet, lấy đúng cột của từng quỹ, append các ngày mới (đã có thì skip).

**Tại sao làm vậy:** TCBF/TCEF không có trên fmarket nên không thể dùng chung Bước 1.
Đọc thẳng Google Sheet — không cần trình duyệt headless hay scrape. Tên script ghi rõ
2 quỹ để không nhầm với `backfill_holdings_digiinvest.py` (lấy **danh mục cổ phiếu**,
khác hẳn việc lấy **giá**).

**Workflow ra sao:** chạy sau `update_vnstock.py`. Lỗi một quỹ → log ❌ nhưng không
`exit 1` (khác BTC) vì NAV quỹ mở cập nhật chậm hơn, không cần báo đỏ cả pipeline.

```bash
node scripts/update_TCEF_TCBF_digiinvest.mjs
```

---

## Bước 4: `update_gold.mjs` — vàng SJC + nhẫn DOJI

**Làm gì:** cập nhật giá vàng cho 3 tài sản: vàng miếng SJC, vàng nhẫn SJC 99,99%,
vàng nhẫn DOJI (Hưng Thịnh Vượng).

**Hoạt động ra sao:** mỗi tài sản trong `GOLD_ASSETS` có **nguồn chính** (`fetch`) và
**nguồn dự phòng** (`fallback`):

| Tài sản | Nguồn chính | Nguồn dự phòng |
|---|---|---|
| GOLD_SJC (miếng) | sjc.com.vn `PriceService.ashx` | giavang.org (chuỗi Highcharts ~30 ngày) |
| GOLD_NHAN_SJC | sjc.com.vn (goldPriceId 49) | giavang.org (bảng so sánh trong ngày) |
| GOLD_NHAN_DOJI | banggia.doji.vn `GetTablePrice` (AES) | simplize.vn (chuỗi ~2,4 năm) |

Chi tiết đáng biết:
- **sjc.com.vn** đứng sau Cloudflare chặn Node fetch (fingerprint TLS) — script gọi
  `curl` ra ngoài để né (cùng cách các backfill đã dùng). API giới hạn <90 ngày/call
  nên chia theo chunk 85 ngày.
- **banggia.doji.vn** trả payload mã hoá **AES-256-CBC** (key lấy từ JS của chính
  trang) — giải mã rồi lấy dòng nhẫn tròn (materialCode 03 "NHẪN TRÒN 9999 HƯNG
  THỊNH VƯỢNG"); giá nghìn VND/chỉ × 10.000 ra VND/lượng.
- **Fallback** chỉ dùng khi nguồn chính lỗi; mỗi loại tự lọc `> lastDate` rồi append.

**Tại sao làm vậy:** giá vàng cập nhật nhiều lần trong ngày, nên script lấy lại cả
ngày `lastDate` rồi lọc — ngày cũ giữ nguyên, chỉ nối ngày mới. Lỗi **một loại vàng
không fail cả script** (try/catch quanh từng asset) — vì vàng lỗi không được phép chặn
NAV quỹ commit cùng phiên.

**Workflow ra sao:** chạy cuối cùng. Output là các dòng mới trong `GOLD_*.csv`.

```bash
node scripts/update_gold.mjs
```

---

## Bước 5: `update_holdings.py` (trong `scripts/fund_report/`)

Workflow hàng ngày **cũng gọi** `scripts/fund_report/update_holdings.py` để cập nhật
holdings cho tab Overlap từ fmarket (top-10). Chi tiết về script này nằm trong
`scripts/fund_report/README.md` (Bước 5 của file đó). Điểm quan trọng ở đây: quỹ nào
đã có `source: 'report'` (danh mục từ báo cáo tài chính chính thức) sẽ bị bỏ qua —
không bao giờ bị top-10 fmarket ghi đè.

```bash
python -X utf8 scripts/fund_report/update_holdings.py
```

---

## Workflow `update_daily.yml` — nhịp chạy tổng thể

File `.github/workflows/update_daily.yml` điều phối toàn bộ:

- **Lịch:** `cron: '0 11 * * *'` = 18:00 giờ Việt Nam, **mỗi ngày** (kể cả cuối tuần —
  BTC giao dịch 24/7 nên không được để tụt). Cũng có thể bấm nút chạy tay
  (`workflow_dispatch`) trên GitHub.
- **Môi trường:** Ubuntu, Node 24 + Python 3.12; `pip install vnstock` và đăng ký
  `VNSTOCK_API_KEY` (secret của repo — không bao giờ viết thẳng vào file).
- **Thứ tự 5 bước** (mỗi bước một `run` riêng):
  1. `update_nav.mjs` — NAV quỹ mở fmarket
  2. `update_vnstock.py` — ETF + BTC
  3. `fund_report/update_holdings.py` — holdings Overlap
  4. `update_TCEF_TCBF_digiinvest.mjs` — NAV TCBF/TCEF
  5. `update_gold.mjs` — vàng
- **Commit + push:** sau 5 bước, kiểm tra `git diff`. Nếu có thay đổi → `git add
  public/data/` rồi commit với message "Update fund NAV data YYYY-MM-DD" và push bởi
  `github-actions[bot]`. Không có thay đổi → không commit (tránh commit rỗng).

**Tính chịu lỗi:** mỗi script tự bắt lỗi theo tài sản/quỹ — một quỹ lỗi không chặn
các quỹ khác, một loại vàng lỗi không chặn vàng khác. Ngoại lệ: `update_vnstock.py`
`exit 1` nếu BTC fail hẳn (để workflow báo đỏ). Nhờ đó commit hàng ngày luôn diễn ra
kể cả khi vài nguồn API ốm.

---

## Bảo trì / mở rộng

**Thêm tài sản mới:**
- **Quỹ mở:** thêm vào `public/data/fund_metadata.json` + file CSV rỗng có header.
  `update_nav.mjs` tự nhặt từ metadata.
- **ETF:** thêm mã vào `ETF_TICKERS` (update_nav.mjs) và `ETF_FUNDS`
  (update_vnstock.py).
- **Vàng:** thêm một entry vào `GOLD_ASSETS` trong `update_gold.mjs`, kèm `fetch` +
  `fallback`. Đơn vị phải khớp CSV (VND/lượng).

**Đổi nguồn API:** mỗi script cô lập nguồn của nó (một hàm `fetch` + một `fallback`).
Đổi nguồn = sửa trong script đó, không lan sang script khác.

**Kiểm tra hồi quy:** mọi script idempotent — chạy 2 lần liên tiếp, lần 2 phải in toàn
bộ "already up to date". Đó là dấu hiệu script còn lành.

**Quyết định thiết kế & lý do:** xem `process/2026-08-11_DojiNhan.md` (vàng DOJI),
`process/2026-08-10_Them17QuyMoFmarket.md` (mở rộng quỹ), và các hồ sơ liên quan
trong `process/`.
