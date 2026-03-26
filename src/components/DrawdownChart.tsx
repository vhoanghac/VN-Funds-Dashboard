import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import type { ChartSeries } from '../types'

interface Props {
  series: ChartSeries[]
}

const BASELINE_COLOR = '#7A7574'

export function DrawdownChart({ series }: Props) {
  const data = mergeAllSeries(series)

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Tỷ lệ sụt giảm so với đỉnh</h3>
        <span className="chart-tooltip-icon" title="Drawdown cho thấy mức giảm giá trị so với đỉnh cao nhất trước đó. Ví dụ: -20% nghĩa là quỹ đã giảm 20% từ đỉnh.">?</span>
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={getYearTicks(data)}
            tickFormatter={ts => new Date(ts).getFullYear().toString()}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            tickFormatter={v => (v * 100).toFixed(0) + '%'}
            tick={{ fontSize: 12 }}
            width={60}
            domain={['auto', 0]}
          />
          <Tooltip
            formatter={(value: number) => (value * 100).toFixed(2) + '%'}
            labelFormatter={(ts: number) => {
              const d = new Date(ts)
              const dd = d.getDate().toString().padStart(2, '0')
              const mm = (d.getMonth() + 1).toString().padStart(2, '0')
              return `${dd}/${mm}/${d.getFullYear()}`
            }}
          />
          <Legend />
          <ReferenceLine
            y={0}
            stroke={BASELINE_COLOR}
            strokeDasharray="6 3"
            strokeWidth={1.5}
          />
          {series.map(s => (
            <Area
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.1}
              dot={false}
              strokeWidth={1.5}
            />
          ))}
        </AreaChart>
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
    (x, y) => (x.timestamp as number) - (y.timestamp as number),
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
