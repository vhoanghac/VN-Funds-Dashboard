import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import type { ChartSeries } from '../types'

interface Props {
  series: ChartSeries[]
}

const BASELINE_COLOR = '#7A7574'

export function CumulativeReturnChart({ series }: Props) {
  const data = mergeAllSeries(series)

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Lợi nhuận tích lũy</h3>
        <span className="chart-tooltip-icon" title="Biểu đồ thể hiện hiệu suất tích lũy từ thời điểm bắt đầu (0%). Nếu đường ở mức 50% nghĩa là quỹ đã tăng 50% so với ban đầu.">?</span>
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
            tickFormatter={formatPercent}
            tick={{ fontSize: 12 }}
            width={60}
          />
          <Tooltip
            formatter={(value: number) => formatPercent(value)}
            labelFormatter={formatTooltipDate}
          />
          <Legend />
          <ReferenceLine
            y={0}
            stroke={BASELINE_COLOR}
            strokeDasharray="6 3"
            strokeWidth={1.5}
          />
          {series.map(s => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
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

function formatTooltipDate(ts: number): string {
  const d = new Date(ts)
  const dd = d.getDate().toString().padStart(2, '0')
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}
