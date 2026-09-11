import { memo, useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { StockPortfolioPositionPoint } from '../utils/stockPortfolioDca'
import { buildStockAllocatedValueSeries } from '../utils/stockDcaPresentation'
import { formatTooltipDate, formatYear, getYearTicks } from '../utils/chartPlumbing'
import { DcaBlock } from './DcaLayout'

interface Props {
  stockId: string
  points: readonly StockPortfolioPositionPoint[]
  color: string
}

interface Row {
  date: string
  timestamp: number
  allocated: number
  invested: number
}

/**
 * Giá trị phân bổ của một mã trong danh mục. Đường liền là giá trị sleeve đầy đủ
 * (giá thị trường + cổ phiếu chờ về − khoản phải trả + khoản phải thu + tiền để dành),
 * đường nét đứt là tổng tiền đã giải ngân vào mã. Cộng mọi mã lại bằng giá trị danh mục.
 */
function StockPositionValueChartImpl({ stockId, points, color }: Props) {
  const data = useMemo<Row[]>(() => {
    const investedByDate = new Map(points.map(point => [point.date, point.investedCash]))
    return buildStockAllocatedValueSeries(points).map(series => ({
      date: series.date,
      timestamp: new Date(series.date).getTime(),
      allocated: series.value,
      invested: investedByDate.get(series.date) ?? 0,
    }))
  }, [points])

  if (data.length === 0) return null

  return (
    <DcaBlock
      title={`Giá trị phân bổ - ${stockId}`}
      className="stock-position-value-block"
      actions={<span
        className="chart-tooltip-icon"
        title="Giá trị phân bổ của mã này: tiền đầu tư chia theo tỷ trọng, cổ tức tái đầu tư, quyền mua, cổ phiếu chờ về và khoản phải thu. Cộng tất cả các mã trong danh mục lại bằng tổng giá trị tài sản."
      >?</span>}
    >
      <ResponsiveContainer width="100%" height={220}>
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
            tickFormatter={formatAxisVND}
            tick={{ fontSize: 12 }}
            width={64}
          />
          <Tooltip
            labelFormatter={formatTooltipDate}
            formatter={(value: number, name: string) => [formatVNDFull(value), name]}
          />
          <Line
            type="monotone"
            dataKey="allocated"
            name="Giá trị phân bổ"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="stepAfter"
            dataKey="invested"
            name="Đã đầu tư"
            stroke="#94a3b8"
            strokeDasharray="6 3"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </DcaBlock>
  )
}

export const StockPositionValueChart = memo(StockPositionValueChartImpl)

function formatAxisVND(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`
  return value.toFixed(0)
}

function formatVNDFull(value: number): string {
  return `${Math.round(value).toLocaleString('vi-VN')} đ`
}
