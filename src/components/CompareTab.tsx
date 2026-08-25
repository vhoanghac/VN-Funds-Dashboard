import { memo, useMemo } from 'react'
import { useMultiFundSeries } from '../hooks/useFundData'
import { useMultiComparison } from '../hooks/useCalculations'
import { FundSelector } from './FundSelector'
import { KPICards } from './KPICards'
import { AssetPriceChart, type AssetPriceSeries } from './AssetPriceChart'
import { CumulativeReturnChart } from './CumulativeReturnChart'
import { DrawdownChart } from './DrawdownChart'
import { YearlyPerformanceChart } from './YearlyPerformanceChart'
import { RollingReturnChart } from './RollingReturnChart'
import { CompareStoryBlock } from './CompareStoryBlock'
import { MonthlyHeatmap } from './MonthlyHeatmap'
import { DataQualityBlock } from './DataQualityBlock'
import { DividendNotice } from './DividendNotice'
import { DateRangePicker } from './DateRangePicker'
import { ShareButton } from './ShareButton'
import { FUND_COLORS } from '../constants'
import { assetDisplayName, isSavingsAssetId } from '../utils/savingsAsset'
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
  const dualPriceFundIds = useMemo(
    () => new Set(metadata.filter(m => m.type === 'gold').map(m => m.id)),
    [metadata],
  )
  const {
    data: fundData,
    purchase: purchasePriceData,
    loading: fundsLoading,
    errors: fundErrors,
  } = useMultiFundSeries(funds, { dualPriceFundIds })

  const comparison = useMultiComparison(
    funds,
    fundData,
    rollingPeriod,
    dateFrom,
    dateTo,
    purchasePriceData,
  )

  const chartSeries: ChartSeries[] = comparison.status === 'ready'
    ? comparison.data.funds.map((f, i) => ({
      name: assetDisplayName(f.id),
      color: FUND_COLORS[i % FUND_COLORS.length]!,
      data: f.cumulative,
    }))
    : []

  // Biểu đồ "Giá tài sản" cố ý BỎ QUA tiết kiệm ngân hàng. Chuỗi giá của nó là
  // chỉ số giả lập gốc 100 do dashboard tự sinh, không phải giá thật của một
  // đơn vị tài sản nào ngoài đời. Vẽ nó cạnh giá CCQ hay giá một lượng vàng sẽ
  // ngầm nói rằng "tiết kiệm cũng có giá đơn vị", tức dạy sai người dùng.
  // Giữ nguyên màu theo vị trí gốc để khớp màu với các biểu đồ còn lại.
  const priceSeries: AssetPriceSeries[] = comparison.status === 'ready'
    ? comparison.data.funds
      .map((f, i) => ({ fund: f, color: FUND_COLORS[i % FUND_COLORS.length]! }))
      .filter(({ fund }) => !isSavingsAssetId(fund.id))
      .map(({ fund, color }) => {
        const sellByDate = new Map(purchasePriceData.get(fund.id)?.map(p => [p.date, p.price]))
        const secondaryData = fund.prices.flatMap(p => {
          const sell = sellByDate.get(p.date)
          return sell === undefined ? [] : [{ date: p.date, value: sell }]
        })

        return {
          assetId: fund.id,
          name: assetDisplayName(fund.id),
          color,
          data: fund.prices,
          secondaryData: secondaryData.length > 0 ? secondaryData : undefined,
        }
      })
    : []

  const drawdownSeries: ChartSeries[] = comparison.status === 'ready'
    ? comparison.data.funds.map((f, i) => ({
      name: assetDisplayName(f.id),
      color: FUND_COLORS[i % FUND_COLORS.length]!,
      data: f.drawdown,
    }))
    : []

  const rollingSeries: ChartSeries[] = comparison.status === 'ready'
    ? comparison.data.funds.map((f, i) => ({
      name: assetDisplayName(f.id),
      color: FUND_COLORS[i % FUND_COLORS.length]!,
      data: f.rolling,
    }))
    : []

  const yearlySeries = comparison.status === 'ready'
    ? comparison.data.funds.map((f, i) => ({
      name: assetDisplayName(f.id),
      color: FUND_COLORS[i % FUND_COLORS.length]!,
      data: f.yearly,
    }))
    : []

  const monthlySeries = comparison.status === 'ready'
    ? comparison.data.funds.map((f, i) => ({
      name: assetDisplayName(f.id),
      color: FUND_COLORS[i % FUND_COLORS.length]!,
      data: f.monthlyFull,
    }))
    : []

  const kpiFunds = comparison.status === 'ready'
    ? comparison.data.funds.map((f, i) => ({
      name: assetDisplayName(f.id),
      color: FUND_COLORS[i % FUND_COLORS.length]!,
      kpi: f.kpi,
    }))
    : []

  // Đổi id thô sang tên hiển thị cho CompareStoryBlock. PHẢI bọc useMemo: khối
  // đó có useMemo riêng phụ thuộc vào chính mảng này, bên trong chạy
  // drawdownStats + rollingReturns cho từng quỹ. Tạo mảng mới mỗi lần render
  // sẽ khiến nó tính lại toàn bộ dù dữ liệu không hề đổi.
  const storyFunds = useMemo(
    () => comparison.status === 'ready'
      ? comparison.data.funds.map(f => ({ ...f, id: assetDisplayName(f.id) }))
      : [],
    [comparison],
  )

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

          {/* Tiết kiệm ngân hàng không có nguồn dữ liệu nào để mà kiểm tra chất
              lượng: chuỗi giá sinh tại chỗ nên luôn "đủ ngày, mới tinh". Đưa nó
              vào bảng này chỉ tạo cảm giác an tâm giả, nên loại thẳng ra. */}
          <DataQualityBlock
            fundIds={funds.filter(id => !isSavingsAssetId(id))}
            fundData={fundData}
            colors={FUND_COLORS}
            dateFrom={dateFrom}
            dateTo={dateTo}
            alignedStart={comparison.data.startDate}
            alignedEnd={comparison.data.endDate}
          />

          <KPICards funds={kpiFunds} />

          <AssetPriceChart series={priceSeries} metadata={metadata} />

          <CumulativeReturnChart series={chartSeries} />

          <DrawdownChart series={drawdownSeries} />

          <YearlyPerformanceChart series={yearlySeries} />

          <MonthlyHeatmap series={monthlySeries} />

          <RollingReturnChart
            series={rollingSeries}
            period={rollingPeriod}
            availablePeriods={comparison.data.availableRollingPeriods}
            onPeriodChange={onChangeRollingPeriod}
          />

          <CompareStoryBlock
            funds={storyFunds}
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
