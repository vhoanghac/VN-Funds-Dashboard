# Dữ liệu cổ phiếu

Thư mục này chứa các script lấy dữ liệu cổ phiếu cho tab `DCA Cổ phiếu`.

Có hai loại dữ liệu:

- Giá lịch sử theo phiên, lấy từ CafeF.
- Corporate actions, gồm cổ tức tiền mặt, cổ tức bằng cổ phiếu và quyền mua, lấy từ VCI qua `vnstock`.

Backfill là bước chạy một lần trên máy cá nhân. GitHub Actions chỉ nối dữ liệu mới vào những file đã tồn tại. Không để
workflow tự tạo file lịch sử mới, vì một file trống không cho biết dữ liệu đã được kiểm tra đến đâu.

Hai manifest kiểm soát phạm vi tự động:

- `stock_symbols.txt`: mã có file giá và được updater CafeF cập nhật hằng ngày.
- `div_symbols.txt`: mã có file corporate actions và được updater VCI cập nhật hằng ngày.

Manifest giá mặc định dùng sàn `HOSE`. Mã ở sàn khác ghi theo dạng `SYMBOL|EXCHANGE`, ví dụ `VEA|UPCOM`.

Một mã chỉ nên có trong manifest sau khi đã backfill và kiểm tra đủ cả hai cặp file.

## Cấu trúc file

Mỗi mã cổ phiếu có thể có hai file trong `public/data/stocks/`:

```text
public/data/stocks/
├── ACB.csv
├── ACB_div.csv
├── MBB.csv
├── MBB_div.csv
├── MBB_pending.csv
└── VEA.csv (UPCOM)
```

`<SYMBOL>.csv` có ba cột:

```text
date,adjusted_price,unadjusted_price
```

Giá tính bằng đồng Việt Nam. `adjusted_price` là giá đã điều chỉnh theo corporate actions. `unadjusted_price` là giá
đóng cửa chưa điều chỉnh.

`<SYMBOL>_div.csv` có 14 cột theo hợp đồng mà `src/data/stockData.ts` đọc:

```text
kind,ex_date,record_date,pay_date,last_date,settlement_date,amount_per_share,tax_rate,shares_per_share,rights_per_share,subscription_price,choice,funding,source
```

Các giá trị `kind` hiện được chấp nhận:

- `cash_dividend`: cổ tức tiền mặt. `amount_per_share` là số tiền trên một cổ phiếu, `tax_rate` mặc định là 5%.
- `stock_dividend`: cổ tức bằng cổ phiếu hoặc cổ phiếu thưởng. `shares_per_share` là số cổ phiếu nhận thêm trên một cổ phiếu cũ.
- `rights_issue`: quyền mua. `rights_per_share` là số quyền mua trên một cổ phiếu cũ.

`<SYMBOL>_pending.csv` là file tùy chọn cho event VCI đã công bố nhưng chưa đủ ngày để đưa vào sổ tài khoản. File có 6 cột:

```text
kind,ex_date,record_date,ratio,subscription_price,source
```

Dashboard hiển thị các event này trong bảng theo dõi, nhưng không đưa chúng vào engine. Khi VCI bổ sung ngày niêm yết, updater chuyển event sang `<SYMBOL>_div.csv` và xóa event tương ứng khỏi file pending.

## Backfill lần đầu

### 1. Backfill giá từ CafeF

Script này gọi endpoint XLSX của CafeF theo từng quý. CafeF giới hạn số tháng trong một lần tải, nên script tự chia khoảng
thời gian thành các đoạn ba tháng.

Chạy từ thư mục gốc repository:

```bash
node scripts/stocks/scrape_cafef_stock.mjs --symbol ACB --from 2007-01-01 --to 2026-09-08
```

VEA giao dịch trên UPCOM, nên backfill phải truyền đúng sàn:

```bash
node scripts/stocks/scrape_cafef_stock.mjs \
  --symbol VEA \
  --exchange UPCOM \
  --from 2007-01-01 \
  --to 2026-09-09
```

Script ghi vào `public/data/stocks/ACB.csv`. Nếu file đã tồn tại, script dừng để tránh ghi đè nhầm. Chỉ dùng `--force`
khi bạn thực sự muốn tạo lại toàn bộ file:

```bash
node scripts/stocks/scrape_cafef_stock.mjs \
  --symbol ACB \
  --from 2007-01-01 \
  --to 2026-09-08 \
  --force
```

Script kiểm tra các điều sau trước khi ghi:

