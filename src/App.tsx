import { useFundMetadata, useMultiFundSeries } from './hooks/useFundData'
import { useMultiComparison } from './hooks/useCalculations'
import { useUrlState } from './hooks/useUrlState'
import { FundSelector } from './components/FundSelector'
import { KPICards } from './components/KPICards'
import { CumulativeReturnChart } from './components/CumulativeReturnChart'
import { DrawdownChart } from './components/DrawdownChart'
import { YearlyPerformanceChart } from './components/YearlyPerformanceChart'
import { RollingReturnChart } from './components/RollingReturnChart'
import { CompareStoryBlock } from './components/CompareStoryBlock'
import { DataQualityBlock } from './components/DataQualityBlock'
import { SimulationPanel } from './components/SimulationPanel'
import { DCAPanel } from './components/DCAPanel'
import { LumpSumDCAPanel } from './components/LumpSumDCAPanel'
import { BitcoinPanel } from './components/BitcoinPanel'
import { ChangelogPanel } from './components/ChangelogPanel'
import { DividendNotice } from './components/DividendNotice'
import { DateRangePicker } from './components/DateRangePicker'
import { ShareButton } from './components/ShareButton'
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
          onClick={() => updateState({ tab: 'dca' })}
        >
          DCA
        </button>
        <button
          className={`tab ${state.tab === 'lsdca' ? 'tab-active' : ''}`}
          onClick={() => updateState({ tab: 'lsdca' })}
        >
          LS vs DCA
        </button>
        <button
          className={`tab ${state.tab === 'bitcoin' ? 'tab-active' : ''}`}
          onClick={() => updateState({ tab: 'bitcoin' })}
        >
          Bitcoin
        </button>
        <button
          className={`tab ${state.tab === 'changelog' ? 'tab-active' : ''}`}
          onClick={() => updateState({ tab: 'changelog' })}
        >
          Changelog
        </button>
      </div>

      {/* Compare Tab: hidden via CSS when inactive to preserve state */}
      <div className="compare-content" style={{ display: state.tab === 'compare' ? undefined : 'none' }}>
          <div className="panel-header">
            <h2>So Sánh Các Quỹ</h2>
            <ShareButton getUrl={() => window.location.href} />
          </div>
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
              <DividendNotice fundIds={state.funds} />

              <DataQualityBlock
                fundIds={state.funds}
                fundData={fundData}
                colors={FUND_COLORS}
                dateFrom={state.dateFrom}
                dateTo={state.dateTo}
                alignedStart={comparison.data.startDate}
                alignedEnd={comparison.data.endDate}
              />

              <KPICards funds={kpiFunds} />

              <CumulativeReturnChart series={chartSeries} />

              <DrawdownChart series={drawdownSeries} />

              <YearlyPerformanceChart series={yearlySeries} />

              <RollingReturnChart
                series={rollingSeries}
                period={state.rollingPeriod}
                onPeriodChange={p => updateState({ rollingPeriod: p })}
              />

              <CompareStoryBlock
                funds={comparison.data.funds}
                colors={FUND_COLORS}
                startDate={comparison.data.startDate}
                endDate={comparison.data.endDate}
              />
            </>
          )}
        </div>

      {/* Simulate Tab: always mounted, hidden via CSS when inactive */}
      <div style={{ display: state.tab === 'simulate' ? undefined : 'none' }}>
        <SimulationPanel funds={metadata} />
      </div>

      {/* DCA Tab */}
      <div style={{ display: state.tab === 'dca' ? undefined : 'none' }}>
        <DCAPanel funds={metadata} />
      </div>

      {/* LS vs DCA Tab */}
      <div style={{ display: state.tab === 'lsdca' ? undefined : 'none' }}>
        <LumpSumDCAPanel funds={metadata} />
      </div>

      {/* Bitcoin Tab */}
      <div style={{ display: state.tab === 'bitcoin' ? undefined : 'none' }}>
        <BitcoinPanel funds={metadata} />
      </div>

      {/* Changelog Tab */}
      {state.tab === 'changelog' && <ChangelogPanel />}

      <footer className="app-footer">
        <p>Dữ liệu từ fmarket.vn & vnstock. Cập nhật hàng ngày.</p>
        <p>Blog: <a href="https://vohoanghac.com" target="_blank" rel="noopener noreferrer">vohoanghac.com</a></p>
      </footer>
    </div>
  )
}
