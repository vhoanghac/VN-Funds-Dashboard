import { memo, useState, useMemo } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { ReturnPoint, RebalanceFrequency } from '../types'
import { rollingMaxDrawdown } from '../utils/calculations'
import { formatVND } from '../utils/vndFormat'

interface Props {
  // Pre-simulated returns for BTC weights 0%–10% (index 0 = 0%, index 10 = 10%)
  // Computed once in BitcoinPanel to avoid 3× duplicate simulation across scatter charts.
  allSimReturns: ReturnPoint[][]
  rebalFreq: RebalanceFrequency
  fundId: string
}

const PERIOD_OPTIONS = [
  { label: '1 năm', weeks: 52 },
  { label: '2 năm', weeks: 104 },
  { label: '3 năm', weeks: 156 },
]

const WEIGHTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const DOT_COLOR  = '#264653'
const MEAN_COLOR = '#e76f51'

interface DataPoint {
  weight: number  // 0–10
  dd: number      // max drawdown %, negative
}

function SmallDot(props: Record<string, unknown>) {
  const cx = props.cx as number | undefined
  const cy = props.cy as number | undefined
  if (cx == null || cy == null) return null
  return <circle cx={cx} cy={cy} r={2.5} fill={DOT_COLOR} fillOpacity={0.22} />
}

const REBAL_LABEL: Record<RebalanceFrequency, string> = {
  monthly:   'hàng tháng',
  quarterly: 'hàng quý',
  yearly:    'hàng năm',
}

