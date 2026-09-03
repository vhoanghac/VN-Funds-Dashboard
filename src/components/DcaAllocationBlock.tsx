import { memo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { FUND_COLORS } from '../constants'
import { assetDisplayName } from '../utils/savingsAsset'
import { formatTooltipDate, formatYear, getYearTicks } from '../utils/chartPlumbing'
import { DcaBlock } from './DcaLayout'

interface AssetValuePoint {
  date: string
  value: number
}

export interface AllocationAssetSeries {
  fundId: string
  values: AssetValuePoint[]
}

export interface AllocationPortfolio {
  id: string
  name: string
  assetValues: AllocationAssetSeries[]
}

interface AllocationPoint {
  date: string
  timestamp: number
  [fundId: string]: string | number
}

interface AllocationAssetMeta {
  fundId: string
  label: string
  color: string
}

interface Props {
  portfolios: AllocationPortfolio[]
}

export function buildAllocationData(assets: AllocationAssetSeries[]): AllocationPoint[] {
  const valuesByAsset = new Map<string, Map<string, number>>()
  const dates = new Set<string>()

  for (const asset of assets) {
    const values = valuesByAsset.get(asset.fundId) ?? new Map<string, number>()
    for (const point of asset.values) {
      values.set(point.date, (values.get(point.date) ?? 0) + point.value)
      dates.add(point.date)
    }
    valuesByAsset.set(asset.fundId, values)
  }

  return Array.from(dates).sort().map(date => {
    const row: AllocationPoint = {
      date,
      timestamp: new Date(date).getTime(),
    }
    let total = 0
    for (const values of valuesByAsset.values()) total += values.get(date) ?? 0

    for (const [fundId, values] of valuesByAsset) {
      const value = values.get(date) ?? 0
      row[fundId] = total > 0 ? (value / total) * 100 : 0
    }
    return row
  })
}

function allocationLabel(fundId: string): string {
  const label = assetDisplayName(fundId)
  return fundId.startsWith('SAVINGS:') ? label : `quỹ ${label}`
}

function formatAllocation(value: number): string {
  return `${value.toFixed(1)}%`
}

function DcaAllocationBlockImpl({ portfolios }: Props) {
  if (portfolios.length === 0) return null

  return (
    <>
      {portfolios.map(portfolio => (
        <AllocationPortfolioBlock key={portfolio.id} portfolio={portfolio} />
      ))}
    </>
  )
}

function AllocationPortfolioBlock({ portfolio }: { portfolio: AllocationPortfolio }) {
  const assetIds = Array.from(new Set(portfolio.assetValues.map(asset => asset.fundId)))
  const assets = assetIds.map((fundId, index) => ({
    fundId,
    label: assetDisplayName(fundId),
    color: FUND_COLORS[index % FUND_COLORS.length]!,
  }))

  if (assets.length === 1) {
    return (
      <DcaBlock title={portfolio.name} className="dca-allocation-block">
        <p className="dca-allocation-single">100% {allocationLabel(assets[0]!.fundId)}</p>
      </DcaBlock>
    )
  }

  const data = buildAllocationData(portfolio.assetValues)
  if (data.length === 0) return null

  return <AllocationChart portfolio={portfolio} assets={assets} data={data} />
}

function AllocationChart({
  portfolio,
  assets,
  data,
}: {
  portfolio: AllocationPortfolio
  assets: AllocationAssetMeta[]
  data: AllocationPoint[]
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const activeIndex = hoveredIndex !== null && hoveredIndex < data.length
    ? hoveredIndex
    : data.length - 1
  const activePoint = data[activeIndex]!

  return (
    <DcaBlock title={portfolio.name} className="dca-allocation-block">
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart
          data={data}
          margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
          onMouseMove={(state: { activeTooltipIndex?: number | string }) => {
            if (state.activeTooltipIndex === undefined) return
            const index = Number(state.activeTooltipIndex)
            if (Number.isInteger(index)) setHoveredIndex(index)
          }}
          onMouseLeave={() => setHoveredIndex(null)}
        >
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
            domain={[0, 100]}
            tickFormatter={(value: number) => `${Math.round(value)}%`}
            tick={{ fontSize: 12 }}
            width={52}
          />
          <Tooltip
            labelFormatter={formatTooltipDate}
            formatter={(value: number, name: string) => [formatAllocation(value), name]}
          />
          {assets.map(asset => (
            <Area
              key={asset.fundId}
              type="monotone"
              dataKey={asset.fundId}
              name={asset.label}
              stackId="allocation"
              stroke={asset.color}
              fill={asset.color}
              fillOpacity={0.72}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div className="dca-allocation-legend" aria-label={`Tỷ trọng tài sản của ${portfolio.name}`}>
        <div className="dca-allocation-legend-date">Tại {formatTooltipDate(activePoint.timestamp)}</div>
        <div className="dca-allocation-legend-items">
          {assets.map(asset => (
            <span key={asset.fundId} className="dca-allocation-legend-item">
              <span className="dca-allocation-swatch" style={{ backgroundColor: asset.color }} />
              {asset.label}: <strong>{formatAllocation(Number(activePoint[asset.fundId] ?? 0))}</strong>
            </span>
          ))}
        </div>
      </div>
    </DcaBlock>
  )
}

export const DcaAllocationBlock = memo(DcaAllocationBlockImpl)
