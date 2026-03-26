import { useFundMetadata, useMultiFundSeries } from './hooks/useFundData'
import { useMultiComparison } from './hooks/useCalculations'
import { useUrlState } from './hooks/useUrlState'
import { FundSelector } from './components/FundSelector'
import { KPICards } from './components/KPICards'
import { CumulativeReturnChart } from './components/CumulativeReturnChart'
import { DrawdownChart } from './components/DrawdownChart'
import { YearlyPerformanceChart } from './components/YearlyPerformanceChart'
import { RollingReturnChart } from './components/RollingReturnChart'
import { SimulationPanel } from './components/SimulationPanel'
import { DateRangePicker } from './components/DateRangePicker'
import { FUND_COLORS } from './constants'
import type { ChartSeries } from './types'

export function App() {
  const { metadata, metadataError, loading: metaLoading } = useFundMetadata()
  const { state, updateState } = useUrlState()

  const { data: fundData, loading: fundsLoading, errors: fundErrors } = useMultiFundSeries(state.funds)

  const comparison = useMultiComparison(
    state.funds,
    fundData,
    state.rollingPeriod,
    state.dateFrom,
    state.dateTo,
  )

  if (metaLoading) {
    return <div className="loading-screen">Đang tải dữ liệu...</div>
  }

  if (metadataError || !metadata) {
    return <div className="error-screen">{metadataError || 'Lỗi tải dữ liệu'}</div>
  }

  // Build chart series with colors
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

  // Collect any fund loading errors
  const errorMessages = Array.from(fundErrors.entries())
    .map(([id, msg]) => `${id}: ${msg}`)

  return (
    <div className="app">
      <header className="app-header">
        <h1>So Sánh Quỹ Đầu Tư Việt Nam</h1>
      </header>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${state.tab === 'compare' ? 'tab-active' : ''}`}
          onClick={() => updateState({ tab: 'compare' })}
        >
          So Sánh
        </button>
        <button
          className={`tab ${state.tab === 'simulate' ? 'tab-active' : ''}`}
          onClick={() => updateState({ tab: 'simulate' })}
        >
          Mô Phỏng
        </button>
        <button
          className={`tab ${state.tab === 'dca' ? 'tab-active' : ''}`}
          disabled
          title="Sắp ra mắt"
        >
          DCA (Sắp ra mắt)
        </button>
      </div>

      {/* Compare Tab — hidden via CSS when inactive to preserve state */}
      <div className="compare-content" style={{ display: state.tab === 'compare' ? undefined : 'none' }}>
          <FundSelector
            allFunds={metadata}
            selectedFunds={state.funds}
            onChangeFunds={funds => updateState({ funds })}
            startDate={comparison.status === 'ready' ? comparison.data.startDate : undefined}
            endDate={comparison.status === 'ready' ? comparison.data.endDate : undefined}
          />

          <DateRangePicker
            dateFrom={state.dateFrom}
            dateTo={state.dateTo}
            onChangeFrom={v => updateState({ dateFrom: v })}
            onChangeTo={v => updateState({ dateTo: v })}
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
              <KPICards funds={kpiFunds} />

              <CumulativeReturnChart series={chartSeries} />

              <DrawdownChart series={drawdownSeries} />

              <YearlyPerformanceChart series={yearlySeries} />

              <RollingReturnChart
                series={rollingSeries}
                period={state.rollingPeriod}
                onPeriodChange={p => updateState({ rollingPeriod: p })}
              />
            </>
          )}
        </div>

      {/* Simulate Tab — always mounted, hidden via CSS when inactive */}
      <div style={{ display: state.tab === 'simulate' ? undefined : 'none' }}>
        <SimulationPanel funds={metadata} />
      </div>

      <footer className="app-footer">
        <p>Dữ liệu từ fmarket.vn & vnstock. Cập nhật hàng ngày.</p>
      </footer>
    </div>
  )
}
