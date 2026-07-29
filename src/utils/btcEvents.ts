/**
 * Các sự kiện quan trọng trong lịch sử giá Bitcoin + thị trường toàn cầu,
 * dùng làm annotation trên biểu đồ cumulative return.
 *
 * Mục đích: giúp nhà đầu tư retail Việt Nam gắn biến động trên biểu đồ với
 * sự kiện đời thực mà họ có thể nhớ. "Tháng 11/2022 FTX sập, đó là vùng
 * đường BTC rơi mạnh" trực quan hơn nhiều so với "đây là drawdown -30%".
 */

export interface BtcEvent {
  date: string           // YYYY-MM-DD
  label: string          // short label shown on chart
  description?: string   // optional tooltip detail
  color: string
  /**
   * Hàng hiển thị nhãn, 0 là hàng dưới sát biểu đồ, số càng lớn càng lên cao.
   * Dùng để các mốc gần nhau khỏi đè chữ lên nhau. Bầu cử tháng 11 và nhậm chức
   * tháng 1 chỉ cách hai tháng rưỡi, trên biểu đồ 12 năm là dính liền. Nhãn dài
   * còn đè xa hơn nữa vì chữ trải sang hai bên vạch.
   */
  labelRow?: 0 | 1 | 2
}

/**
 * Màu riêng cho mốc chính trị, cố ý không dùng đỏ hay xanh lá như các sự kiện
 * thị trường. Đỏ và xanh trên biểu đồ này mang nghĩa xấu và tốt, mà một kỳ tổng
 * thống thì chưa biết tốt hay xấu cho tới khi giá chạy xong. Đảng nào thì đọc ở
 * nhãn, không đọc ở màu.
 */
const POLITICAL_COLOR = '#64748b'

export const BTC_EVENTS: BtcEvent[] = [
  {
    date: '2014-11-04',
    label: 'Giữa kỳ 2014: CH cả 2 viện',
    description: 'Bầu cử giữa kỳ Mỹ. Cộng hoà giành Thượng viện và giữ Hạ viện, nắm cả hai viện trong hai năm cuối nhiệm kỳ Obama (Dân chủ).',
    color: POLITICAL_COLOR,
  },
  {
    date: '2016-11-08',
    label: 'Bầu cử 2016',
    description: 'Bầu cử tổng thống Mỹ. Kết quả ngã ngũ ngay trong đêm, rạng sáng 9/11 đã rõ Trump thắng. Thị trường phản ứng ngay đêm đó, hơn hai tháng trước ngày nhậm chức.',
    color: POLITICAL_COLOR,
    labelRow: 1,
  },
  {
    date: '2017-01-20',
    label: 'Trump nhậm chức',
    description: 'Donald Trump nhậm chức tổng thống thứ 45 (Cộng hoà). Trước đó biểu đồ đang nằm trong nhiệm kỳ Obama (Dân chủ), phần này không có mốc vì dữ liệu BTC chỉ bắt đầu từ 9/2014.',
    color: POLITICAL_COLOR,
  },
  {
    date: '2018-11-06',
    label: 'Giữa kỳ 2018: Hạ về DC',
    description: 'Bầu cử giữa kỳ Mỹ. Dân chủ giành Hạ viện, Cộng hoà giữ Thượng viện. Quyền lực chia đôi trong nửa sau nhiệm kỳ Trump.',
    color: POLITICAL_COLOR,
  },
  {
    date: '2020-03-16',
    label: 'Covid',
    description: 'Covid-19 crash: thị trường toàn cầu rơi mạnh, BTC giảm ~50% trong 2 ngày.',
    color: '#dc2626',
  },
  {
    date: '2020-11-03',
    label: 'Bầu cử 2020',
    description: 'Bầu cử tổng thống Mỹ. Khác hai lần kia, kết quả không ngã ngũ trong đêm. Phải tới 7/11 các hãng tin mới xác nhận Biden thắng, tức bốn ngày không ai biết chắc. Đây là đoạn đáng xem nhất nếu muốn biết bất định chính trị tác động tới giá ra sao.',
    color: POLITICAL_COLOR,
    labelRow: 1,
  },
  {
    date: '2021-01-20',
    label: 'Biden nhậm chức',
    description: 'Joe Biden nhậm chức tổng thống thứ 46 (Dân chủ).',
    color: POLITICAL_COLOR,
  },
  {
    date: '2021-11-10',
    label: 'BTC đỉnh',
    description: 'Bitcoin đạt đỉnh lịch sử ~69,000 USD, bắt đầu crypto winter.',
    color: '#16a34a',
    labelRow: 1,
  },
  {
    date: '2022-11-08',
    label: 'Giữa kỳ 2022: Hạ về CH',
    description: 'Bầu cử giữa kỳ Mỹ. Cộng hoà giành Hạ viện sát nút, Dân chủ giữ Thượng viện. "Làn sóng đỏ" mà nhiều người dự đoán đã không xảy ra. Lưu ý: mốc này cách vụ FTX sập đúng một ngày, hai vạch gần như trùng nhau trên biểu đồ, và phần giá rơi sau đó là do FTX chứ không phải do bầu cử.',
    color: POLITICAL_COLOR,
    labelRow: 2,
  },
  {
    date: '2022-11-09',
    label: 'FTX sập',
    description: 'Sàn FTX phá sản, kéo theo làn sóng thanh lý. BTC rơi xuống ~16,000 USD.',
    color: '#dc2626',
  },
  {
    date: '2024-01-11',
    label: 'BTC ETF',
    description: 'SEC Mỹ phê duyệt ETF Bitcoin giao ngay, mở đường vốn tổ chức vào thị trường.',
    color: '#2563eb',
  },
  {
    date: '2024-11-05',
    label: 'Bầu cử 2024',
    description: 'Bầu cử tổng thống Mỹ. Kết quả rõ ngay rạng sáng 6/11, Trump thắng nhiệm kỳ hai.',
    color: POLITICAL_COLOR,
    labelRow: 1,
  },
  {
    date: '2025-01-20',
    label: 'Trump nhậm chức',
    description: 'Donald Trump nhậm chức tổng thống thứ 47 (Cộng hoà), nhiệm kỳ hai.',
    color: POLITICAL_COLOR,
  },
]
