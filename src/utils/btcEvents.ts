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
}

export const BTC_EVENTS: BtcEvent[] = [
  {
    date: '2020-03-16',
    label: 'Covid',
    description: 'Covid-19 crash — thị trường toàn cầu rơi mạnh, BTC giảm ~50% trong 2 ngày.',
    color: '#dc2626',
  },
  {
    date: '2021-11-10',
    label: 'BTC đỉnh',
    description: 'Bitcoin đạt đỉnh lịch sử ~69,000 USD, bắt đầu crypto winter.',
    color: '#16a34a',
  },
  {
    date: '2022-11-09',
    label: 'FTX sập',
    description: 'Sàn FTX phá sản, kéo theo làn sóng thanh lý — BTC rơi xuống ~16,000 USD.',
    color: '#dc2626',
  },
  {
    date: '2024-01-11',
    label: 'BTC ETF',
    description: 'SEC Mỹ phê duyệt ETF Bitcoin giao ngay, mở đường vốn tổ chức vào thị trường.',
    color: '#2563eb',
  },
]
