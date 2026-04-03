const ENTRIES = [
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
