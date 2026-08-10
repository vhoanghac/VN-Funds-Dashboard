import { useCallback } from 'react'
import type { CalculatorId } from './types'
import { useFundMetadata } from './hooks/useFundData'
import { useUrlState } from './hooks/useUrlState'
import { CompareTab } from './components/CompareTab'
import { DCAPanel } from './components/DCAPanel'
import { LumpSumDCAPanel } from './components/LumpSumDCAPanel'
import { RebalanceSensitivityPanel } from './components/RebalanceSensitivityPanel'
import { TacticalAllocationPanel } from './components/TacticalAllocationPanel'
import { BitcoinPanel } from './components/BitcoinPanel'
import { WallOfWorryPanel } from './components/WallOfWorryPanel'
import { OverlapPanel } from './components/OverlapPanel'
import { CalculatorTab } from './components/calculators/CalculatorTab'
import { MethodologyPanel } from './components/MethodologyPanel'
import { ChangelogPanel } from './components/ChangelogPanel'

export function App() {
  const { metadata, metadataError, loading: metaLoading } = useFundMetadata()
  const { state, updateState } = useUrlState()

  // Stable callback references (qua useCallback, dep chỉ là `updateState` vốn
  // đã ổn định) để CompareTab (React.memo) không bị coi là "props đổi" mỗi
  // khi App re-render vì lý do khác (vd chuyển sang tab khác).
  const onChangeFunds = useCallback((funds: string[]) => updateState({ funds }), [updateState])
  const onChangeDateFrom = useCallback((v: string | null) => updateState({ dateFrom: v }), [updateState])
  const onChangeDateTo = useCallback((v: string | null) => updateState({ dateTo: v }), [updateState])
  const onChangeRollingPeriod = useCallback((p: number) => updateState({ rollingPeriod: p }), [updateState])
  const onSelectCalculator = useCallback((calcId: CalculatorId) => updateState({ calcId }), [updateState])

  if (metaLoading) {
    return <div className="loading-screen">Đang tải dữ liệu...</div>
  }

  if (metadataError || !metadata) {
    return <div className="error-screen">{metadataError || 'Lỗi tải dữ liệu'}</div>
  }

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
          className={`tab ${state.tab === 'overlap' ? 'tab-active' : ''}`}
          onClick={() => updateState({ tab: 'overlap' })}
        >
          Overlap
        </button>
        <button
          className={`tab ${state.tab === 'rebalance' ? 'tab-active' : ''}`}
          onClick={() => updateState({ tab: 'rebalance' })}
        >
          Tái Cân Bằng
        </button>
        <button
          className={`tab ${state.tab === 'tactical' ? 'tab-active' : ''}`}
          onClick={() => updateState({ tab: 'tactical' })}
        >
          Chiến Thuật Phân Bổ
        </button>
        <button
          className={`tab ${state.tab === 'bitcoin' ? 'tab-active' : ''}`}
          onClick={() => updateState({ tab: 'bitcoin' })}
        >
          Bitcoin
        </button>
        <button
          className={`tab ${state.tab === 'wallofworry' ? 'tab-active' : ''}`}
          onClick={() => updateState({ tab: 'wallofworry' })}
        >
          Wall of Worry
        </button>
        <button
          className={`tab ${state.tab === 'calculator' ? 'tab-active' : ''}`}
          onClick={() => updateState({ tab: 'calculator' })}
        >
          Máy Tính
        </button>
        <button
          className={`tab ${state.tab === 'methodology' ? 'tab-active' : ''}`}
          onClick={() => updateState({ tab: 'methodology' })}
        >
          Minh Bạch Hoá
        </button>
        <button
          className={`tab ${state.tab === 'changelog' ? 'tab-active' : ''}`}
          onClick={() => updateState({ tab: 'changelog' })}
        >
          Changelog
        </button>
      </div>

      {/* Compare Tab: hidden via CSS when inactive to preserve state */}
      <div className={`compare-content ${state.tab === 'compare' ? '' : 'tab-panel-hidden'}`}>
        <CompareTab
          metadata={metadata}
          funds={state.funds}
          dateFrom={state.dateFrom}
          dateTo={state.dateTo}
          rollingPeriod={state.rollingPeriod}
          onChangeFunds={onChangeFunds}
          onChangeDateFrom={onChangeDateFrom}
          onChangeDateTo={onChangeDateTo}
          onChangeRollingPeriod={onChangeRollingPeriod}
        />
      </div>

      {/* DCA Tab */}
      <div className={state.tab === 'dca' ? undefined : 'tab-panel-hidden'}>
        <DCAPanel funds={metadata} />
      </div>

      {/* LS vs DCA Tab */}
      <div className={state.tab === 'lsdca' ? undefined : 'tab-panel-hidden'}>
        <LumpSumDCAPanel funds={metadata} />
      </div>

      {/* Tái Cân Bằng Tab */}
      <div className={state.tab === 'rebalance' ? undefined : 'tab-panel-hidden'}>
        <RebalanceSensitivityPanel funds={metadata} />
      </div>

      {/* Chiến Thuật Phân Bổ Tab */}
      <div className={state.tab === 'tactical' ? undefined : 'tab-panel-hidden'}>
        <TacticalAllocationPanel funds={metadata} />
      </div>

      {/* Bitcoin Tab */}
      <div className={state.tab === 'bitcoin' ? undefined : 'tab-panel-hidden'}>
        <BitcoinPanel funds={metadata} />
      </div>

      {/* Wall of Worry Tab */}
      <div className={state.tab === 'wallofworry' ? undefined : 'tab-panel-hidden'}>
        <WallOfWorryPanel />
      </div>

      {/* Overlap Tab */}
      <div className={state.tab === 'overlap' ? undefined : 'tab-panel-hidden'}>
        <OverlapPanel funds={metadata} />
      </div>

      {/* Máy Tính Tab: mỗi calculator tự giữ state riêng, mount lại là mất số đã
          nhập. Nhưng mọi ô đều có default nên mất cũng không sao, khác với tab
          DCA phải giữ nguyên cả bộ thông số nặng. */}
      {state.tab === 'calculator' && (
        <CalculatorTab calcId={state.calcId} onSelect={onSelectCalculator} />
      )}

      {/* Minh Bạch Hoá Tab */}
      {state.tab === 'methodology' && <MethodologyPanel />}

      {/* Changelog Tab */}
      {state.tab === 'changelog' && <ChangelogPanel />}

      <footer className="app-footer">
        <p>Dữ liệu từ fmarket.vn & vnstock. Cập nhật hàng ngày.</p>
        <p>Blog: <a href="https://vohoanghac.com" target="_blank" rel="noopener noreferrer">vohoanghac.com</a></p>
      </footer>
    </div>
  )
}
