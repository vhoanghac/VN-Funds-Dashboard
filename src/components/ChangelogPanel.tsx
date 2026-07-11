const ENTRIES = [
  {
    version: 'v3.2',
    date: '10/07/2026',
    items: [
      'Sửa cách đặt tên danh mục DCA',
      'Chỉnh sửa lại thiết kế biểu đồ cho dễ nhìn',
      'Rút ngắn định dạng đường link chia sẻ',
      'Cập nhật công thức: nếu danh mục có quỹ bị thiếu dữ liệu trong thời gian lớn hơn 1 tuần (thường xảy ra với các quỹ đời đầu) thì lấy dữ liệu gần nhất của tuần trước đó.',
      'Thêm quỹ ETF: FUESSVFL (Finlead) và FUEVN100 (VN100)',
      'Sửa lỗi tính toán: trước đây một số chỉ số (CAGR, rolling return, sụt giảm tối đa...) dùng dữ liệu đã resample theo tuần nên có sai số nhỏ ở các mốc ngắn hạn. Nay toàn bộ các tab tính trực tiếp trên dữ liệu theo ngày.',
      'Sửa lỗi hiệu năng: chuyển tab đôi khi bị đơ nhẹ và biểu đồ tự vẽ lại dù không có gì thay đổi. Nay các tab không còn tính toán lại mỗi lần chuyển qua chuyển lại, và biểu đồ không animate lại mỗi lần xuất hiện.',
      'Sửa lỗi giao diện: gõ số vào ô "Số tiền đầu tiên" / "Số tiền đầu tư định kỳ" đôi khi làm con trỏ nhảy lung tung, nhất là khi sửa số ở giữa chứ không phải gõ tiếp ở cuối. Nay con trỏ giữ đúng vị trí khi gõ.',
      'Sửa lỗi hiệu năng: sau khi bấm "Chạy DCA", gõ số vào bất kỳ ô nào (kể cả không liên quan) có thể làm trang bị đơ nặng trong chốc lát vì toàn bộ biểu đồ, bảng thống kê, hiệu suất từng năm... tự tính lại dù dữ liệu chưa đổi. Nay các mục này chỉ tính lại khi bạn thực sự bấm "Chạy DCA".',
    ],
  },
  {
    version: 'v3.1',
    date: '24/04/2026',
    items: [
      'Sửa đổi cách tính hiệu suất của DCDE vì quỹ có chi trả cổ tức. Dashboard tự điều chỉnh lịch sử giá tại layer CSV loader (Yahoo-style factor: (closePreEx − div × 95%) / closePreEx), áp dụng nhất quán cho toàn bộ các tab So Sánh, Mô Phỏng, LS vs DCA, Bitcoin và DCA. File .csv gốc không thay đổi — adjustment chạy in-memory mỗi lần load.',
      'Tab DCA có thêm mục "Cổ tức & tái đầu tư" liệt kê các đợt chi trả của DCDE rơi vào kỳ DCA của bạn, kèm giải thích về raw NAV vs adjusted NAV.',
      'Thiết kế pipeline xử lý cổ tức tách biệt hoàn toàn khỏi dữ liệu gốc: DCDE.csv vẫn là raw NAV từ fmarket, dễ audit và so khớp trực tiếp với fmarket. Khi DCDE chia thêm cổ tức, chỉ cần thêm 1 dòng vào dividends.json — không sửa CSV, không đụng GitHub Actions. Nếu sau này thuế TNCN thay đổi, chỉ cần sửa 1 hàm.',
    ],
  },
  {
    version: 'v3.0',
    date: '20/04/2026',
    items: [
      'Thiết kế lại toàn bộ giao diện và thêm nhiều mục phân tích trong tab So Sánh, DCA và Bitcoin',
      'Thêm mục "Kể chuyện so sánh" trong tab So Sánh',
      'Thêm mục "Chất lượng dữ liệu" ở đầu tab So Sánh: minh bạch khoảng dữ liệu của từng quỹ, phát hiện khoảng trống giữa các tuần, và cảnh báo khi dữ liệu chậm cập nhật quá 10 ngày so với hôm nay',
      'Thêm chỉ số phục hồi sau sụt giảm và số tuần nằm dưới đỉnh cũ vào thống kê drawdown',
      'Viết lại lời kể ở tab DCA cho gần retail hơn',
    ],
  },
  {
    version: 'v2.9',
    date: '17/04/2026',
    items: [
      'Tab Bitcoin được thiết kế lại theo hướng kể chuyện cho nhà đầu tư retail: mỗi biểu đồ kèm một hộp "takeaway" nhỏ giải thích con số có ý nghĩa gì với ví tiền của bạn',
      'Thêm section divider phân nhóm các biểu đồ trong tab Bitcoin thành 3 khu vực rõ ràng: kết quả & tâm lý → vai trò của Bitcoin trong danh mục → phân tích chi tiết theo tỷ trọng 0%–10%',
    ],
  },
  {
    version: 'v2.8',
    date: '15/04/2026',
    items: [
      'Thêm Bitcoin (BTC/VND)',
      'Dữ liệu BTC/VND lấy trực tiếp từ CoinGecko, lịch sử từ tháng 9/2014, tự động cập nhật hàng ngày',
      'Tab Bitcoin: chọn quỹ nền tảng, tự đặt tỷ trọng Bitcoin (3 mức tùy chỉnh, mặc định 1%/2%/3%), so sánh lợi nhuận tích lũy với danh mục thuần quỹ, có tái cân bằng định kỳ',
      'Thêm nút "Log" trên biểu đồ Lợi Nhuận Tích Lũy: chuyển sang trục logarithmic để so sánh tài sản có mức tăng trưởng chênh lệch lớn (ví dụ: Bitcoin vs quỹ cổ phiếu)',
      'Bấm vào legend trên tất cả biểu đồ để làm mờ đường/cột thay vì ẩn hoàn toàn, giúp dễ quan sát hơn',
    ],
  },
  {
    version: 'v2.7',
    date: '10/04/2026',
    items: [
      'Thêm nút "Copy link chia sẻ" vào tất cả các tab',
      'Lưu cấu hình vào bộ nhớ trình duyệt: quỹ đã chọn, số tiền, tần suất... tự động khôi phục khi vào lại',
    ],
  },
  {
    version: 'v2.6',
    date: '09/04/2026',
    items: [
      'Ô nhập số tiền tự động thêm dấu chấm phân cách hàng nghìn khi nhập (ví dụ: 5.000.000 thay vì 5000000)',
    ],
  },
  {
    version: 'v2.5',
    date: '08/04/2026',
    items: [
      'Sửa lỗi 3 quỹ ETF (E1VFVN30, FUEVFVND, FUEDCMID) ngừng cập nhật giá từ 27/03 do thiếu API key khi tự động lấy dữ liệu',
    ],
  },
  {
    version: 'v2.4',
    date: '03/04/2026',
    items: [
      'Sửa lỗi dropdown "Quỹ đầu tư khi chờ" trong tab LS vs DCA không hiển thị danh sách quỹ',
      'Chỉ hiển thị 5 quỹ trái phiếu lâu đời nhất để làm vốn chờ: VFF, DCBF, BVBF, SSIBF, DCIP',
      'Cải thiện tính toán vốn chờ: dùng giá gần nhất trước đó khi quỹ trái phiếu bị thiếu data ngày lễ',
    ],
  },
  {
    version: 'v2.3',
    date: '02/04/2026',
    items: [
      'Thêm tab LS vs DCA: so sánh chiến lược đầu tư một lần (Lump Sum) và rải vốn định kỳ (DCA) qua phân tích rolling kịch bản lịch sử',
      'Heatmap xác suất chiến thắng: ma trận 4×4 thời gian nắm giữ × thời gian DCA, hiển thị số kịch bản (n=) trên từng ô',
      'Biểu đồ phân bố chênh lệch LS−DCA và 5 kịch bản percentile (rất xấu → rất tốt)',
      'Thêm chỉ số Profit Factor vào tab DCA: tổng lợi nhuận các tuần tăng ÷ tổng lỗ các tuần giảm',
      'Sửa một số lỗi nhỏ trong tính toán LS vs DCA, tăng độ ổn định khi số lượng kịch bản lớn',
    ],
  },
  {
    version: 'v2.2',
    date: '01/04/2026',
    items: [
      'Thêm 24 quỹ mới: 19 quỹ trái phiếu và 5 quỹ cân bằng từ fmarket.vn',
      'Nâng tổng số quỹ từ 30 → 54 (27 cổ phiếu + 19 trái phiếu + 5 cân bằng + 3 ETF)',
      'Cập nhật tên đầy đủ tiếng Việt cho toàn bộ 51 quỹ mở theo dữ liệu chính thức từ fmarket.vn',
      'Sửa lỗi biểu đồ lợi nhuận tích lũy và drawdown không hiển thị điểm bắt đầu 0% tại ngày đầu tư',
    ],
  },
  {
    version: 'v2.1',
    date: '03/2026',
    items: [
      'Tab DCA: tự động đặt tên danh mục theo mã quỹ khi chỉ chọn 1 quỹ',
      'Sửa lỗi căn chỉnh ngày (date alignment) khi so sánh nhiều danh mục trong DCA',
    ],
  },
  {
    version: 'v2.0',
    date: '03/2026',
    items: [
      'Thêm tab Tích Lũy Định Kỳ (DCA): mô phỏng đầu tư định kỳ với nhiều danh mục, rebalance tự động, biểu đồ giá trị danh mục và chỉ số MWRR',
    ],
  },
  {
    version: 'v1.2',
    date: '03/2026',
    items: [
      'Thêm CSS responsive cho màn hình tablet và điện thoại',
    ],
  },
  {
    version: 'v1.1',
    date: '03/2026',
    items: [
      'Thêm GitHub Actions: tự động cập nhật NAV hàng ngày lúc 18:00 (giờ VN), thứ 2–6',
    ],
  },
  {
    version: 'v1.0',
    date: '03/2026',
    items: [
      'Ra mắt dashboard: So sánh quỹ, Mô Phỏng danh mục, biểu đồ CAGR/Drawdown/Rolling Returns',
    ],
  },
]

export function ChangelogPanel() {
  return (
    <div className="changelog-panel">
      <h2>Changelog</h2>
      <div className="changelog-list">
        {ENTRIES.map(entry => (
          <div key={entry.version} className="changelog-entry">
            <div className="changelog-header">
              <span className="changelog-version">{entry.version}</span>
              <span className="changelog-date">{entry.date}</span>
            </div>
            <ul className="changelog-items">
              {entry.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
