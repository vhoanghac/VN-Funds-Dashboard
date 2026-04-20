import { useState, useRef } from 'react'
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

const DIMMED_COLOR = '#CBD5E1'
const INVESTED_LINE_NAME = 'Đã đầu tư'

export function PortfolioValueChart({ portfolios }: Props) {
  const [dimmed, setDimmed] = useState<Set<string>>(new Set())

  const seriesKey = portfolios.map(p => p.name).join(',')
  const prevKeyRef = useRef(seriesKey)
  if (prevKeyRef.current !== seriesKey) {
    prevKeyRef.current = seriesKey
    if (dimmed.size > 0) setDimmed(new Set())
  }

  if (portfolios.length === 0) return null

  const data = mergeData(portfolios)

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
        <h3>Giá trị tài sản</h3>
        <span
          className="chart-tooltip-icon"
          title="Biểu đồ giá trị tài sản thực tế (MWRR) của nhà đầu tư theo thời gian. Đường nét đứt là tổng chi phí đã đầu tư (cost basis). Phần tô màu thể hiện lãi/lỗ. Bấm vào legend để làm mờ/hiện đường."
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
            formatter={(value: number, name: string) => {
              if (dimmed.has(name)) return []
              return [formatVNDFull(value), name]
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
          {portfolios.map(p => {
            const legendName = `${p.name}: Giá trị`
            const isDimmed = dimmed.has(legendName)
            return (
              <Area
                key={`area-${p.name}`}
                type="monotone"
                dataKey={`${p.name}_value`}
                name={legendName}
                stroke={isDimmed ? DIMMED_COLOR : p.color}
                fill={isDimmed ? DIMMED_COLOR : p.color}
                fillOpacity={isDimmed ? 0.04 : 0.1}
                strokeWidth={isDimmed ? 0.75 : 2}
                opacity={isDimmed ? 0.4 : 1}
                dot={false}
                connectNulls={true}
              />
            )
          })}
          {(() => {
            const isDimmed = dimmed.has(INVESTED_LINE_NAME)
            return (
              <Line
                key="invested-shared"
                type="stepAfter"
                dataKey={`${portfolios[0]!.name}_invested`}
                name={INVESTED_LINE_NAME}
                stroke={isDimmed ? DIMMED_COLOR : '#94a3b8'}
                strokeDasharray="6 3"
                strokeWidth={isDimmed ? 0.75 : 1.5}
                opacity={isDimmed ? 0.3 : 0.7}
                dot={false}
                connectNulls={true}
              />
            )
          })()}
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