function BtcMaxDrawdownChartImpl({ allSimReturns, rebalFreq, fundId }: Props) {
  const [periodIdx, setPeriodIdx] = useState(2) // default: 3 năm

  const windowSize  = PERIOD_OPTIONS[periodIdx]!.weeks
  const periodLabel = PERIOD_OPTIONS[periodIdx]!.label

  const { allPoints, meanPoints } = useMemo<{
    allPoints: DataPoint[]
    meanPoints: DataPoint[]
  }>(() => {
    const all: DataPoint[]   = []
    const means: DataPoint[] = []

    for (let wIdx = 0; wIdx < WEIGHTS.length; wIdx++) {
      const simReturns = allSimReturns[wIdx]
      if (!simReturns || simReturns.length < windowSize) continue

      const rolling = rollingMaxDrawdown(simReturns, windowSize)
      if (rolling.length === 0) continue

      const w = WEIGHTS[wIdx]!
      for (const r of rolling) {
        all.push({ weight: w, dd: +(r.value * 100).toFixed(2) })
      }
      const mean = rolling.reduce((s, r) => s + r.value, 0) / rolling.length
      means.push({ weight: w, dd: +(mean * 100).toFixed(2) })
    }

    return { allPoints: all, meanPoints: means }
  }, [allSimReturns, windowSize])

  if (allPoints.length === 0) return null

  // Takeaway: worst-case drawdown at 10% BTC (not mean — the scariest dot)
  const worstAt10 = allPoints
    .filter(p => p.weight === 10)
    .reduce((min, p) => (p.dd < min ? p.dd : min), 0)
  const meanAt0   = meanPoints.find(p => p.weight === 0)?.dd
  const meanAt10  = meanPoints.find(p => p.weight === 10)?.dd
  const ddDelta = (meanAt0 !== undefined && meanAt10 !== undefined) ? meanAt10 - meanAt0 : null
  // Translate worst drawdown to VND with a 100tr reference — visceral fear
  const REF_INVEST = 100_000_000
  const worstVnd = formatVND(REF_INVEST * (1 + worstAt10 / 100))

  return (
    <div className="perf-table-container" style={{ marginTop: 24 }}>
      <div className="chart-header">
        <h3>Mức độ sụt giảm vốn tương ứng với tỷ trọng Bitcoin</h3>
        <span
          className="chart-tooltip-icon"
          title="Mức sụt giảm vốn tối đa (max drawdown) của danh mục theo từng mức tỷ trọng Bitcoin. Mỗi chấm là mức sụt giảm lớn nhất của một giai đoạn trượt. Đường cam là trung bình. Tỷ trọng Bitcoin càng cao, mức sụt giảm vốn của danh mục càng sâu."
        >?</span>
      </div>
      <p className="btc-weight-chart-sub">
        {periodLabel} rolling maximum drawdown
        &nbsp;·&nbsp;{fundId} + Bitcoin
        &nbsp;·&nbsp;Tái cân bằng {REBAL_LABEL[rebalFreq]}
      </p>

      {/* Period selector */}
      <div className="btc-contrib-controls" style={{ marginTop: 10 }}>
        <div className="btc-contrib-ctrl-row">
          <span className="btc-contrib-ctrl-label">Thời gian nắm giữ</span>
          <div className="btc-contrib-btn-group">
            {PERIOD_OPTIONS.map((opt, i) => (
              <button
                key={opt.weeks}
                className={`btc-contrib-btn${periodIdx === i ? ' btc-contrib-btn--active' : ''}`}
                onClick={() => setPeriodIdx(i)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={360}>
        <ScatterChart margin={{ top: 16, right: 20, left: 10, bottom: 44 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            type="number"
            dataKey="weight"
            name="Tỷ trọng BTC"
            domain={[-0.4, 10.4]}
            ticks={WEIGHTS}
            tickFormatter={v => v + '%'}
            tick={{ fontSize: 11 }}
            label={{
              value: 'Tỷ trọng Bitcoin trong danh mục',
              position: 'insideBottom',
              offset: -28,
              fontSize: 12,
              fill: '#6b7280',
            }}
          />
          <YAxis
            type="number"
            dataKey="dd"
            name="Mức độ sụt giảm vốn"
            tickFormatter={v => v + '%'}
            tick={{ fontSize: 11 }}
            width={58}
            label={{
              value: 'Mức độ sụt giảm vốn',
              angle: -90,
              position: 'insideLeft',
              offset: 14,
              fontSize: 12,
              fill: '#6b7280',
            }}
          />
          <ZAxis range={[30, 30]} />
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const pt = payload[0]?.payload as DataPoint
              return (
                <div className="custom-tooltip">
                  <p>BTC: <strong>{pt.weight}%</strong></p>
                  <p>Sụt giảm vốn: <strong>{pt.dd.toFixed(2)}%</strong></p>
                </div>
              )
            }}
          />
          <Scatter
            data={allPoints}
            shape={<SmallDot />}
            legendType="none"
            isAnimationActive={false}
          />
          <Scatter
            data={meanPoints}
            fill={MEAN_COLOR}
            stroke={MEAN_COLOR}
            strokeWidth={2}
            line={{ stroke: MEAN_COLOR, strokeWidth: 2 }}
            lineType="joint"
            name="Trung bình"
            isAnimationActive={false}
            r={3}
          />
        </ScatterChart>
      </ResponsiveContainer>

      <div className="btc-contrib-legend" style={{ marginTop: 2 }}>
        <span className="btc-contrib-legend-item">
          <span className="btc-contrib-legend-swatch" style={{ background: DOT_COLOR, opacity: 0.4 }} />
          Sụt giảm vốn từng giai đoạn
        </span>
        <span className="btc-contrib-legend-item">
          <span className="btc-contrib-legend-line" style={{ background: MEAN_COLOR }} />
          Trung bình
        </span>
      </div>
      {ddDelta !== null && meanAt0 !== undefined && meanAt10 !== undefined && (
        <div className="chart-takeaway chart-takeaway--red">
          <span className="chart-takeaway-icon">😰</span>
          <div className="chart-takeaway-body">
            Trong <strong>{periodLabel}</strong>: ở <strong>0% BTC</strong>, sụt giảm trung bình
            {' '}<strong>{meanAt0.toFixed(1)}%</strong>. Ở <strong>10% BTC</strong>:
            {' '}<strong>{meanAt10.toFixed(1)}%</strong> — sâu thêm
            {' '}<strong>{ddDelta.toFixed(1)}%</strong>.
            {' '}Giai đoạn tệ nhất của 10% BTC chạm đáy
            {' '}<strong>{worstAt10.toFixed(1)}%</strong> — tức 100 triệu ban đầu còn
            {' '}<strong>{worstVnd}</strong>. Bạn có ngủ yên được không?
          </div>
        </div>
      )}
    </div>
  )
}

export const BtcMaxDrawdownChart = memo(BtcMaxDrawdownChartImpl)
