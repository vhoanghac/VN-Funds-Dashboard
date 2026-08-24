import { useCallback, useMemo } from 'react'
import type { CalculatorId } from './types'
import { useFundMetadata } from './hooks/useFundData'
import { useUrlState } from './hooks/useUrlState'
import { TAB_REGISTRY, type TabContext } from './tabRegistry'
import { SEO_BY_TAB, SeoMetadata } from './components/SeoMetadata'

export function App() {
  const { metadata, metadataError, loading: metaLoading } = useFundMetadata()
  const { state, updateState, dcaUrlParams, lsDcaUrlParams } = useUrlState()

  // Stable callback references (qua useCallback, dep chỉ là `updateState` vốn
  // đã ổn định) để CompareTab (React.memo) không bị coi là "props đổi" mỗi
  // khi App re-render vì lý do khác (vd chuyển sang tab khác).
  const onChangeFunds = useCallback((funds: string[]) => updateState({ funds }), [updateState])
  const onChangeDateFrom = useCallback((v: string | null) => updateState({ dateFrom: v }), [updateState])
  const onChangeDateTo = useCallback((v: string | null) => updateState({ dateTo: v }), [updateState])
  const onChangeRollingPeriod = useCallback((p: number) => updateState({ rollingPeriod: p }), [updateState])
  const onSelectCalculator = useCallback((calcId: CalculatorId) => updateState({ calcId }), [updateState])

  // Context truyền vào từng tab. Phải đặt TRƯỚC early return (Rules of Hooks):
  // mọi hook gọi vô điều kiện ở đầu component. Khi metadata chưa có thì chỉ
  // là [] thừa — không ai dùng vì đã return loading screen.
  const tabContext = useMemo<TabContext>(
    () => ({
      metadata: metadata ?? [],
      state,
      updateState,
      dcaUrlParams,
      lsDcaUrlParams,
      onChangeFunds,
      onChangeDateFrom,
      onChangeDateTo,
      onChangeRollingPeriod,
      onSelectCalculator,
    }),
    [metadata, state, updateState, dcaUrlParams, lsDcaUrlParams, onChangeFunds, onChangeDateFrom, onChangeDateTo, onChangeRollingPeriod, onSelectCalculator],
  )

  if (metaLoading) {
    return <div className="loading-screen">Đang tải dữ liệu...</div>
  }

  if (metadataError || !metadata) {
    return <div className="error-screen">{metadataError || 'Lỗi tải dữ liệu'}</div>
  }

  return (
    <div className="app">
      <SeoMetadata tab={state.tab} />
      <header className="app-header">
        <h1>{SEO_BY_TAB[state.tab].heading}</h1>
      </header>

      {/* Tabs — duyệt registry, không hardcode */}
      <div className="tabs">
        {TAB_REGISTRY.map(tab => (
          <button
            key={tab.id}
            className={`tab ${state.tab === tab.id ? 'tab-active' : ''}`}
            onClick={() => updateState({ tab: tab.id })}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Panel: keepMounted = ẩn bằng CSS để giữ state; ngược lại mount khi active */}
      {TAB_REGISTRY.map(tab =>
        tab.keepMounted ? (
          <div
            key={tab.id}
            className={tab.wrapperClass ? `${tab.wrapperClass} ${state.tab === tab.id ? '' : 'tab-panel-hidden'}` : (state.tab === tab.id ? undefined : 'tab-panel-hidden')}
          >
            {tab.render(tabContext)}
          </div>
        ) : (
          state.tab === tab.id && <div key={tab.id}>{tab.render(tabContext)}</div>
        ),
      )}

      <footer className="app-footer">
        <p>Dữ liệu từ fmarket.vn & vnstock. Cập nhật hàng ngày.</p>
        <p>Blog: <a href="https://vohoanghac.com" target="_blank" rel="noopener noreferrer">vohoanghac.com</a></p>
      </footer>
    </div>
  )
}
