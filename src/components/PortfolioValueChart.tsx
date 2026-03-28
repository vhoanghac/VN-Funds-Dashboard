import {
  Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Area, ComposedChart,
} from 'recharts'

interface ValuePoint {
  date: string
  value: number
}

interface PortfolioSeries {
  name: string
  color: string
  values: ValuePoint[]
  invested: ValuePoint[]
}

interface Props {
  portfolios: PortfolioSeries[]
}

export function PortfolioValueChart({ portfolios }: Props) {
  if (portfolios.length === 0) return null

  const data = mergeData(portfolios)

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Giá trị tài sản</h3>
        <span
          className="chart-tooltip-icon"
          title="Biểu đồ giá trị tài sản thực tế (MWRR) của nhà đầu tư theo thời gian. Đường nét đứt là tổng chi phí đã đầu tư (cost basis). Phần tô màu thể hiện lãi/lỗ."
        >?</span>
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
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
            tickFormatter={formatVND}
            tick={{ fontSize: 12 }}
            width={80}
          />
          <Tooltip
            formatter={(value: number, name: string) => [formatVNDFull(value), name]}
            labelFormatter={formatTooltipDate}
          />
          <Legend />
          {portfolios.map(p => (
            <Area
              key={`area-${p.name}`}
              type="monotone"
              dataKey={`${p.name}_value`}
              name={`${p.name} — Giá trị`}
              stroke={p.color}
              fill={p.color}
              fillOpacity={0.1}
              strokeWidth={2}
              dot={false}
              connectNulls={true}
            />
          ))}
          <Line
            key="invested-shared"
            type="stepAfter"
            dataKey={`${portfolios[0]!.name}_invested`}
            name="Đã đầu tư"
            stroke="#94a3b8"
            strokeDasharray="6 3"
            strokeWidth={1.5}
            dot={false}
            opacity={0.7}
            connectNulls={true}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function mergeData(portfolios: PortfolioSeries[]): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>()

  for (const p of portfolios) {
    for (const pt of p.values) {
      const key = pt.date
      const row = map.get(key) || { date: key, timestamp: new Date(key).getTime() }
      row[`${p.name}_value`] = pt.value
      map.set(key, row)
    }
    for (const pt of p.invested) {
      const key = pt.date
      const row = map.get(key) || { date: key, timestamp: new Date(key).getTime() }
      row[`${p.name}_invested`] = pt.value
      map.set(key, row)
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

function formatVND(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M'
  if (value >= 1_000) return (value / 1_000).toFixed(0) + 'K'
  return value.toFixed(0)
}

function formatVNDFull(value: number): string {
  return Math.round(value).toLocaleString('vi-VN') + ' đ'
}

function formatTooltipDate(ts: number): string {
  const d = new Date(ts)
  const dd = d.getDate().toString().padStart(2, '0')
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}
