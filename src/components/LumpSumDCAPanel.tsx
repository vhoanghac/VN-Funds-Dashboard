import React, { useState, useMemo, useEffect, useRef, memo } from 'react'
import { MoneyInput } from './MoneyInput'
import { ShareButton } from './ShareButton'
import { buildLsDcaUrl, parseLsDcaParams } from '../utils/shareUrl'
import { loadLS, saveLS } from '../utils/localStorage'
import Select from 'react-select'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer,
} from 'recharts'
import type { FundMeta, PricePoint } from '../types'
import { derivePortfolioName, type DCASlot } from '../utils/dca'
import { parseCSV } from '../utils/csvParser'
import { alignFundsToCommonGridDaily } from '../utils/weeklyResample'
import { loadAdjustedPrices } from '../utils/dividendAdjust'
import { DividendNotice } from './DividendNotice'
import {
  computeRollingScenarios,
  summarizeScenarios,
  buildHistogram,
  computeHeatmap,
  HEATMAP_HOLDING_YEARS,
  HEATMAP_DCA_MONTHS,
  type CashMode,
  type LSvsDCAFreq,
  type LSvsDCASummary,
  type HistogramBucket,
  type HeatmapCell,
} from '../utils/lsVsDca'
import {
  PortfolioCard,
  portfolioSelectStyles,
  type PortfolioCardState,
} from './PortfolioCard'

interface Props {
  funds: FundMeta[]
}

const HORIZON_OPTIONS = [3, 6, 12, 18, 24, 36]

