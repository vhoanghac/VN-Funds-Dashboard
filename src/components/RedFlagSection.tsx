import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts'
import { computeVerdictAt, redFlagHistory, type RedFlagId, type RedFlagPoint, type Verdict } from '../utils/fundRedFlags'
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

interface FlagConfig {
  id: RedFlagId
  title: string
  twist: string
}

const FLAGS: FlagConfig[] = [
  {
    id: 'machine',
    title: 'Cỗ máy giao dịch',
    twist: 'Phí môi giới gần bằng phí quản lý. Quỹ giao dịch càng nhiều, phí ẩn càng phình.',
  },
  {
    id: 'forcedSale',
    title: 'Bị ép bán',
    twist:
      'Cột đỏ (Mua lại) là độ lớn tiền nhà đầu tư rút chứng chỉ quỹ (2239.3.2, báo cáo ghi âm nên chart vẽ dương). ' +
      'Đường xanh (Lãi/lỗ TH) là lãi/lỗ thực hiện khi quỹ bán chứng khoán trong tháng (2235). ' +
      'Khi nhà đầu tư đồng loạt rút tiền, quỹ cần tiền mặt trả họ nên buộc phải bán cổ phiếu, kể cả đang lỗ. ' +
      'Khoản lỗ trên giấy thành lỗ thật, người ở lại (không rút) chịu qua NAV. ' +
      'Verdict ĐỎ khi cùng tháng mua lại ≥ 50 tỷ và lãi thực hiện ≤ −100 tỷ. ' +
      'DCDS 07/2026: rút −100,3 tỷ, lãi thực hiện −267 tỷ → ĐỎ, quỹ bán mạnh trong thị trường giảm để trả tiền rút.',
  },
]

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

function DetectorChart({ id, data, width, height }: { id: RedFlagId; data: Array<Record<string, unknown>>; width?: number; height?: number }) {
  if (id === 'machine') {
    return (
      <BarChart data={data} width={width} height={height} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={24} />
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
  return (
    <ComposedChart data={data} width={width} height={height} margin={CHART_MARGIN}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={24} />
      <YAxis yAxisId="red" tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={66} />
      <YAxis yAxisId="rl" orientation="right" tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={66} />
      <RechartsTooltip
        formatter={(value: number | string, name) => [formatVND(Number(value)), name]}
        labelFormatter={(p: string) => formatPeriodLabel(p)}
      />
      <Bar yAxisId="red" dataKey="Mua lại" fill="#dc2626" isAnimationActive={false} />
      <Line yAxisId="rl" type="monotone" dataKey="Lãi/lỗ TH" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
    </ComposedChart>
  )
}

function buildChartData(id: RedFlagId, points: RedFlagPoint[]): Array<Record<string, unknown>> {
  return points.map(p => {
    if (id === 'machine') {
      return { period: p.period, 'Phí môi giới': p.brokerageFee, 'Phí quản lý': p.managementFee }
    }
    return { period: p.period, 'Mua lại': p.redemptionFlow !== null ? -p.redemptionFlow : null, 'Lãi/lỗ TH': p.realizedGain }
  })
}

function metricLine(id: RedFlagId, summary: ReturnType<typeof computeVerdictAt>, realized: number | null) {
  if (id === 'machine') {
    return (
      <>
        {summary.keyMetric !== null && (
          <span>Turnover 12T: <strong>{Math.round(summary.keyMetric)}%</strong></span>
        )}
        {summary.extra !== null && <span>Phí MG/FM: <strong>{summary.extra}</strong></span>}
      </>
    )
  }
  return (
    <>
      {summary.keyMetric !== null && <span>Mua lại: <strong>{formatVND(summary.keyMetric)}</strong></span>}
      {realized !== null && <span>Lãi thực hiện: <strong>{formatVND(realized)}</strong></span>}
    </>
  )
}

function DetectorCard({
  config,
  summary,
  history,
  data,
  realized,
}: {
  config: FlagConfig
  summary: ReturnType<typeof computeVerdictAt>
  history: { period: string; verdict: Verdict }[]
  data: Array<Record<string, unknown>>
  realized: number | null
}) {
  const meta = VERDICT_META[summary.verdict]
  return (
    <div className="chart-container">
      <div className="chart-header redflag-header">
        <h3>{config.title}</h3>
        <span className="redflag-badge" style={{ background: meta.bg, color: meta.color }}>
          {meta.label}
        </span>
      </div>
      <div className="redflag-metrics">{metricLine(config.id, summary, realized)}</div>
      <ResponsiveContainer width="100%" height={150}>
        <DetectorChart id={config.id} data={data} />
      </ResponsiveContainer>
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
      <p className="fund-analysis-chart-note">{config.twist}</p>
    </div>
  )
}

export function RedFlagDetectors({ points }: Props) {
  if (points.length === 0) return null
  const idx = points.length - 1

  return (
    <div className="fund-analysis-charts-grid">
      {FLAGS.map(flag => (
        <DetectorCard
          key={flag.id}
          config={flag}
          summary={computeVerdictAt(flag.id, points, idx)}
          history={redFlagHistory(flag.id, points)}
          data={buildChartData(flag.id, points)}
          realized={flag.id === 'forcedSale' ? points[idx]?.realizedGain ?? null : null}
        />
      ))}
    </div>
  )
}
