import { memo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { FUND_COLORS } from '../constants'
import { assetDisplayName } from '../utils/savingsAsset'
import { formatTooltipDate, formatYear, getYearTicks } from '../utils/chartPlumbing'
import type { DCAAssetValueSeries } from '../utils/dca'
import { DcaBlock } from './DcaLayout'

export interface FundAllocatedValueSeries {
  fundId: string
  values: { date: string; value: number }[]
}

export function buildFundAllocatedValueSeries(assetValues: DCAAssetValueSeries[]): FundAllocatedValueSeries[] {
  const valuesByFund = new Map<string, Map<string, number>>()

  for (const asset of assetValues) {
    const values = valuesByFund.get(asset.fundId) ?? new Map<string, number>()
    for (const point of asset.values) {
      values.set(point.date, (values.get(point.date) ?? 0) + point.value)
    }
    valuesByFund.set(asset.fundId, values)
  }

  return Array.from(valuesByFund, ([fundId, values]) => ({
    fundId,
    values: Array.from(values, ([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }))
}

function DcaFundValueChartImpl({ series }: { series: FundAllocatedValueSeries[] }) {
  return (
    <>
      {series.map((fund, index) => (
        <FundValueChart key={fund.fundId} fund={fund} color={FUND_COLORS[index % FUND_COLORS.length]!} />
      ))}
    </>
  )
}

function FundValueChart({ fund, color }: { fund: FundAllocatedValueSeries; color: string }) {
  const data = fund.values.map(point => ({
    ...point,
    timestamp: new Date(point.date).getTime(),
  }))
  const label = assetDisplayName(fund.fundId)

  if (data.length === 0) return null

  return (
    <DcaBlock
      title={`Giá trị phân bổ - ${label}`}
      className="dca-fund-value-block"
      actions={<span
        className="chart-tooltip-icon"
        title="Giá trị phân bổ của quỹ này tại từng ngày. Cộng các quỹ trong danh mục lại bằng tổng giá trị tài sản."
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
          <YAxis tickFormatter={formatAxisVND} tick={{ fontSize: 12 }} width={64} />
          <Tooltip
            labelFormatter={formatTooltipDate}
            formatter={(value: number) => [formatVNDFull(value), 'Giá trị phân bổ']}
          />
          <Line
            type="monotone"
            dataKey="value"
            name="Giá trị phân bổ"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </DcaBlock>
  )
}

export const DcaFundValueChart = memo(DcaFundValueChartImpl)

function formatAxisVND(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`
  return value.toFixed(0)
}

function formatVNDFull(value: number): string {
  return `${Math.round(value).toLocaleString('vi-VN')} đ`
}
