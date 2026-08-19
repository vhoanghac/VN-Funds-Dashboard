import { useMemo } from 'react'
import type { FundComparisonData } from '../hooks/useCalculations'
import {
  drawdownStats,
  positiveRollingRate,
  rollingReturns,
} from '../utils/calculations'

interface Props {
  funds: FundComparisonData[]
  colors: string[]
  startDate: string
  endDate: string
}

interface BriefStats {
  id: string
  color: string
  cagr: number | null
  totalReturn: number
  maxDrawdown: number
  recoveryWeeks: number | null
  underwaterWeeks: number | null
  positiveRollingRate: number | null
}

interface Highlight {
  label: string
  winner: BriefStats
  value: string
  detail: string
  tone: 'return' | 'drawdown' | 'consistency'
}

export function CompareBrief({ funds, colors, startDate, endDate }: Props) {
  const stats = useMemo<BriefStats[]>(() => funds.map((fund, index) => {
    const drawdown = drawdownStats(fund.returns)
    const rolling12 = rollingReturns(fund.returns, 12)

    return {
      id: fund.id,
      color: colors[index % colors.length] ?? '#2563EB',
      cagr: fund.kpi.cagr,
      totalReturn: lastValue(fund.cumulative),
      maxDrawdown: drawdown.maxDrawdown,
      recoveryWeeks: drawdown.recoveryWeeks,
      underwaterWeeks: drawdown.underwaterWeeks,
      positiveRollingRate: positiveRollingRate(rolling12),
    }
  }), [colors, funds])

  if (stats.length < 2) return null

  const returnWinner = [...stats].sort((a, b) => b.totalReturn - a.totalReturn)[0]!
  const drawdownWinner = [...stats].sort((a, b) => b.maxDrawdown - a.maxDrawdown)[0]!
  const consistencyCandidates = stats.filter(s => s.positiveRollingRate !== null)
  const consistencyWinner = [...consistencyCandidates]
    .sort((a, b) => b.positiveRollingRate! - a.positiveRollingRate!)[0]

  const highlights: Highlight[] = [
    {
      label: 'Lợi nhuận cộng dồn',
      winner: returnWinner,
      value: formatPercent(returnWinner.totalReturn),
      detail: 'cao nhất trong kỳ đang so sánh',
      tone: 'return',
    },
    {
      label: 'Đáy sâu nhất',
      winner: drawdownWinner,
      value: formatPercent(drawdownWinner.maxDrawdown),
      detail: 'ít sụt giảm nhất trong các quỹ',
      tone: 'drawdown',
    },
    {
      label: 'Rolling 12 tháng',
      winner: consistencyWinner ?? stats[0]!,
      value: consistencyWinner ? formatPercent(consistencyWinner.positiveRollingRate!) : 'Chưa đủ dữ liệu',
      detail: consistencyWinner ? 'cửa sổ có lợi nhuận dương' : 'chưa có cửa sổ 12 tháng',
      tone: 'consistency',
    },
  ]

  return (
    <section className="cmp-brief" aria-labelledby="cmp-brief-title">
      <div className="cmp-brief-header">
        <div>
          <p className="cmp-brief-kicker">Đọc nhanh trước khi nhìn biểu đồ</p>
          <h2 id="cmp-brief-title" className="cmp-brief-title">Không có quỹ thắng ở mọi mặt.</h2>
        </div>
        <div className="cmp-brief-period">
          <span>Kỳ so sánh</span>
          <strong>{formatDate(startDate)} → {formatDate(endDate)}</strong>
        </div>
      </div>

      <div className="cmp-brief-highlights">
        {highlights.map(highlight => <HighlightCard key={highlight.label} highlight={highlight} />)}
      </div>

      <div className="cmp-brief-profiles">
        {stats.map(stat => <ProfileCard key={stat.id} stat={stat} />)}
      </div>

      <p className="cmp-brief-footnote">
        Đây là kết quả trong quá khứ, không phải dự báo. Quỹ dẫn đầu lợi nhuận vẫn có thể
        là quỹ khiến bạn khó chịu nhất khi thị trường giảm.
      </p>
    </section>
  )
}

function HighlightCard({ highlight }: { highlight: Highlight }) {
  return (
    <article className={`cmp-brief-highlight cmp-brief-highlight--${highlight.tone}`}>
      <p className="cmp-brief-label">{highlight.label}</p>
      <div className="cmp-brief-winner">
        <span className="cmp-brief-swatch" style={{ background: highlight.winner.color }} />
        <strong>{highlight.winner.id}</strong>
      </div>
      <p className="cmp-brief-value">{highlight.value}</p>
      <p className="cmp-brief-detail">{highlight.detail}</p>
    </article>
  )
}

function ProfileCard({ stat }: { stat: BriefStats }) {
  const recovery = stat.recoveryWeeks !== null
    ? `Hồi đỉnh sau ${formatWeeks(stat.recoveryWeeks)}`
    : stat.underwaterWeeks !== null
      ? `Chưa hồi đỉnh sau ${formatWeeks(stat.underwaterWeeks)}`
      : 'Chưa có cú sụt đủ lớn để đo hồi phục'

  return (
    <article className="cmp-brief-profile">
      <div className="cmp-brief-profile-head">
        <span className="cmp-brief-swatch" style={{ background: stat.color }} />
        <strong>{stat.id}</strong>
      </div>
      <div className="cmp-brief-profile-metrics">
        <span>CAGR <strong>{stat.cagr === null ? '—' : formatPercent(stat.cagr)}</strong></span>
        <span>Đáy <strong className="cmp-brief-negative">{formatPercent(stat.maxDrawdown)}</strong></span>
        <span>12T dương <strong>{stat.positiveRollingRate === null ? '—' : formatPercent(stat.positiveRollingRate)}</strong></span>
      </div>
      <p className="cmp-brief-profile-recovery">{recovery}</p>
    </article>
  )
}

function lastValue(points: Array<{ value: number }>): number {
  return points[points.length - 1]?.value ?? 0
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}

function formatWeeks(weeks: number): string {
  if (weeks < 4) return `${weeks} tuần`
  const months = weeks / 4.345
  if (months < 12) return `${months.toFixed(months < 3 ? 1 : 0)} tháng`
  return `${(months / 12).toFixed(1)} năm`
}
