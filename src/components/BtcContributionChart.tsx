import { memo, useState, useMemo } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { ReturnPoint } from '../types'
import { rollingCumulativeReturns } from '../utils/calculations'

interface Props {
  portfolioReturns: ReturnPoint[][]    // [base, btc1, btc2, btc3]
  btcPercents: [number, number, number]
  fundId: string
}

const PERIOD_OPTIONS = [
  { label: '1 năm', months: 12 },
  { label: '2 năm', months: 24 },
  { label: '3 năm', months: 36 },
]

const BASE_LINE_COLOR = '#264653'
const BTC_LINE_COLOR  = '#2a9d8f'
const GREEN_FILL      = 'rgba(22, 163, 74, 0.25)'
const RED_FILL        = 'rgba(220, 38, 38, 0.25)'

interface ChartPoint {
  date: string
  base: number
  btc: number
  _gBase: number
  gDiff: number
  _rBase: number
  rDiff: number
}

interface TooltipProps {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number }>
  label?: string
  fundId: string
  btcLabel: string
}

function CustomTooltip({ active, payload, label, fundId, btcLabel }: TooltipProps) {
  if (!active || !payload?.length || !label) return null
  const baseEntry = payload.find(p => p.dataKey === 'base')
  const btcEntry  = payload.find(p => p.dataKey === 'btc')
  if (!baseEntry || !btcEntry) return null
  const base = baseEntry.value
  const btc  = btcEntry.value
  const diff = btc - base
  const [y, m] = label.split('-')
  const dateLabel = `${m}/${y}`
  return (
    <div className="custom-tooltip">
      <p className="ct-date">{dateLabel}</p>
      <p style={{ color: BASE_LINE_COLOR }}>
        100% {fundId}: {base >= 0 ? '+' : ''}{base.toFixed(1)}%
      </p>
      <p style={{ color: BTC_LINE_COLOR }}>
        {btcLabel}: {btc >= 0 ? '+' : ''}{btc.toFixed(1)}%
      </p>
      <p style={{ color: diff >= 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
        BTC đóng góp: {diff >= 0 ? '+' : ''}{diff.toFixed(1)}%
      </p>
    </div>
  )
}

function BtcContributionChartImpl({ portfolioReturns, btcPercents, fundId }: Props) {
  const [periodIdx, setPeriodIdx] = useState(0)
  const [weightIdx, setWeightIdx] = useState(0)

  const windowSize = PERIOD_OPTIONS[periodIdx]!.months
  const btcLabel = `Danh mục ${btcPercents[weightIdx]}% BTC`

  // Rolling window P tháng chỉ ra kết quả nếu khoảng thời gian đang chọn ở
  // panel cha ("Thời hạn") dài HƠN P tháng. Disable nút period nào không đủ
  // dữ liệu để người dùng không bấm được vào trạng thái rỗng.
  const periodAvailability = useMemo(() => {
    const baseReturns = portfolioReturns[0]
    if (!baseReturns) return PERIOD_OPTIONS.map(() => false)
    return PERIOD_OPTIONS.map(opt => rollingCumulativeReturns(baseReturns, opt.months).length > 0)
  }, [portfolioReturns])

  const chartData = useMemo<ChartPoint[]>(() => {
    const baseReturns = portfolioReturns[0]
    const btcReturns  = portfolioReturns[weightIdx + 1]
    if (!baseReturns || !btcReturns) return []

    const baseRolling = rollingCumulativeReturns(baseReturns, windowSize)
    const btcRolling  = rollingCumulativeReturns(btcReturns, windowSize)

    const btcMap = new Map(btcRolling.map(r => [r.date, r.value]))

    return baseRolling
      .map(r => {
        const btcVal = btcMap.get(r.date)
        if (btcVal === undefined) return null
        const base = r.value
        const btc  = btcVal
        return {
          date: r.date,
          base: +(base * 100).toFixed(2),
          btc:  +(btc  * 100).toFixed(2),
          // Green ribbon: transparent base + positive diff above base
          _gBase: +(base * 100).toFixed(2),
          gDiff:  +(Math.max(0, btc - base) * 100).toFixed(2),
          // Red ribbon: transparent base at min(btc,base) + positive diff above that
          _rBase: +(Math.min(btc, base) * 100).toFixed(2),
          rDiff:  +(Math.max(0, base - btc) * 100).toFixed(2),
        } as ChartPoint
      })
      .filter((d): d is ChartPoint => d !== null)
  }, [portfolioReturns, weightIdx, windowSize])

  if (chartData.length === 0) return null

  // Takeaway: aggregate "BTC helped" vs "BTC hurt" across all rolling windows
  let winCount = 0
  let totalDiff = 0
  let bestDiff = -Infinity
  let worstDiff = Infinity
  for (const pt of chartData) {
    const diff = pt.btc - pt.base
    totalDiff += diff
    if (diff > 0) winCount++
    if (diff > bestDiff) bestDiff = diff
    if (diff < worstDiff) worstDiff = diff
  }
  const winPct = (winCount / chartData.length) * 100
  const avgDiff = totalDiff / chartData.length
  const takeawayVariant: 'green' | 'red' | 'orange' =
    avgDiff > 1 ? 'green' : avgDiff < -1 ? 'red' : 'orange'
  const takeawayIcon = takeawayVariant === 'green' ? '🎯' : takeawayVariant === 'red' ? '⚠️' : '⚖️'

  // X-axis: sample ~8 ticks evenly
  const maxTicks = 8
  const step = Math.max(1, Math.floor(chartData.length / maxTicks))
  const ticks = chartData
    .filter((_, i) => i % step === 0 || i === chartData.length - 1)
    .map(d => d.date)

  const formatTick = (dateStr: string) => {
    const [y, m] = dateStr.split('-')
    return `${m}/${y}`
  }

  return (
    <div className="perf-table-container" style={{ marginTop: 24 }}>
      <div className="chart-header">
        <h3>Đóng góp của Bitcoin vào lợi nhuận tích lũy</h3>
        <span
          className="chart-tooltip-icon"
          title="Đường màu đen là lợi nhuận tích lũy của danh mục nền tảng. Đường màu xanh là lợi nhuận tích lũy của danh mục có Bitcoin. Nếu trên biểu đồ xuất hiện dải màu xanh có nghĩa rằng Bitcoin giúp nhà đầu tư có tăng trưởng tốt hơn đầu tư duy nhất danh mục nền tảng, còn màu đỏ là Bitcoin làm danh mục có tăng trưởng thấp hơn danh mục nền tảng."
        >?</span>
      </div>

      <div className="btc-contrib-controls">
        <div className="btc-contrib-ctrl-row">
          <span className="btc-contrib-ctrl-label">Danh mục có tỷ trọng</span>
          <div className="btc-contrib-btn-group">
            {btcPercents.map((pct, i) => (
              <button
                key={i}
                className={`btc-contrib-btn${weightIdx === i ? ' btc-contrib-btn--active' : ''}`}
                onClick={() => setWeightIdx(i)}
              >
                {pct}% BTC
              </button>
            ))}
          </div>
        </div>
        <div className="btc-contrib-ctrl-row">
          <span className="btc-contrib-ctrl-label">Rolling cumulative returns</span>
          <div className="btc-contrib-btn-group">
            {PERIOD_OPTIONS.map((opt, i) => {
              const available = periodAvailability[i]
              return (
                <button
                  key={opt.months}
                  className={`btc-contrib-btn${periodIdx === i ? ' btc-contrib-btn--active' : ''}`}
                  onClick={() => setPeriodIdx(i)}
                  disabled={!available}
                  title={available ? undefined : `Khoảng thời gian đang chọn chưa đủ dài để tính rolling ${opt.label}. Hãy chọn "Thời hạn" dài hơn ở phần trên.`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 16, right: 20, left: 10, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="date"
            ticks={ticks}
            tickFormatter={formatTick}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tickFormatter={v => v + '%'}
            tick={{ fontSize: 11 }}
            width={52}
          />
          <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 2" />
          <Tooltip
            content={
              <CustomTooltip
                fundId={fundId}
                btcLabel={btcLabel}
              />
            }
          />

          {/* Green ribbon: BTC outperforms */}
          <Area
            type="monotone"
            dataKey="_gBase"
            stackId="green"
            fill="transparent"
            stroke="none"
            isAnimationActive={false}
            legendType="none"
          />
          <Area
            type="monotone"
            dataKey="gDiff"
            stackId="green"
            fill={GREEN_FILL}
            stroke="none"
            isAnimationActive={false}
            legendType="none"
          />

          {/* Red ribbon: BTC underperforms */}
          <Area
            type="monotone"
            dataKey="_rBase"
            stackId="red"
            fill="transparent"
            stroke="none"
            isAnimationActive={false}
            legendType="none"
          />
          <Area
            type="monotone"
            dataKey="rDiff"
            stackId="red"
            fill={RED_FILL}
            stroke="none"
            isAnimationActive={false}
            legendType="none"
          />

          {/* Visible lines on top */}
          <Line
            type="monotone"
            dataKey="base"
            stroke={BASE_LINE_COLOR}
            strokeWidth={2}
            dot={false}
            name={`100% ${fundId}`}
          />
          <Line
            type="monotone"
            dataKey="btc"
            stroke={BTC_LINE_COLOR}
            strokeWidth={2}
            dot={false}
            name={btcLabel}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="btc-contrib-legend">
        <span className="btc-contrib-legend-item">
          <span className="btc-contrib-legend-line" style={{ background: BASE_LINE_COLOR }} />
          100% {fundId}
        </span>
        <span className="btc-contrib-legend-item">
          <span className="btc-contrib-legend-line" style={{ background: BTC_LINE_COLOR }} />
          {btcLabel}
        </span>
        <span className="btc-contrib-legend-item">
          <span className="btc-contrib-legend-swatch" style={{ background: GREEN_FILL, border: '1px solid #16a34a' }} />
          BTC vượt trội
        </span>
        <span className="btc-contrib-legend-item">
          <span className="btc-contrib-legend-swatch" style={{ background: RED_FILL, border: '1px solid #dc2626' }} />
          BTC kém hơn
        </span>
      </div>
      <div className={`chart-takeaway chart-takeaway--${takeawayVariant}`}>
        <span className="chart-takeaway-icon">{takeawayIcon}</span>
        <div className="chart-takeaway-body">
          Với giai đoạn <strong>{PERIOD_OPTIONS[periodIdx]!.label}</strong> và danh mục
          {' '}<strong>{btcPercents[weightIdx]}% BTC</strong>: BTC giúp danh mục vượt trội
          {' '}<strong>{winPct.toFixed(0)}%</strong> số giai đoạn, đóng góp trung bình
          {' '}<strong>{avgDiff >= 0 ? '+' : ''}{avgDiff.toFixed(1)}%</strong> lợi nhuận.
          {' '}Giai đoạn tốt nhất: <strong>+{bestDiff.toFixed(1)}%</strong>,
          xấu nhất: <strong>{worstDiff.toFixed(1)}%</strong>.
        </div>
      </div>
    </div>
  )
}

export const BtcContributionChart = memo(BtcContributionChartImpl)
