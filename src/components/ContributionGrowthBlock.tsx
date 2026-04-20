/**
 * ContributionGrowthBlock: "Vốn của bạn vs Tiền sinh ra".
 *
 * Stacked area chart theo thời gian:
 *  - Lớp dưới: tổng tiền đã nạp (investedSeries)
 *  - Lớp trên: phần lãi sinh ra (value − invested), có thể âm khi market sập
 *
 * Retail VN dễ nhầm "danh mục có 300 triệu" = "tôi đã nạp 300 triệu". Chart này
 * tách rạch ròi: xám là vốn anh nạp, xanh là tiền đẻ ra từ vốn đó.
 */
import {
  Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart,
} from 'recharts'
import { formatVND } from '../utils/vndFormat'

export interface ContributionPortfolio {
  id: string
  name: string
  color: string
  totalInvested: number
  finalValue: number
  investedSeries: { date: string; value: number }[]
  valueSeries: { date: string; value: number }[]
}

interface Props {
  portfolios: ContributionPortfolio[]
}

export function ContributionGrowthBlock({ portfolios }: Props) {
  if (portfolios.length === 0) return null

  // Single-portfolio narrative: chart + takeaway chi tiết.
  // Multi: chỉ show takeaway so sánh tỉ lệ, không vẽ chart stacked (sẽ rối).
  const single = portfolios[0]!

  return (
    <div className="dca-contrib-block">
      <h3 className="dca-contrib-title">Vốn của bạn vs Tiền đẻ ra từ vốn</h3>
      <p className="dca-contrib-sub">
        Phần xám phía dưới là số tiền bạn đã bỏ ra, từng tháng từng tháng cộng lại.
        Phần xanh phía trên là tiền mà chính số tiền đó đẻ ra cho bạn. Ban đầu hai
        phần gần bằng nhau, vì lãi cần thời gian để tích lũy. Càng về sau, phần
        xanh càng lấn át phần xám. Đó là lúc lãi kép bắt đầu làm việc thật sự.
      </p>

      {portfolios.length === 1 ? (
        <>
          <ContribChart portfolio={single} />
          <SingleTakeaway portfolio={single} />
        </>
      ) : (
        <MultiTakeaway portfolios={portfolios} />
      )}
    </div>
  )
}

function ContribChart({ portfolio }: { portfolio: ContributionPortfolio }) {
  // Merge invested + value by date
  const investedMap = new Map(portfolio.investedSeries.map(p => [p.date, p.value]))
  const data = portfolio.valueSeries.map(v => {
    const invested = investedMap.get(v.date) ?? 0
    const growth = v.value - invested
    return {
      date: v.date,
      invested,
      growth,
    }
  })

  if (data.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <defs>
          <linearGradient id="contrib-invested-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.15} />
          </linearGradient>
          <linearGradient id="contrib-growth-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatMonthYearShort}
          tick={{ fontSize: 11, fill: '#6b7280' }}
          minTickGap={40}
        />
        <YAxis
          tickFormatter={(v) => formatMillions(v)}
          tick={{ fontSize: 11, fill: '#6b7280' }}
          width={56}
        />
        <Tooltip
          labelFormatter={formatDateFull}
          formatter={(v: number, name: string) => [formatVND(Math.round(v)), name]}
          contentStyle={{ fontSize: 12, borderRadius: 6 }}
        />
        <Area
          type="monotone"
          dataKey="invested"
          stackId="1"
          stroke="#94a3b8"
          strokeWidth={1.2}
          fill="url(#contrib-invested-grad)"
          name="Vốn đã nạp"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="growth"
          stackId="1"
          stroke="#10b981"
          strokeWidth={1.2}
          fill="url(#contrib-growth-grad)"
          name="Lãi sinh ra"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function SingleTakeaway({ portfolio }: { portfolio: ContributionPortfolio }) {
  const profit = portfolio.finalValue - portfolio.totalInvested
  const profitPct = portfolio.finalValue > 0 ? (profit / portfolio.finalValue) * 100 : 0

  if (profit <= 0) {
    return (
      <div className="dca-contrib-takeaway">
        Hiện tại phần lãi chưa dương. Danh mục đang ở giai đoạn tích lũy hoặc vừa đi
        qua bão. Lãi kép cần thời gian, không phải chuyện ngày một ngày hai. Hãy kiên
        trì nạp tiền đều đặn, để thời gian làm công việc của nó.
      </div>
    )
  }

  return (
    <div className="dca-contrib-takeaway">
      Danh mục của bạn hiện có <strong>{formatVND(Math.round(portfolio.finalValue))}</strong>.
      Trong đó bạn chỉ bỏ ra <strong>{formatVND(portfolio.totalInvested)}</strong>, phần
      còn lại <strong>{formatVND(Math.round(profit))}</strong> ({profitPct.toFixed(1)}%
      tài sản) là tiền do chính khoản đầu tư đó đẻ ra. Càng giữ lâu, tỉ lệ tiền đẻ tiền
      càng lớn. Đó là cách lãi kép vận hành: lặng lẽ, đều đặn, và có phần thưởng chỉ
      dành cho người đủ kiên nhẫn.
    </div>
  )
}

function MultiTakeaway({ portfolios }: { portfolios: ContributionPortfolio[] }) {
  const lines = portfolios
    .filter(p => p.finalValue > p.totalInvested)
    .sort((a, b) => (b.finalValue - b.totalInvested) - (a.finalValue - a.totalInvested))

  if (lines.length === 0) {
    return (
      <div className="dca-contrib-takeaway">
        Chưa danh mục nào có lãi thực. Giai đoạn tích lũy, lãi kép cần thời gian, hãy
        kiên trì nạp tiền đều đặn.
      </div>
    )
  }

  return (
    <div className="dca-contrib-takeaway">
      <div style={{ marginBottom: 6 }}>
        Tỉ lệ tiền đẻ tiền của từng danh mục:
      </div>
      <ul className="dca-contrib-list">
        {portfolios.map(p => {
          const profit = p.finalValue - p.totalInvested
          const pct = p.finalValue > 0 ? (profit / p.finalValue) * 100 : 0
          const sign = profit >= 0 ? '+' : ''
          return (
            <li key={p.id}>
              <span style={{ color: p.color, fontWeight: 600 }}>{p.name}</span>:
              {' '}nạp {formatVND(p.totalInvested)}, giá trị {formatVND(Math.round(p.finalValue))}
              {' '}→ <strong>{sign}{formatVND(Math.round(profit))}</strong> ({pct.toFixed(1)}% là lãi)
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function formatMillions(v: number): string {
  if (Math.abs(v) >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + 'B'
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(0) + 'M'
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(0) + 'K'
  return v.toString()
}

function formatMonthYearShort(dateStr: string): string {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  return `${parts[1]!}/${parts[0]!.slice(2)}`
}

function formatDateFull(dateStr: string): string {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  return `${parts[2]!}/${parts[1]!}/${parts[0]!}`
}
