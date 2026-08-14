import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts'
import { computeVerdictAt, redFlagHistory, type RedFlagPoint, type Verdict } from '../utils/fundRedFlags'
import { formatVND, formatVNDAxis } from '../utils/vndFormat'

interface Props {
  points: RedFlagPoint[] // tăng dần theo kỳ
}

const VERDICT_META: Record<Verdict, { label: string; color: string; bg: string }> = {
  OK: { label: 'Bình thường', color: '#166534', bg: '#ecfdf5' },
  WATCH: { label: 'Cần chú ý', color: '#92400e', bg: '#fffbeb' },
  DANGER: { label: 'Nguy hiểm', color: '#b91c1c', bg: '#fef2f2' },
  'N/A': { label: 'Thiếu dữ liệu', color: '#9a9890', bg: '#f5f5f4' },
}

const FLAG = {
  id: 'machine' as const,
  title: 'Cỗ máy giao dịch',
  twist:
    'Phí môi giới gần bằng phí quản lý. Quỹ giao dịch càng nhiều, phí ẩn càng phình. ' +
    'Verdict ĐỎ khi turnover ≥ 500% hoặc phí môi giới ≥ 80% phí quản lý.',
}

function formatPeriodLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split('-')
  if (!y || !m) return periodEnd
  return `Tháng ${Number(m)}/${y}`
}

function formatAxisTick(periodEnd: string): string {
  const [y, m] = periodEnd.split('-')
  if (!y || !m) return periodEnd
  return `${Number(m)}/${y.slice(2)}`
}

const CHART_MARGIN = { left: 8, right: 8, top: 8, bottom: 4 } as const

function buildChartData(points: RedFlagPoint[]): Array<Record<string, unknown>> {
  return points.map(p => ({ period: p.period, 'Phí môi giới': p.brokerageFee, 'Phí quản lý': p.managementFee }))
}

function MachineChart({ data, width, height }: { data: Array<Record<string, unknown>>; width?: number; height?: number }) {
  return (
    <BarChart data={data} width={width} height={height} margin={CHART_MARGIN}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
      <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={66} />
      <RechartsTooltip
        formatter={(value: number | string, name) => [formatVND(Number(value)), name]}
        labelFormatter={(p: string) => formatPeriodLabel(p)}
      />
      <Bar dataKey="Phí môi giới" stackId="a" fill="#f97316" isAnimationActive={false} />
      <Bar dataKey="Phí quản lý" stackId="a" fill="#f59e0b" isAnimationActive={false} />
    </BarChart>
  )
}

export function RedFlagDetectors({ points }: Props) {
  if (points.length === 0) return null
  const idx = points.length - 1
  const summary = computeVerdictAt('machine', points, idx)
  const meta = VERDICT_META[summary.verdict]
  const data = buildChartData(points)
  const history = redFlagHistory('machine', points)

  return (
    <div className="chart-container fund-analysis-chart-wide">
      <div className="chart-header redflag-header">
        <h3>{FLAG.title}</h3>
        <span className="redflag-badge" style={{ background: meta.bg, color: meta.color }}>
          {meta.label}
        </span>
      </div>
      <div className="redflag-metrics">
        {summary.keyMetric !== null && (
          <span>Turnover 12T: <strong>{Math.round(summary.keyMetric)}%</strong></span>
        )}
        {summary.extra !== null && <span>Phí MG/FM: <strong>{summary.extra}</strong></span>}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <MachineChart data={data} />
      </ResponsiveContainer>
      <div className="fund-analysis-stack-legend">
        <span className="fund-analysis-stack-legend-item"><span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: '#f97316' }} />Phí môi giới (2231)</span>
        <span className="fund-analysis-stack-legend-item"><span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: '#f59e0b' }} />Phí quản lý (2225)</span>
      </div>
      <div className="redflag-strip">
        {history.map(h => (
          <span
            key={h.period}
            className="redflag-dot"
            style={{ backgroundColor: VERDICT_META[h.verdict].color }}
            title={`${formatPeriodLabel(h.period)}: ${VERDICT_META[h.verdict].label}`}
          />
        ))}
      </div>
      <p className="fund-analysis-chart-note">{FLAG.twist}</p>
    </div>
  )
}