- CafeF trả đúng mã đang yêu cầu.
- Ngày nằm trong khoảng `--from` đến `--to`.
- Ngày tăng dần, không trùng.
- Hai cột giá là số nguyên dương tính bằng đồng.
- Không có hai đoạn tải trả hai mức giá khác nhau cho cùng một ngày.
- Quý không có dữ liệu, thường là khoảng trước ngày niêm yết, được bỏ qua. Nếu toàn bộ khoảng
  không có phiên nào thì script mới dừng với lỗi.

### 2. Backfill corporate actions từ VCI

`update_vnstock_divs.py` gọi bộ phân trang VCI bên trong `vnstock`, với hai nhóm event `DIV,ISS`. Script lấy toàn bộ
khoảng ngày yêu cầu, sau đó tách event thành hai nhóm. Event đủ ngày đi vào `<SYMBOL>_div.csv`. Event đã công bố nhưng
chưa đủ ngày để mô phỏng, ví dụ cổ tức cổ phiếu chưa có ngày niêm yết, đi vào `<SYMBOL>_pending.csv` để dashboard hiển thị
theo dõi. Khi VCI bổ sung ngày, lần chạy sau sẽ chuyển event sang file áp dụng và xóa bản pending.

Backfill ACB:

```bash
python -X utf8 scripts/stocks/update_vnstock_divs.py \
  --symbol ACB \
  --from 2007-01-01 \
  --to 2026-09-08 \
  --backfill
```

Muốn xem trước kết quả mà không ghi file:

```bash
python -X utf8 scripts/stocks/update_vnstock_divs.py \
  --symbol ACB \
  --from 2007-01-01 \
  --to 2026-09-08 \
  --backfill \
  --dry-run
```

Nếu VCI cần API key trong môi trường local, đăng ký biến môi trường trước khi chạy:

```powershell
$env:VNSTOCK_API_KEY = "..."
python -X utf8 scripts/stocks/update_vnstock_divs.py --symbol ACB --backfill
```

Sau khi kiểm tra hai file, thêm mã vào `div_symbols.txt`:

```text
# Mỗi dòng một mã
ACB
```

Đừng thêm mã vào manifest trước khi file `<SYMBOL>_div.csv` đã tồn tại và qua kiểm tra local. File `<SYMBOL>_pending.csv`
không bắt buộc, nhưng nếu có thì cũng phải qua parser contract. Workflow có cờ
`--require-existing`, nên mã mới sẽ làm workflow đỏ thay vì tự tạo một file chưa được backfill.

## Cập nhật hằng ngày

GitHub Actions chạy trong `.github/workflows/update_daily.yml` vào 18:00 giờ Việt Nam mỗi ngày. Có thể chạy lại bằng
`workflow_dispatch` trên GitHub.

Phần liên quan tới cổ phiếu chạy theo thứ tự sau:

```text
1. update_cafef_stocks.mjs
    Đọc từng mã và sàn trong stock_symbols.txt.
   Tải lại khoảng 90 ngày gần nhất của từng mã.
   Kiểm tra dữ liệu cũ rồi nối phiên mới vào <SYMBOL>.csv.

2. update_vnstock_divs.py
   Đọc từng mã trong div_symbols.txt.
   Tải lại toàn bộ lịch sử corporate actions.
   Chỉ ghi phần event mới vào <SYMBOL>_div.csv.
```

Lệnh workflow hiện tại:

```bash
node scripts/stocks/update_cafef_stocks.mjs \
  --symbols-file scripts/stocks/stock_symbols.txt

python -X utf8 scripts/stocks/update_vnstock_divs.py \
  --symbols-file scripts/stocks/div_symbols.txt \
  --require-existing
```

Workflow truyền `VNSTOCK_API_KEY` từ GitHub secret. Không ghi API key vào file hoặc commit vào repository.

Sau tất cả bước cập nhật dữ liệu, workflow chạy `git diff`. Có thay đổi thì bot commit toàn bộ `public/data/` và push.
Không có thay đổi thì workflow không tạo commit rỗng.

## Quy tắc merge corporate actions

Mỗi event VCI được ghi trong cột `source` dưới dạng:

```text
VCI event <id>
```

VCI có thể dùng lại cùng một `id` cho hai event ở hai năm khác nhau. Vì vậy script không lấy `id` đơn độc làm khóa.
Khóa đầy đủ là:

```text
source event id + kind + ex_date
```

Khi chạy cập nhật:

1. Event đã có và nội dung không đổi thì bỏ qua.
2. Event chưa có thì nối vào file.
3. Event đã có nhưng VCI trả nội dung khác thì script dừng trước khi ghi file.
4. Hai event trùng khóa trong file cũng làm script dừng.
5. File tạm chỉ được đổi tên thành file chính sau khi toàn bộ kiểm tra pass.

