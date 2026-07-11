import { memo } from 'react'
import { useMultiFundSeries } from '../hooks/useFundData'
import { useMultiComparison } from '../hooks/useCalculations'
import { FundSelector } from './FundSelector'
import { KPICards } from './KPICards'
import { CumulativeReturnChart } from './CumulativeReturnChart'
import { DrawdownChart } from './DrawdownChart'
import { YearlyPerformanceChart } from './YearlyPerformanceChart'
import { RollingReturnChart } from './RollingReturnChart'
import { CompareStoryBlock } from './CompareStoryBlock'
import { DataQualityBlock } from './DataQualityBlock'
import { DividendNotice } from './DividendNotice'
import { DateRangePicker } from './DateRangePicker'
import { ShareButton } from './ShareButton'
import { FUND_COLORS } from '../constants'
import type { ChartSeries, FundMeta } from '../types'

interface Props {
  metadata: FundMeta[]
  funds: string[]
  dateFrom: string | null
  dateTo: string | null
  rollingPeriod: number
  onChangeFunds: (funds: string[]) => void
  onChangeDateFrom: (v: string | null) => void
  onChangeDateTo: (v: string | null) => void
  onChangeRollingPeriod: (p: number) => void
}

/**
 * Tab "So Sánh" — tách riêng khỏi App.tsx để có thể React.memo. App.tsx luôn
 * mount cả 5 tab (ẩn bằng display:none), nên nếu tab này còn nằm inline
 * trong App(), nó sẽ re-render/reconcile lại mỗi khi chuyển sang tab khác —
 * dù không phải tab đang hiển thị.
 */
function CompareTabImpl({
  metadata, funds, dateFrom, dateTo, rollingPeriod,
  onChangeFunds, onChangeDateFrom, onChangeDateTo, onChangeRollingPeriod,
}: Props) {
  const { data: fundData, loading: fundsLoading, errors: fundErrors } = useMultiFundSeries(funds)

  const comparison = useMultiComparison(funds, fundData, rollingPeriod, dateFrom, dateTo)

  const chartSeries: ChartSeries[] = comparison.status === 'ready'
    ? comparison.data.funds.map((f, i) => ({
      name: f.id,
      color: FUND_COLORS[i % FUND_COLORS.length]!,
      data: f.cumulative,
    }))
    : []

  const drawdownSeries: ChartSeries[] = comparison.status === 'ready'
    ? comparison.data.funds.map((f, i) => ({
      name: f.id,
      color: FUND_COLORS[i % FUND_COLORS.length]!,
      data: f.drawdown,
    }))
    : []

  const rollingSeries: ChartSeries[] = comparison.status === 'ready'
    ? comparison.data.funds.map((f, i) => ({
      name: f.id,
      color: FUND_COLORS[i % FUND_COLORS.length]!,
      data: f.rolling,
    }))
    : []

  const yearlySeries = comparison.status === 'ready'
    ? comparison.data.funds.map((f, i) => ({
      name: f.id,
      color: FUND_COLORS[i % FUND_COLORS.length]!,
      data: f.yearly,
    }))
    : []

  const kpiFunds = comparison.status === 'ready'
    ? comparison.data.funds.map((f, i) => ({
      name: f.id,
      color: FUND_COLORS[i % FUND_COLORS.length]!,
      kpi: f.kpi,
    }))
    : []

  const errorMessages = Array.from(fundErrors.entries())
    .map(([id, msg]) => `${id}: ${msg}`)

  return (
    <>
      <div className="panel-header">
        <h2>So Sánh Các Quỹ</h2>
        <ShareButton getUrl={() => window.location.href} />
      </div>
      <FundSelector
        allFunds={metadata}
        selectedFunds={funds}
        onChangeFunds={onChangeFunds}
        startDate={comparison.status === 'ready' ? comparison.data.startDate : undefined}
        endDate={comparison.status === 'ready' ? comparison.data.endDate : undefined}
      />

      <DateRangePicker
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChangeFrom={onChangeDateFrom}
        onChangeTo={onChangeDateTo}
      />

      {fundsLoading && <div className="loading-indicator">Đang tải dữ liệu quỹ...</div>}
      {errorMessages.length > 0 && (
        <div className="error-banner">
          {errorMessages.map(msg => <p key={msg}>{msg}</p>)}
        </div>
      )}

      {comparison.status === 'error' && (
        <div className="error-banner">{comparison.error.message}</div>
      )}

      {comparison.status === 'ready' && (
        <>
          <DividendNotice fundIds={funds} />

          <DataQualityBlock
            fundIds={funds}
            fundData={fundData}
            colors={FUND_COLORS}
            dateFrom={dateFrom}
            dateTo={dateTo}
            alignedStart={comparison.data.startDate}
            alignedEnd={comparison.data.endDate}
          />

          <KPICards funds={kpiFunds} />

          <CumulativeReturnChart series={chartSeries} />

          <DrawdownChart series={drawdownSeries} />

          <YearlyPerformanceChart series={yearlySeries} />

          <RollingReturnChart
            series={rollingSeries}
            period={rollingPeriod}
            onPeriodChange={onChangeRollingPeriod}
          />

          <CompareStoryBlock
            funds={comparison.data.funds}
            colors={FUND_COLORS}
            startDate={comparison.data.startDate}
            endDate={comparison.data.endDate}
          />
        </>
      )}
    </>
  )
}

export const CompareTab = memo(CompareTabImpl)
