import { useState, useMemo } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { ReturnPoint, RebalanceFrequency } from '../types'
import { rollingAnnualizedStdev } from '../utils/calculations'
import { simulateMultiFundPortfolio } from '../utils/portfolio'

interface Props {
  btcReturns: ReturnPoint[]
  fundReturns: ReturnPoint[]
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
  sd: number      // annualized stdev %
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

export function BtcStdevChart({ btcReturns, fundReturns, rebalFreq, fundId }: Props) {
  const [periodIdx, setPeriodIdx] = useState(2) // default: 3 năm

  const windowSize  = PERIOD_OPTIONS[periodIdx]!.weeks
  const periodLabel = PERIOD_OPTIONS[periodIdx]!.label

  const { allPoints, meanPoints } = useMemo<{
    allPoints: DataPoint[]
    meanPoints: DataPoint[]
  }>(() => {
    const minLen = Math.min(btcReturns.length, fundReturns.length)
    if (minLen < windowSize) return { allPoints: [], meanPoints: [] }

    const all: DataPoint[]   = []
    const means: DataPoint[] = []

    for (const w of WEIGHTS) {
      const btcW = w / 100
      const fundW = 1 - btcW

      let simReturns: ReturnPoint[]
      try {
        simReturns = simulateMultiFundPortfolio(
          [btcReturns, fundReturns],
          [btcW, fundW],
          rebalFreq,
        )
      } catch {
        continue
      }

      const rolling = rollingAnnualizedStdev(simReturns, windowSize)
      if (rolling.length === 0) continue

      for (const r of rolling) {
        all.push({ weight: w, sd: +(r.value * 100).toFixed(2) })
      }

      const mean = rolling.reduce((s, r) => s + r.value, 0) / rolling.length
      means.push({ weight: w, sd: +(mean * 100).toFixed(2) })
    }

    return { allPoints: all, meanPoints: means }
  }, [btcReturns, fundReturns, rebalFreq, windowSize])

  if (allPoints.length === 0) return null

  return (
    <div className="perf-table-container" style={{ marginTop: 24 }}>
      <div className="chart-header">
        <h3>Độ lệch chuẩn tương ứng với tỷ trọng Bitcoin</h3>
        <span
          className="chart-tooltip-icon"
          title="Độ lệch chuẩn quy năm của danh mục theo từng mức tỷ trọng Bitcoin. Mỗi chấm là độ lệch chuẩn của một giai đoạn trượt. Đường cam là trung bình. Tỷ trọng Bitcoin càng cao, biến động danh mục càng lớn."
        >?</span>
      </div>
      <p className="btc-weight-chart-sub">
        {periodLabel} rolling standard deviation
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
            dataKey="sd"
            name="Độ lệch chuẩn"
            tickFormatter={v => v + '%'}
            tick={{ fontSize: 11 }}
            width={58}
            label={{
              value: 'Độ lệch chuẩn',
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
                  <p>Độ lệch chuẩn: <strong>{pt.sd.toFixed(2)}%</strong></p>
                </div>
              )
            }}
          />

          {/* Distribution dots */}
          <Scatter
            data={allPoints}
            shape={<SmallDot />}
            legendType="none"
            isAnimationActive={false}
          />

          {/* Mean trend line */}
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

      {/* Legend */}
      <div className="btc-contrib-legend" style={{ marginTop: 2 }}>
        <span className="btc-contrib-legend-item">
          <span
            className="btc-contrib-legend-swatch"
            style={{ background: DOT_COLOR, opacity: 0.4 }}
          />
          Độ lệch chuẩn từng giai đoạn
        </span>
        <span className="btc-contrib-legend-item">
          <span className="btc-contrib-legend-line" style={{ background: MEAN_COLOR }} />
          Trung bình
        </span>
      </div>
    </div>
  )
}