function LumpSumDCAPanelImpl({ funds }: Props) {
  const nextIdRef = useRef(1)
  const hasRunOnceRef = useRef(false)

  // Read URL params once on mount (shared link restore)
  const urlParams = parseLsDcaParams()

  // ── Parameters ──
  const [totalCapital, setTotalCapital] = useState(
    urlParams?.totalCapital ?? loadLS('lsdca_totalCapital', 100_000_000)
  )
  const [horizonMonths, setHorizonMonths] = useState(
    urlParams?.horizonMonths ?? loadLS('lsdca_horizonMonths', 12)
  )
  const [freq, setFreq] = useState<LSvsDCAFreq>(
    urlParams?.freq ?? loadLS('lsdca_freq', 'monthly' as LSvsDCAFreq)
  )
  const [cashMode, setCashMode] = useState<CashMode>(
    urlParams?.cashMode ?? loadLS('lsdca_cashMode', 'flat' as CashMode)
  )
  const [savingsRate, setSavingsRate] = useState(
    urlParams?.savingsRate ?? loadLS('lsdca_savingsRate', 4)
  )
  const [cashFundId, setCashFundId] = useState<string>(
    urlParams?.cashFundId ?? loadLS('lsdca_cashFundId', '')
  )
  const [compareFundId, setCompareFundId] = useState<string>(
    urlParams?.compareFundId ?? loadLS('lsdca_compareFundId', '')
  )
  const [showCagr, setShowCagr] = useState(false)
  const [showExplainer, setShowExplainer] = useState(false)

  // ── Portfolio (single) ──
  type SavedPortfolio = { slots: { fundId: string; weight: number }[]; rebalFreq: string; name?: string } | null
  const [portfolio, setPortfolio] = useState<PortfolioCardState | null>(() => {
    const src = urlParams?.portfolio ?? loadLS<SavedPortfolio>('lsdca_portfolio', null)
    if (!src) return null
    const num = nextIdRef.current++
    return {
      id: `lsdca${num}`,
      num,
      name: src.name || derivePortfolioName(src.slots, num),
      isNameCustom: !!src.name,
      slots: src.slots,
      rebalFreq: src.rebalFreq as import('../types').RebalanceFrequency,
    }
  })

  // ── Data ──
  const [fundData, setFundData] = useState<Map<string, PricePoint[]>>(new Map())
  const [loading, setLoading] = useState(false)

  // Snapshot at run time
  const [committed, setCommitted] = useState<{
    portfolio: PortfolioCardState
    totalCapital: number
    horizonMonths: number
    freq: LSvsDCAFreq
    cashMode: CashMode
    cashSavingsRate: number
    cashFundId: string
    compareFundId: string
  } | null>(null)

  // ── Persist to localStorage ──
  useEffect(() => { saveLS('lsdca_totalCapital', totalCapital) }, [totalCapital])
  useEffect(() => { saveLS('lsdca_horizonMonths', horizonMonths) }, [horizonMonths])
  useEffect(() => { saveLS('lsdca_freq', freq) }, [freq])
  useEffect(() => { saveLS('lsdca_cashMode', cashMode) }, [cashMode])
  useEffect(() => { saveLS('lsdca_savingsRate', savingsRate) }, [savingsRate])
  useEffect(() => { saveLS('lsdca_cashFundId', cashFundId) }, [cashFundId])
  useEffect(() => { saveLS('lsdca_compareFundId', compareFundId) }, [compareFundId])
  useEffect(() => {
    saveLS('lsdca_portfolio', portfolio ? {
      slots: portfolio.slots, rebalFreq: portfolio.rebalFreq,
      name: portfolio.isNameCustom ? portfolio.name : undefined,
    } : null)
  }, [portfolio])

  const fundOptions = useMemo(
    () => funds.map(f => ({ value: f.id, label: f.name_vi })),
    [funds],
  )

  // Bond/balanced funds for cash fund picker
  const cashFundOptions = useMemo(
    () => funds
      .filter(f => ['VFF', 'DCBF', 'BVBF', 'SSIBF', 'DCIP'].includes(f.id))
      .map(f => ({ value: f.id, label: f.name_vi })),
    [funds],
  )

  // Collect fund IDs needed (portfolio slots + cash fund + compare fund)
  const neededIds = useMemo(() => {
    const ids = new Set<string>()
    if (portfolio) {
      for (const s of portfolio.slots) {
        if (s.fundId) ids.add(s.fundId)
      }
    }
    if (cashMode === 'fund' && cashFundId) ids.add(cashFundId)
    if (compareFundId) ids.add(compareFundId)
    return ids
  }, [portfolio, cashMode, cashFundId, compareFundId])

  // Fetch and resample CSV data
  useEffect(() => {
    let cancelled = false
    const toFetch = Array.from(neededIds).filter(id => !fundData.has(id))
    if (toFetch.length === 0) return

    setLoading(true)
    Promise.all(
      toFetch.map(async id => {
        const resp = await fetch(`/data/${id}.csv`)
        if (!resp.ok) return null
        const text = await resp.text()
        const rawDaily = parseCSV(text)
        const daily = await loadAdjustedPrices(id, rawDaily)
        return { id, data: daily }
      }),
    ).then(results => {
      if (cancelled) return
      setFundData(prev => {
        const next = new Map(prev)
        for (const r of results) {
          if (r) next.set(r.id, r.data)
        }
        return next
      })
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [neededIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Portfolio management ──
  function addPortfolio() {
    if (portfolio) return
    const num = nextIdRef.current++
    const defaultFundId = funds[0]?.id || ''
    const slots = [{ fundId: defaultFundId, weight: 100 }]
    setPortfolio({
      id: `lsdca${num}`,
      num,
      name: derivePortfolioName(slots, num),
      isNameCustom: false,
      slots,
      rebalFreq: 'quarterly',
    })
  }

  function updatePortfolio(update: Partial<PortfolioCardState>) {
    setPortfolio(prev => prev ? { ...prev, ...update } : null)
  }

  function addSlot() {
    if (!portfolio) return
    const used = new Set(portfolio.slots.map(s => s.fundId))
    const available = funds.find(f => !used.has(f.id))
    const newSlots = [...portfolio.slots, { fundId: available?.id || '', weight: 0 }]
    const name = portfolio.isNameCustom ? portfolio.name : derivePortfolioName(newSlots, portfolio.num)
    setPortfolio(prev => prev ? { ...prev, name, slots: newSlots } : null)
  }

  function removeSlot(idx: number) {
    if (!portfolio || portfolio.slots.length <= 1) return
    const newSlots = portfolio.slots.filter((_, i) => i !== idx)
    const name = portfolio.isNameCustom ? portfolio.name : derivePortfolioName(newSlots, portfolio.num)
    setPortfolio(prev => prev ? { ...prev, name, slots: newSlots } : null)
  }

  function updateSlot(idx: number, update: Partial<DCASlot>) {
    if (!portfolio) return
    const newSlots = portfolio.slots.map((s, i) => i === idx ? { ...s, ...update } : s)
    const name = portfolio.isNameCustom ? portfolio.name : derivePortfolioName(newSlots, portfolio.num)
    setPortfolio(prev => prev ? { ...prev, name, slots: newSlots } : null)
  }

  function setEqualWeights() {
    if (!portfolio || portfolio.slots.length === 0) return
    const n = portfolio.slots.length
    const w = Math.floor(100 / n)
    const remainder = 100 - w * n
    setPortfolio(prev => prev
      ? { ...prev, slots: prev.slots.map((s, i) => ({ ...s, weight: w + (i < remainder ? 1 : 0) })) }
      : null)
  }

  const totalWeight = portfolio?.slots.reduce((s, f) => s + f.weight, 0) ?? 0
  const canRun = portfolio !== null
    && Math.abs(totalWeight - 100) < 0.01
    && portfolio.slots.every(s => s.fundId)
    && totalCapital > 0
    && (cashMode !== 'fund' || cashFundId !== '')

  function buildCommitted() {
    return {
      portfolio: { ...portfolio!, slots: [...portfolio!.slots] },
      totalCapital,
      horizonMonths,
      freq,
      cashMode,
      cashSavingsRate: savingsRate / 100,
      cashFundId,
      compareFundId,
    }
  }

  function runAnalysis() {
    if (!canRun || !portfolio) return
    hasRunOnceRef.current = true
    setCommitted(buildCommitted())
  }

  // Auto-recompute when lightweight params change (no new data fetch needed)
  useEffect(() => {
    if (!hasRunOnceRef.current || !canRun || !portfolio) return
    setCommitted(buildCommitted())
  }, [totalCapital, horizonMonths, freq, cashMode, savingsRate, cashFundId, compareFundId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Compute results ──
  const results = useMemo<{
    summary: LSvsDCASummary
    histogram: HistogramBucket[]
    heatmap: HeatmapCell[][]
    heatmap2: HeatmapCell[][] | null
    compareFundName: string | null
    effectiveWindow: string
  } | null>(() => {
    if (!committed) return null
    const { portfolio: p, cashMode: cm, cashFundId: cfId, compareFundId: cfId2 } = committed

    const validSlots = p.slots.filter(s => s.fundId && s.weight > 0)
    if (validSlots.length === 0) return null

    // Collect all fund prices
    const allFundIds = new Set(validSlots.map(s => s.fundId))
    const allPricesRaw = new Map<string, PricePoint[]>()
    for (const id of allFundIds) {
      const data = fundData.get(id)
      if (!data || data.length === 0) return null
      allPricesRaw.set(id, data)
    }

    // Align main portfolio funds
    const aligned = alignFundsToCommonGridDaily(allPricesRaw)

    // Cash fund prices (if needed)
    const cashFundPrices = (cm === 'fund' && cfId) ? fundData.get(cfId) ?? null : null
    if (cm === 'fund' && cfId && !cashFundPrices) return null

    const scenarios = computeRollingScenarios(
      aligned,
      validSlots,
      committed.totalCapital,
      committed!.horizonMonths,
      committed.freq,
      cm,
      committed.cashSavingsRate,
      cashFundPrices,
    )

    const summary = summarizeScenarios(scenarios)
    if (!summary) return null

    const histogram = buildHistogram(scenarios)

    const heatmap = computeHeatmap(
      aligned, validSlots, committed.freq, cm, committed.cashSavingsRate, cashFundPrices,
    )

    // Heatmap for comparison fund (if selected)
    let heatmap2: HeatmapCell[][] | null = null
    let compareFundName: string | null = null
    if (cfId2) {
      const comparePrices = fundData.get(cfId2)
      if (comparePrices && comparePrices.length > 0) {
        const compareMap = new Map([[cfId2, comparePrices]])
        const aligned2 = alignFundsToCommonGridDaily(compareMap)
        heatmap2 = computeHeatmap(
          aligned2, [{ fundId: cfId2, weight: 100 }],
          committed.freq, cm, committed.cashSavingsRate, cashFundPrices,
        )
        compareFundName = funds.find(f => f.id === cfId2)?.name_vi ?? cfId2
      }
    }

    // Effective window info
    const firstFundPrices = aligned.get(validSlots[0]!.fundId)
    const fromDate = firstFundPrices?.[0]?.date ?? ''
    const toDate = firstFundPrices?.[firstFundPrices.length - 1]?.date ?? ''
    const effectiveWindow = `${formatDate(fromDate)} → ${formatDate(toDate)}`

    return { summary, histogram, heatmap, heatmap2, compareFundName, effectiveWindow }
  }, [committed, fundData])

  // ── Helpers ──
  function formatDate(d: string): string {
    if (!d) return ''
    const [y, m, dd] = d.split('-')
    return `${dd}/${m}/${y}`
  }

  function fmtPct(v: number, decimals = 1): string {
    const pct = (v * 100)
    const sign = pct >= 0 ? '+' : ''
    return `${sign}${pct.toFixed(decimals)}%`
  }

  function fmtGrowth(g: number): string {
    return fmtPct(g - 1)
  }

  function fmtCapital(n: number): string {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)} tỷ đồng`
    if (n >= 1_000_000) return `${Math.round(n / 1_000_000)} triệu đồng`
    return n.toLocaleString('vi-VN') + ' đồng'
  }

  function fmtGrowthOrCagr(growthRatio: number): string {
    if (showCagr && committed && committed!.horizonMonths > 0) {
      const annualized = Math.pow(growthRatio, 12 / committed!.horizonMonths) - 1
      return fmtPct(annualized) + '/năm'
    }
    return fmtGrowth(growthRatio)
  }

  function renderHeatmapGrid(data: HeatmapCell[][], label?: string) {
    return (
      <div className={label ? 'lsdca-heatmap-compare' : undefined}>
        {label && <p className="lsdca-heatmap-compare-label">{label}</p>}
        <div className="lsdca-heatmap-wrapper">
          <div className="lsdca-hm-yaxis-title">Thời gian nắm giữ</div>
          <div className="lsdca-heatmap-inner">
            <div
              className="lsdca-heatmap"
              style={{ gridTemplateColumns: `56px repeat(${HEATMAP_DCA_MONTHS.length}, 1fr)` }}
            >
              <div />
              {HEATMAP_DCA_MONTHS.map(m => (
                <div key={m} className="lsdca-hm-col-header">{m} tháng</div>
              ))}
              {data.map((row, ri) => (
                <React.Fragment key={ri}>
                  <div className="lsdca-hm-row-header">{HEATMAP_HOLDING_YEARS[ri]} năm</div>
                  {row.map((cell, ci) => {
                    if (cell.winRate === null) {
                      return (
                        <div
                          key={ci}
                          className="lsdca-hm-cell lsdca-hm-cell--na"
                          title="Không đủ dữ liệu lịch sử"
                        >—</div>
                      )
                    }
                    const tier = cell.winRate >= 0.70 ? 'strong'
                               : cell.winRate >= 0.50 ? 'medium'
                               : 'weak'
                    const wins = Math.round(cell.winRate * cell.totalScenarios)
                    const lowN = cell.totalScenarios < 30
                    return (
                      <div
                        key={ci}
                        className={`lsdca-hm-cell lsdca-hm-cell--${tier}${lowN ? ' lsdca-hm-cell-lown' : ''}`}
                        title={`Giữ ${cell.holdingYears} năm, DCA ${cell.dcaMonths} tháng → LS thắng ${(cell.winRate * 100).toFixed(1)}% (${wins}/${cell.totalScenarios} kịch bản)`}
                      >
                        <div className="lsdca-hm-fraction">
                          {wins}<span className="lsdca-hm-slash">/</span>{cell.totalScenarios}
                        </div>
                        <div className="lsdca-hm-bar-wrap">
                          <div className="lsdca-hm-bar" style={{ width: `${cell.winRate * 100}%` }} />
                        </div>
                        <div className="lsdca-hm-pct">
                          {lowN && '⚠ '}{(cell.winRate * 100).toFixed(0)}% LS thắng
                        </div>
                      </div>
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
            <div className="lsdca-hm-xaxis-title">Thời gian DCA (tháng)</div>
          </div>
        </div>
      </div>
    )
  }

  // ── Render ──
  return (
    <div className="simulation-panel lsdca-panel">
      <div className="panel-header">
        <h2>Lump Sum vs DCA</h2>
        <ShareButton getUrl={() => buildLsDcaUrl({
          totalCapital, horizonMonths, freq, cashMode,
          savingsRate, cashFundId, compareFundId,
          portfolio: portfolio ? {
            slots: portfolio.slots, rebalFreq: portfolio.rebalFreq,
            name: portfolio.isNameCustom ? portfolio.name : undefined,
          } : null,
        })} />
      </div>
      <p className="lsdca-subtitle">
        So sánh hai chiến lược triển khai cùng một khoản vốn: đầu tư toàn bộ ngay từ đầu (Lump Sum)
        hay chia đều trong N tháng (DCA).
      </p>

      {/* ── Parameters ── */}
      <div className="dca-params-card">
        <h3 className="dca-section-title">Thông số</h3>

        <div className="dca-param-row">
          <label className="dca-label">Tổng vốn đầu tư</label>
          <div className="dca-amount-input-wrap">
            <div className="dca-amount-input">
              <MoneyInput value={totalCapital} onChange={setTotalCapital} min={1_000_000} />
              <span className="dca-currency">₫</span>
            </div>
            <span className="lsdca-capital-hint">= {fmtCapital(totalCapital)}</span>
          </div>
        </div>

        <div className="dca-param-row">
          <label className="dca-label">Trải DCA trong</label>
          <div className="lsdca-horizon-buttons">
            {HORIZON_OPTIONS.map(m => (
              <button
                key={m}
                className={`lsdca-horizon-btn ${horizonMonths === m ? 'lsdca-horizon-btn-active' : ''}`}
                onClick={() => setHorizonMonths(m)}
              >
                {m} tháng
              </button>
            ))}
          </div>
        </div>

        <div className="dca-param-row">
          <label className="dca-label">Tần suất DCA</label>
          <div className="lsdca-freq-btns">
            <button
              className={`dca-mode-btn ${freq === 'monthly' ? 'dca-mode-btn-active' : ''}`}
              onClick={() => setFreq('monthly')}
            >
              Hàng tháng
            </button>
            <button
              className={`dca-mode-btn ${freq === 'weekly' ? 'dca-mode-btn-active' : ''}`}
              onClick={() => setFreq('weekly')}
            >
              Hàng tuần
            </button>
          </div>
        </div>

        <div className="dca-param-row">
          <label className="dca-label">Vốn chờ chưa đầu tư</label>
          <select
            className="dca-freq-select"
            value={cashMode}
            onChange={e => setCashMode(e.target.value as CashMode)}
          >
            <option value="flat">Không sinh lãi</option>
            <option value="savings">Lãi suất tiết kiệm</option>
            <option value="fund">Đầu tư vào quỹ khác</option>
          </select>
        </div>

        {cashMode === 'savings' && (
          <div className="dca-param-row">
            <label className="dca-label">Lãi suất tiết kiệm (%/năm)</label>
            <div className="dca-amount-input">
              <input
                type="number"
                min={0}
                max={20}
                step={0.5}
                value={savingsRate}
                onChange={e => setSavingsRate(Math.max(0, Number(e.target.value)))}
              />
              <span className="dca-currency">%</span>
            </div>
          </div>
        )}

        {cashMode === 'fund' && (
          <div className="dca-param-row">
            <label className="dca-label">Quỹ đầu tư khi chờ</label>
            <Select
              className="lsdca-cash-fund-select"
              classNamePrefix="fund-search"
              options={cashFundOptions}
              value={cashFundOptions.find(o => o.value === cashFundId) || null}
              onChange={opt => setCashFundId(opt?.value || '')}
              placeholder="Chọn quỹ trái phiếu..."
              noOptionsMessage={() => 'Không tìm thấy'}
              isSearchable
              styles={portfolioSelectStyles}
            />
          </div>
        )}

        <p className="dca-note">
          * Phân tích tất cả các kịch bản rolling.<br />
          * Nếu bạn DCA từ lương mỗi tháng thì tab này không có ứng dụng với bạn. Nó chỉ áp dụng khi có sẵn một cục tiền lớn và đang phân vân nên đầu tư hết luôn hay rải dần.<br />
          * Về lãi suất tiết kiệm: mỗi kỳ chỉ rút ra đúng phần chia đều để đầu tư, phần còn lại vẫn gửi tiết kiệm sinh lãi nhưng khoản lãi đó không mang vào đầu tư. Nhờ vậy tổng vốn LS và DCA luôn bằng nhau.
        </p>
      </div>

      {/* ── Portfolio card ── */}
      {portfolio && (
        <PortfolioCard
          portfolio={portfolio}
          pIdx={0}
          funds={funds}
          fundOptions={fundOptions}
          onUpdate={updatePortfolio}
          onRemove={() => setPortfolio(null)}
          onAddSlot={addSlot}
          onRemoveSlot={removeSlot}
          onUpdateSlot={updateSlot}
          onSetEqualWeights={setEqualWeights}
          showRebal={false}
        />
      )}

      {!portfolio && (
        <button className="sim-add-portfolio-btn" onClick={addPortfolio}>
          + Thêm Danh Mục
        </button>
      )}

      {portfolio && (
        <button
          className="sim-run-btn"
          onClick={runAnalysis}
          disabled={!canRun}
        >
          Chạy Phân Tích
        </button>
      )}

      {loading && <div className="loading-indicator">Đang tải dữ liệu...</div>}

      {/* Pre-run hint */}
      {!committed && !loading && portfolio && (
        <div className="lsdca-pre-run-hint">
          ↑ Chọn quỹ, điều chỉnh thông số rồi bấm <strong>Chạy Phân Tích</strong> để xem kết quả so sánh
        </div>
      )}

      {/* ── Results ── */}
      {committed && !results && !loading && (
        <div className="error-banner">
          Không đủ dữ liệu. Horizon dài hơn cửa sổ dữ liệu, hoặc quỹ chưa tải xong.
        </div>
      )}

      {results && (
        <div className="lsdca-results">
          <DividendNotice fundIds={Array.from(new Set([
            ...committed!.portfolio.slots.map(s => s.fundId),
            committed!.cashFundId,
            committed!.compareFundId,
          ].filter(Boolean)))} />

          <div className="lsdca-window-info">
            Phân tích <strong>{results.summary.totalScenarios}</strong> kịch bản rolling
            &nbsp;({results.effectiveWindow})
          </div>

          {/* ── Summary card ── */}
          <div className="lsdca-summary-card">
            <div className="lsdca-winner-row">
              <span className="lsdca-winner-label">Lump Sum thắng</span>
              <span className={`lsdca-winner-value ${results.summary.lsWinRate >= 0.5 ? 'lsdca-ls-color' : 'lsdca-dca-color'}`}>
                {(results.summary.lsWinRate * 100).toFixed(1)}%
              </span>
              <span className="lsdca-winner-sub">
                ({Math.round(results.summary.lsWinRate * results.summary.totalScenarios)}/{results.summary.totalScenarios} kịch bản)
              </span>
              <button
                className={`lsdca-cagr-btn ${showCagr ? 'lsdca-cagr-btn-active' : ''}`}
                onClick={() => setShowCagr(v => !v)}
                title={showCagr
                  ? 'Đang xem lời/năm (quy đổi). Nhấn để xem tổng lời/lỗ cả kỳ đầu tư'
                  : `Nhấn để xem lời/năm: nếu mức lãi sau ${committed!.horizonMonths}th này mà đều mỗi năm, thì được bao nhiêu %/năm?`}
              >
                {showCagr ? '✓ Lời/năm' : 'Xem lời/năm'}
              </button>
            </div>

            <div className="lsdca-stats-context">
              Trung bình sau <strong>{committed!.horizonMonths} tháng</strong> đầu tư,
              tính qua <strong>{results.summary.totalScenarios} kịch bản</strong> lịch sử
            </div>

            <div className="lsdca-stats-grid">
              <div className="lsdca-stat-col">
                <div className="lsdca-stat-header lsdca-ls-color">Lump Sum</div>
                <div className="lsdca-stat-row">
                  <span>{showCagr ? 'Lời TB (mỗi năm)' : `Lời TB (${committed!.horizonMonths}th)`}</span>
                  <span>{fmtGrowthOrCagr(results.summary.meanLSGrowth)}</span>
                </div>
                <div className="lsdca-stat-row lsdca-stat-row-secondary">
                  <span>{showCagr ? 'Trung vị (mỗi năm)' : `Trung vị (${committed!.horizonMonths}th)`}</span>
                  <span>{fmtGrowthOrCagr(results.summary.medianLSGrowth)}</span>
                </div>
              </div>

              <div className="lsdca-stat-divider" />

              <div className="lsdca-stat-col">
                <div className="lsdca-stat-header lsdca-dca-color">DCA</div>
                <div className="lsdca-stat-row">
                  <span>{showCagr ? 'Lời TB (mỗi năm)' : `Lời TB (${committed!.horizonMonths}th)`}</span>
                  <span>{fmtGrowthOrCagr(results.summary.meanDCAGrowth)}</span>
                </div>
                <div className="lsdca-stat-row lsdca-stat-row-secondary">
                  <span>{showCagr ? 'Trung vị (mỗi năm)' : `Trung vị (${committed!.horizonMonths}th)`}</span>
                  <span>{fmtGrowthOrCagr(results.summary.medianDCAGrowth)}</span>
                </div>
              </div>

            </div>

            <div className="lsdca-percentiles">
              <span className="lsdca-pct-label">LS vượt DCA bao nhiêu?</span>
              {([
                ['Kịch bản rất xấu', results.summary.p10],
                ['Kịch bản xấu',     results.summary.p25],
                ['Kịch bản thường',  results.summary.medianDiff],
                ['Kịch bản tốt',     results.summary.p75],
                ['Kịch bản rất tốt', results.summary.p90],
              ] as [string, number][]).map(([label, val]) => (
                <span key={label} className="lsdca-pct-item">
                  <span className="lsdca-pct-name">{label}</span>
                  <span className={val >= 0 ? 'lsdca-ls-color' : 'lsdca-dca-color'}>
                    {fmtPct(val)}
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* ── Heatmap ── */}
          <div className="lsdca-chart-card">
            <h4 className="lsdca-chart-title">Xác suất chiến thắng của chiến lược Đầu tư toàn bộ vốn ngay từ đầu</h4>
            <p className="lsdca-chart-sub">
              Ý nghĩa: Con số trong ô là tỷ lệ % các kịch bản lịch sử mà việc giải ngân một lần hiệu quả hơn việc chia nhỏ vốn trong N tháng (tính trên cùng một thời hạn đầu tư).
            </p>

            {renderHeatmapGrid(results.heatmap)}

            {/* Compare fund picker */}
            <div className="lsdca-hm-compare">
              <span className="lsdca-hm-compare-label">So sánh với quỹ khác:</span>
              <Select
                className="lsdca-cash-fund-select"
                classNamePrefix="fund-search"
                options={[{ value: '', label: 'Không so sánh' }, ...fundOptions]}
                value={compareFundId
                  ? (fundOptions.find(o => o.value === compareFundId) ?? null)
                  : { value: '', label: 'Không so sánh' }}
                onChange={opt => setCompareFundId(opt?.value || '')}
                placeholder="Chọn quỹ để so sánh heatmap..."
                noOptionsMessage={() => 'Không tìm thấy'}
                isSearchable
                styles={portfolioSelectStyles}
              />
            </div>

            {results.heatmap2 && results.compareFundName && (
              renderHeatmapGrid(results.heatmap2, results.compareFundName)
            )}

            {/* Legend */}
            <div className="lsdca-hm-legend-chips">
              <span className="lsdca-hm-chip lsdca-hm-chip--weak">
                &lt; 50%: DCA thắng nhiều hơn
              </span>
              <span className="lsdca-hm-chip lsdca-hm-chip--medium">
                50–70%: LS nhỉnh hơn
              </span>
              <span className="lsdca-hm-chip lsdca-hm-chip--strong">
                ≥ 70%: LS vượt trội
              </span>
            </div>

            {/* Explanation toggle */}
            <div className="lsdca-hm-explainer">
              <button
                className="dca-glossary-toggle"
                onClick={() => setShowExplainer(v => !v)}
              >
                Cách đọc bảng này {showExplainer ? '▲' : '▼'}
              </button>
              {showExplainer && (
                <div className="dca-glossary-content">
                  <p>
                    Giả sử bạn có sẵn <strong>100 triệu</strong> và dự định đầu tư trong <strong>2 năm</strong>.
                    Bạn đang cân nhắc giữa hai cách:
                  </p>
                  <ul>
                    <li><strong>Đầu tư một lần:</strong> Bỏ toàn bộ 100 triệu ngay hôm nay, giữ đến hết 2 năm rồi bán.</li>
                    <li><strong>DCA 3 tháng:</strong> Chia ra đầu tư đều mỗi tháng trong 3 tháng đầu (~33 triệu/tháng), sau đó giữ nguyên đến hết 2 năm rồi bán.</li>
                  </ul>
                  <p>
                    Ô <strong>"2 năm / 3 tháng"</strong> cho biết: nhìn lại toàn bộ lịch sử, có <strong>60.4%</strong> số lần mà cách đầu tư một lần mang lại kết quả tốt hơn.
                  </p>
                  <p className="lsdca-hm-explainer-note">
                    💡 Con số càng cao → đầu tư một lần càng có lợi thế. DCA trải càng dài thì vốn ngồi chờ càng lâu, nên lợi thế của đầu tư một lần càng lớn (thể hiện qua màu xanh đậm hơn ở cột bên phải).
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Histogram ── */}
          <div className="lsdca-chart-card">
            <h4 className="lsdca-chart-title">
              LS vượt DCA bao nhiêu? Phân bố kết quả các kịch bản lịch sử
            </h4>
            <p className="lsdca-chart-sub">
              Xanh = Lump Sum thắng &nbsp;|&nbsp; Đỏ = DCA thắng
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={results.histogram}
                margin={{ top: 8, right: 8, left: 0, bottom: 24 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  interval={Math.max(0, Math.floor(results.histogram.length / 12) - 1)}
                  angle={-40}
                  textAnchor="end"
                  height={48}
                />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  formatter={(value: number) => [`${value} kịch bản`, 'Số lần']}
                  labelFormatter={(label: string) => `Chênh lệch: ${label}`}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {results.histogram.map((bucket, i) => (
                    <Cell
                      key={i}
                      fill={bucket.positive ? '#059669' : '#DC2626'}
                      fillOpacity={0.8}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!portfolio && !committed && (
        <div className="chart-empty">
          Bấm "+ Thêm Danh Mục" để bắt đầu phân tích.
        </div>
      )}
    </div>
  )
}

// Memo hoá: App.tsx luôn mount cả 5 tab (ẩn bằng display:none), nên mỗi lần
// chuyển tab hoặc đổi state ở tab khác đều khiến App re-render. Không memo,
// component này (và toàn bộ chart bên trong) sẽ re-render/reconcile lại mỗi
// lần đó dù props không đổi — với dữ liệu daily (nhiều điểm hơn tuần 5-7 lần)
// chi phí này đủ lớn để gây "đơ" khi chuyển tab.
export const LumpSumDCAPanel = memo(LumpSumDCAPanelImpl)
