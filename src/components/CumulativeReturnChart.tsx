import { memo, useState, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import type { ChartSeries } from '../types'

interface Props {
  series: ChartSeries[]
}

const BASELINE_COLOR = '#7A7574'

const DIMMED_COLOR = '#CBD5E1'

function CumulativeReturnChartImpl({ series }: Props) {
  const [logScale, setLogScale] = useState(false)
  const [dimmed, setDimmed] = useState<Set<string>>(new Set())

  // Reset dimmed when series change (e.g. user picks a different fund)
  const seriesKey = series.map(s => s.name).join(',')
  const prevKeyRef = useRef(seriesKey)
  if (prevKeyRef.current !== seriesKey) {
    prevKeyRef.current = seriesKey
    if (dimmed.size > 0) setDimmed(new Set())
  }

  const rawData = mergeAllSeries(series)
  const data = logScale ? toGrowthFactor(rawData, series) : rawData

  function handleLegendClick(payload: { value?: string | number }) {
    const key = typeof payload.value === 'string' ? payload.value : undefined
    if (!key) return
    setDimmed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Lợi nhuận tích lũy</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className={`log-scale-btn${logScale ? ' log-scale-btn-active' : ''}`}
            onClick={() => setLogScale(v => !v)}
            title="Chuyển sang trục logarithmic — hữu ích khi so sánh tài sản có mức tăng trưởng rất khác nhau (ví dụ: quỹ cổ phiếu vs Bitcoin)"
          >
            Log
          </button>
          <span className="chart-tooltip-icon" title="Biểu đồ thể hiện hiệu suất tích lũy từ thời điểm bắt đầu (0%). Nếu đường ở mức 50% nghĩa là quỹ đã tăng 50% so với ban đầu. Bấm vào legend để làm mờ/hiện đường.">?</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={getYearTicks(data)}
            tickFormatter={formatYear}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            scale={logScale ? 'log' : 'auto'}
            domain={logScale ? ['auto', 'auto'] : ['auto', 'auto']}
            allowDataOverflow={false}
            tickFormatter={logScale ? formatGrowthFactor : formatPercent}
            tick={{ fontSize: 12 }}
            width={60}
          />
          <Tooltip
            formatter={(value: number, name: string) => {
              if (dimmed.has(name)) return []   // hide tooltip row for dimmed lines
              return logScale ? formatGrowthFactorFull(value) : formatPercent(value)
            }}
            labelFormatter={formatTooltipDate}
          />
          <Legend
            onClick={handleLegendClick}
            formatter={(value: string) => (
              <span style={{
                color: dimmed.has(value) ? DIMMED_COLOR : undefined,
                cursor: 'pointer',
                textDecoration: dimmed.has(value) ? 'line-through' : undefined,
              }}>
                {value}
              </span>
            )}
          />
          <ReferenceLine
            y={logScale ? 1 : 0}
            stroke={BASELINE_COLOR}
            strokeDasharray="6 3"
            strokeWidth={1.5}
          />
          {series.map(s => {
            const isDimmed = dimmed.has(s.name)
            return (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={isDimmed ? DIMMED_COLOR : s.color}
                strokeWidth={isDimmed ? 1 : 2}
                opacity={isDimmed ? 0.4 : 1}
                dot={false}
                connectNulls
              />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export const CumulativeReturnChart = memo(CumulativeReturnChartImpl)

/** Convert merged data from decimal returns to growth factors (1 + return) for log scale */
function toGrowthFactor(
  rawData: Record<string, unknown>[],
  allSeries: ChartSeries[],
): Record<string, unknown>[] {
  return rawData.map(row => {
    const next: Record<string, unknown> = { date: row.date, timestamp: row.timestamp }
    for (const s of allSeries) {
      const v = row[s.name]
      if (typeof v === 'number') {
        const growth = 1 + v
        // Clamp to a small positive value to avoid log(0) or log(<0)
        next[s.name] = Math.max(growth, 0.001)
      }
    }
    return next
  })
}

function mergeAllSeries(allSeries: ChartSeries[]): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>()
  for (const s of allSeries) {
    for (const p of s.data) {
      const ex = map.get(p.date) || { date: p.date, timestamp: new Date(p.date).getTime() }
      ex[s.name] = p.value
      map.set(p.date, ex)
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => (a.timestamp as number) - (b.timestamp as number),
  )
}

function getYearTicks(data: Record<string, unknown>[]): number[] {
  const seen = new Set<number>()
  const ticks: number[] = []
  for (const d of data) {
    const ts = d.timestamp as number
    const year = new Date(ts).getFullYear()
    if (!seen.has(year)) {
      seen.add(year)
      ticks.push(ts)
    }
  }
  return ticks
}

function formatYear(ts: number): string {
  return new Date(ts).getFullYear().toString()
}

function formatPercent(value: number): string {
  return (value * 100).toFixed(1) + '%'
}

/** Y-axis tick: growth factor → show as % gain/loss. e.g. 2 → "+100%", 0.5 → "-50%" */
function formatGrowthFactor(value: number): string {
  const pct = (value - 1) * 100
  return (pct >= 0 ? '+' : '') + pct.toFixed(0) + '%'
}

/** Tooltip: same but with 1 decimal */
function formatGrowthFactorFull(value: number): string {
  const pct = (value - 1) * 100
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
}

function formatTooltipDate(ts: number): string {
  const d = new Date(ts)
  const dd = d.getDate().toString().padStart(2, '0')
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}
