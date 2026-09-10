import { memo } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { DcaBlock } from './DcaLayout'
import { formatTooltipDate, formatYear, getYearTicks } from '../utils/chartPlumbing'
import type { StockShareHoldingPoint } from '../utils/stockDcaPresentation'

interface Props {
  points: readonly StockShareHoldingPoint[]
}

const PURCHASED_COLOR = '#a8512f'
const DIVIDEND_COLOR = '#5e7c6a'

interface ShareHoldingsTooltipProps {
  active?: boolean
  label?: number
  payload?: Array<{ dataKey?: string; value?: number }>
}

function formatShares(value: number): string {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: 0 })
}

function formatSharesAxis(value: number): string {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: 0 })
}

function ShareHoldingsTooltip({ active, label, payload }: ShareHoldingsTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const purchasedShares = Number(payload.find(item => item.dataKey === 'purchasedShares')?.value ?? 0)
  const dividendShares = Number(payload.find(item => item.dataKey === 'dividendShares')?.value ?? 0)

  return (
    <div className="custom-tooltip">
      <p className="ct-date">{formatTooltipDate(Number(label))}</p>
      <p><strong>Tổng nắm giữ: {formatShares(purchasedShares + dividendShares)}</strong></p>
      <p>Cổ phiếu mua: {formatShares(purchasedShares)}</p>
      <p>Cổ phiếu nhận từ cổ tức: {formatShares(dividendShares)}</p>
    </div>
  )
}

function StockShareHoldingsBlockImpl({ points }: Props) {
  const data = points.map(point => ({
    ...point,
    totalShares: point.purchasedShares + point.dividendShares,
    timestamp: Date.parse(`${point.date}T00:00:00Z`),
  }))
  if (data.length === 0) return null

  return (
    <DcaBlock title="Số lượng cổ phiếu nắm giữ theo thời gian" className="stock-share-holdings-block">
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={getYearTicks(data)}
            tickFormatter={formatYear}
            tick={{ fontSize: 11, fill: '#6b7280' }}
          />
          <YAxis tickFormatter={formatSharesAxis} tick={{ fontSize: 11, fill: '#6b7280' }} width={72} />
          <Tooltip content={<ShareHoldingsTooltip />} />
          <Legend />
          <Area
            type="monotone"
            dataKey="purchasedShares"
            name="Cổ phiếu mua"
            stackId="holdings"
            stroke={PURCHASED_COLOR}
            fill={PURCHASED_COLOR}
            fillOpacity={0.22}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="dividendShares"
            name="Cổ phiếu nhận từ cổ tức"
            stackId="holdings"
            stroke={DIVIDEND_COLOR}
            fill={DIVIDEND_COLOR}
            fillOpacity={0.22}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="totalShares"
            name="Tổng nắm giữ"
            stroke="#141413"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </DcaBlock>
  )
}

export const StockShareHoldingsBlock = memo(StockShareHoldingsBlockImpl)
