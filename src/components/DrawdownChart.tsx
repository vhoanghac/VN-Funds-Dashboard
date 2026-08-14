import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import type { ChartSeries } from '../types'
import {
  mergeAllSeries, getYearTicks, formatYear, formatTooltipDate,
  formatPercent, formatPercentFull, BASELINE_COLOR, DIMMED_COLOR,
} from '../utils/chartPlumbing'
import { useDimLegend } from '../hooks/useDimLegend'

interface Props {
  series: ChartSeries[]
}

export function DrawdownChart({ series }: Props) {
  const seriesKey = series.map(s => s.name).join(',')
  const { handleLegendClick, isDimmed } = useDimLegend(seriesKey)

  const data = mergeAllSeries(series)

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Tỷ lệ sụt giảm so với đỉnh</h3>
        <span className="chart-tooltip-icon" title="Drawdown cho thấy mức giảm giá trị so với đỉnh cao nhất trước đó. Ví dụ: -20% nghĩa là quỹ đã giảm 20% từ đỉnh. Bấm vào legend để làm mờ/hiện đường.">?</span>
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
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
            tickFormatter={v => formatPercent(v, 0)}
            tick={{ fontSize: 12 }}
            width={60}
            domain={['auto', 0]}
          />
          <Tooltip
            formatter={(value: number, name: string) => {
              if (isDimmed(name)) return []
              return formatPercentFull(value)
            }}
            labelFormatter={formatTooltipDate}
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
            const isDimmedLine = isDimmed(s.name)
            return (
              <Area
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={isDimmedLine ? DIMMED_COLOR : s.color}
                fill={isDimmedLine ? DIMMED_COLOR : s.color}
                fillOpacity={isDimmedLine ? 0.04 : 0.1}
                strokeWidth={isDimmedLine ? 0.75 : 1.5}
                opacity={isDimmedLine ? 0.4 : 1}
                dot={false}
                isAnimationActive={false}
              />
            )
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
