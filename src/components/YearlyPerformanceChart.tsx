import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import type { YearlyReturn } from '../types'
import { formatPercentFull, BASELINE_COLOR, DIMMED_COLOR } from '../utils/chartPlumbing'
import { useDimLegend } from '../hooks/useDimLegend'

export interface YearlySeries {
  name: string
  color: string
  data: Array<Pick<YearlyReturn, 'year' | 'isPartial'> & { value: number | null; isOpeningYear?: boolean }>
}

interface Props {
  series: YearlySeries[]
  title?: string
  assetLabel?: string
}

export function YearlyPerformanceChart({ series, title = 'Hiệu suất theo từng năm', assetLabel = 'quỹ' }: Props) {
  const seriesKey = series.map(s => s.name).join(',')
  const { handleLegendClick, isDimmed } = useDimLegend(seriesKey)

  const data = buildYearlyChartData(series)

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>{title}</h3>
        <span
          className="chart-tooltip-icon"
          role="img"
          tabIndex={0}
          aria-label={`Giải thích biểu đồ: dấu * là năm chưa đầy đủ dữ liệu, dấu † là năm đầu chưa có số dư đầu năm của tất cả danh mục đang hiển thị.`}
          title={`So sánh lợi nhuận các ${assetLabel} trong mỗi năm. Năm có dấu * là năm chưa đầy đủ dữ liệu, dấu † là năm đầu chưa có số dư đầu năm của tất cả danh mục đang hiển thị. Bấm vào legend để làm mờ/hiện cột.`}
        >?</span>
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <BarChart data={data} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
          <YAxis
            tickFormatter={v => (v * 100).toFixed(0) + '%'}
            tick={{ fontSize: 12 }}
            width={60}
            domain={([dataMin, dataMax]: [number, number]) => {
              const pad = Math.max(Math.abs(dataMin), Math.abs(dataMax)) * 0.15
              return [dataMin - pad, dataMax + pad]
            }}
          />
          <Tooltip
            formatter={(value: number, name: string) => {
              if (isDimmed(name)) return []
              return formatPercentFull(value)
            }}
          />
          <Legend
            onClick={handleLegendClick}
            formatter={(value: string) => (
              <span style={{
                color: isDimmed(value) ? DIMMED_COLOR : undefined,
                cursor: 'pointer',
                textDecoration: isDimmed(value) ? 'line-through' : undefined,
              }}>
                {value}
              </span>
            )}
          />
          <ReferenceLine
            y={0}
            stroke={BASELINE_COLOR}
            strokeDasharray="6 3"
            strokeWidth={1.5}
          />
          {series.map(s => {
            const isDimmedBar = isDimmed(s.name)
            return (
              <Bar
                key={s.name}
                dataKey={s.name}
                fill={isDimmedBar ? DIMMED_COLOR : s.color}
                opacity={isDimmedBar ? 0.35 : 1}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            )
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function buildYearlyChartData(series: YearlySeries[]): Array<Record<string, unknown>> {
  const yearSet = new Set<number>()
  for (const s of series) {
    for (const y of s.data) yearSet.add(y.year)
  }

  const data = Array.from(yearSet)
    .sort((a, b) => a - b)
    .map(year => {
      const point: Record<string, unknown> = {}
      let isPartial = false
      const yearRows = series.map(s => s.data.find(yr => yr.year === year))
      const openingYear = yearRows.length > 0
        && yearRows.every(row => row?.isOpeningYear === true)

      for (const [index, s] of series.entries()) {
        const y = yearRows[index]
        point[s.name] = y ? y.value : null
        if (y?.isPartial) isPartial = true
      }

      point.year = `${isPartial ? `${year}*` : year}${openingYear ? '†' : ''}`
      return point
    })

  return data
}
