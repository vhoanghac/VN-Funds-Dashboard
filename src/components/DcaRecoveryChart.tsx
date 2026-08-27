import { memo } from 'react'
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { ChartSeries, ReturnPoint } from '../types'
import {
  formatTooltipDate, formatYear, getYearTicks, mergeAllSeries,
} from '../utils/chartPlumbing'
import { recoveryMultipleFromDrawdown } from '../utils/drawdownStats'

export interface RecoveryPortfolio {
  id: string
  name: string
  color: string
  drawdown: ReturnPoint[]
}

interface Props {
  portfolios: RecoveryPortfolio[]
}

/** Chuyển chuỗi drawdown thành hệ số tăng cần có để quay lại đỉnh cũ. */
export function buildRecoverySeries(portfolios: RecoveryPortfolio[]): ChartSeries[] {
  return portfolios.map(portfolio => ({
    name: portfolio.name,
    color: portfolio.color,
    data: portfolio.drawdown.flatMap(point => {
      const multiple = recoveryMultipleFromDrawdown(point.value)
      return multiple === null ? [] : [{ date: point.date, value: multiple }]
    }),
  }))
}

function DcaRecoveryChartImpl({ portfolios }: Props) {
  const series = buildRecoverySeries(portfolios)
  const data = mergeAllSeries(series)
  if (data.length === 0) return null

  const maxRecovery = Math.max(
    1,
    ...series.flatMap(s => s.data.map(point => point.value)),
  )
  const yMax = maxRecovery <= 1.05 ? 1.05 : Math.ceil(maxRecovery * 10) / 10

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Hiệu suất để về lại đỉnh</h3>
        <span
          className="chart-tooltip-icon"
          title="Từ mức drawdown hiện tại, giá quỹ cần tăng bao nhiêu lần để quay lại đỉnh cũ."
        >?</span>
      </div>
      <p className="dca-recovery-sub">
        1,00× nghĩa là danh mục đang ở đỉnh. Khi đường lên 1,25×, giá quỹ cần tăng thêm
        25% mới quay lại đỉnh cũ.
      </p>
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={data} margin={{ top: 12, right: 20, left: 10, bottom: 5 }}>
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
            domain={[1, yMax]}
            tickFormatter={(value: number) => `${value.toFixed(2)}×`}
            tick={{ fontSize: 12 }}
            width={58}
          />
          <Tooltip
            formatter={(value: number, name: string) => [`${value.toFixed(2)}×`, name]}
            labelFormatter={formatTooltipDate}
          />
          <Legend />
          <ReferenceLine y={1} stroke="#9ca3af" strokeDasharray="6 3" />
          {series.map(s => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export const DcaRecoveryChart = memo(DcaRecoveryChartImpl)