Chạy lần hai không được tạo thêm dòng:

```bash
python -X utf8 scripts/stocks/update_vnstock_divs.py \
  --symbols-file scripts/stocks/div_symbols.txt \
  --require-existing \
  --dry-run
```

Kết quả bình thường có dạng:

```text
ACB: checked 43 VCI events, 34 supported actions, 0 new
ACB: already up to date (34 rows)
Completed 1 symbol(s), 0 new corporate action(s)
```

## Quy tắc chuẩn hóa event

### Cổ tức tiền mặt

Event `DIV` được chuyển thành `cash_dividend`. Script yêu cầu phải có ngày không hưởng quyền, ngày đăng ký cuối cùng,
ngày trả cổ tức và giá trị trên một cổ phiếu. Thuế mặc định là `0,05`.

### Cổ tức bằng cổ phiếu

Event `ISS` có tiêu đề chứa `cổ tức bằng cổ phiếu`, `cổ phiếu thưởng` hoặc `stock dividend` được chuyển thành
`stock_dividend`. Ngày niêm yết cổ phiếu mới được dùng làm `pay_date`.

### Quyền mua

Event `ISS` có tiêu đề chứa `quyền mua` hoặc `rights issue` được chuyển thành `rights_issue`. Hiện VCI không cung cấp
đủ giá phát hành đáng tin cậy cho luồng này, nên script dùng giá giả định `10.000` đồng và ghi `price assumption` vào
`source`.

Đây là giả định của mô hình. Không được đọc nó như giá phát hành chính thức từ VCI.

Các event `ISS` khác, ví dụ phát hành cho cán bộ nhân viên, bị bỏ qua vì chưa có cách đưa chúng vào mô hình DCA hiện tại.

## Thêm mã mới

### Corporate actions

1. Backfill local cho mã đó.
2. Kiểm tra số event, khoảng ngày, header và các dòng có `source`.
3. Chạy dry-run lần hai để kiểm tra tính idempotent.
4. Thêm mã vào `div_symbols.txt`.
5. Chạy test và build trước khi push.

Ví dụ:

```bash
python -X utf8 scripts/stocks/update_vnstock_divs.py \
  --symbol FPT \
  --from 2007-01-01 \
  --to 2026-09-08 \
  --backfill

python -X utf8 scripts/stocks/update_vnstock_divs.py \
  --symbol FPT \
  --from 2007-01-01 \
  --to 2026-09-08 \
  --backfill \
  --dry-run
```

### Giá lịch sử

Backfill giá cho mã mới bằng `scrape_cafef_stock.mjs`:

```bash
node scripts/stocks/scrape_cafef_stock.mjs \
  --symbol FPT \
  --from 2007-01-01 \
  --to 2026-09-08 \
  --output public/data/stocks/FPT.csv
```

Updater giá trong workflow đọc `stock_symbols.txt`. Updater corporate actions đọc `div_symbols.txt`. Thêm một mã vào một
manifest chỉ bật loại dữ liệu tương ứng; để tab chạy được, mã đó cần có cả `<SYMBOL>.csv` và `<SYMBOL>_div.csv`.

## Kiểm tra trước khi push

Chạy từ thư mục gốc repository:

```bash
python -X utf8 -m unittest scripts.stocks.test_update_vnstock_divs -v
python -X utf8 -m py_compile scripts/stocks/update_vnstock_divs.py
python -X utf8 scripts/stocks/update_vnstock_divs.py \
  --symbols-file scripts/stocks/div_symbols.txt \
  --require-existing \
  --dry-run
npm.cmd run test -- --run
npm.cmd run build
```

Test Python khóa ba hành vi quan trọng:

- Mapping đúng event tiền mặt, cổ phiếu và quyền mua.
- Chạy merge hai lần không tạo dòng trùng.
- VCI sửa event cũ thì script từ chối ghi file.

## Giới hạn hiện tại

- CafeF đang được gọi qua endpoint `ExchangeType=HOSE`; chưa có luồng tự chọn sàn cho từng mã.
- Updater corporate actions gọi adapter phân trang VCI bên trong `vnstock`, không gọi một data provider riêng của dashboard.
- Corporate action đang thiếu ngày sẽ bị bỏ qua kèm cảnh báo, chưa đưa vào sổ tài khoản cho đến khi VCI trả đủ ngày.
- Giá quyền mua `10.000` đồng là giả định. Nếu cần kết quả chính xác cho một event cụ thể, phải kiểm tra thông báo phát hành
  chính thức trước khi đưa event vào mô hình.

Khi một giới hạn được giải quyết, cập nhật file này cùng với `scripts/README.md` và hồ sơ trong `process/`.
