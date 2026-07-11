import { memo, useState, useMemo } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { ReturnPoint, RebalanceFrequency } from '../types'
import { rollingCumulativeReturns } from '../utils/calculations'

interface Props {
  // Pre-simulated returns for BTC weights 0%–10% (index 0 = 0%, index 10 = 10%)
  // Computed once in BitcoinPanel to avoid 3× duplicate simulation across scatter charts.
  allSimReturns: ReturnPoint[][]
  rebalFreq: RebalanceFrequency
  fundId: string
}

const PERIOD_OPTIONS = [
  { label: '1 năm', months: 12 },
  { label: '2 năm', months: 24 },
  { label: '3 năm', months: 36 },
]

const WEIGHTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const DOT_COLOR  = '#264653'
const MEAN_COLOR = '#e76f51'

interface DataPoint {
  weight: number  // 0–10
  ret: number     // rolling cumulative return %
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

function BtcWeightChartImpl({ allSimReturns, rebalFreq, fundId }: Props) {
  const [periodIdx, setPeriodIdx] = useState(2) // default: 3 năm

  const windowSize  = PERIOD_OPTIONS[periodIdx]!.months
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

      const rolling = rollingCumulativeReturns(simReturns, windowSize)
      if (rolling.length === 0) continue

      const w = WEIGHTS[wIdx]!
      for (const r of rolling) {
        all.push({ weight: w, ret: +(r.value * 100).toFixed(2) })
      }
      const mean = rolling.reduce((s, r) => s + r.value, 0) / rolling.length
      means.push({ weight: w, ret: +(mean * 100).toFixed(2) })
    }

    return { allPoints: all, meanPoints: means }
  }, [allSimReturns, windowSize])

  if (allPoints.length === 0) return null

  // Takeaway: compare mean return at 0% BTC vs 10% BTC, find best weight
  const ret0  = meanPoints.find(p => p.weight === 0)?.ret
  const ret10 = meanPoints.find(p => p.weight === 10)?.ret
  const bestWeight = meanPoints.reduce((a, b) => (a.ret > b.ret ? a : b), meanPoints[0]!)
  const slope = (ret0 !== undefined && ret10 !== undefined) ? (ret10 - ret0) / 10 : null

  return (
    <div className="perf-table-container" style={{ marginTop: 24 }}>
      <div className="chart-header">
        <h3>Lợi nhuận tích lũy tương ứng với tỷ trọng Bitcoin</h3>
      </div>
      <p className="btc-weight-chart-sub">
        {periodLabel} rolling cumulative returns
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
                key={opt.months}
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
            dataKey="ret"
            name="Lợi nhuận tích lũy"
            tickFormatter={v => v + '%'}
            tick={{ fontSize: 11 }}
            width={58}
            label={{
              value: 'Lợi nhuận tích lũy',
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
                  <p>Lợi nhuận: <strong>{pt.ret >= 0 ? '+' : ''}{pt.ret.toFixed(1)}%</strong></p>
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
          Lợi nhuận tích lũy từng giai đoạn
        </span>
        <span className="btc-contrib-legend-item">
          <span className="btc-contrib-legend-line" style={{ background: MEAN_COLOR }} />
          Trung bình
        </span>
      </div>
      {slope !== null && ret0 !== undefined && ret10 !== undefined && (
        <div className={`chart-takeaway chart-takeaway--${slope > 0 ? 'green' : 'red'}`}>
          <span className="chart-takeaway-icon">{slope > 0 ? '📈' : '📉'}</span>
          <div className="chart-takeaway-body">
            Trong <strong>{periodLabel}</strong>: ở <strong>0% BTC</strong>, lợi nhuận trung bình
            {' '}<strong>{ret0 >= 0 ? '+' : ''}{ret0.toFixed(1)}%</strong>. Ở
            {' '}<strong>10% BTC</strong>: <strong>{ret10 >= 0 ? '+' : ''}{ret10.toFixed(1)}%</strong>.
            {' '}Mỗi 1% BTC tăng thêm <strong>{slope >= 0 ? '+' : ''}{slope.toFixed(2)}%</strong>
            {' '}lợi nhuận trung bình. Tỷ trọng cho trung bình cao nhất:
            {' '}<strong>{bestWeight.weight}% BTC</strong> ({bestWeight.ret >= 0 ? '+' : ''}{bestWeight.ret.toFixed(1)}%).
          </div>
        </div>
      )}
    </div>
  )
}

export const BtcWeightChart = memo(BtcWeightChartImpl)
