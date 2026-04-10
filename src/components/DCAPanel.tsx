import { useState, useMemo, useEffect, useRef } from 'react'
import { MoneyInput } from './MoneyInput'
import { ShareButton } from './ShareButton'
import { buildDcaUrl, parseDcaParams } from '../utils/shareUrl'
import type { ReturnPoint, FundMeta, PricePoint } from '../types'
import { simulateDCA, dcaMWRR, dcaProfitFactor, type DCAFrequency, type DCASlot } from '../utils/dca'
import { parseCSV } from '../utils/csvParser'
import { resampleToWeekly, alignFundsToCommonGrid } from '../utils/weeklyResample'
import { PortfolioValueChart } from './PortfolioValueChart'
import { DCAGlossary } from './DCAGlossary'
import {
  PortfolioCard,
  PORTFOLIO_COLORS,
  MAX_PORTFOLIOS,
  MAX_FUNDS_PER_PORTFOLIO,
  type PortfolioCardState,
} from './PortfolioCard'

interface Props {
  funds: FundMeta[]
}

type DCAPortfolioState = PortfolioCardState

type DateRangeMode = 'all' | 'years'

interface DCAPortfolioResult {
  id: string
  name: string
  color: string
  cumulative: ReturnPoint[]
  totalInvested: number
  finalValue: number
  mwrr: number | null
  profitFactor: number | null
  investedSeries: { date: string; value: number }[]
  valueSeries: { date: string; value: number }[]
}

const FREQ_OPTIONS: { value: DCAFrequency; label: string }[] = [
  { value: 'daily', label: 'Hàng ngày' },
  { value: 'weekly', label: '1 tuần' },
  { value: 'biweekly', label: '2 tuần' },
  { value: 'monthly', label: '1 tháng' },
  { value: 'quarterly', label: '1 quý' },
  { value: 'semiannual', label: '6 tháng' },
  { value: 'yearly', label: '1 năm' },
]

export function DCAPanel({ funds }: Props) {
  const nextIdRef = useRef(1)

  // Read URL params once on mount (shared link restore)
  const urlParams = parseDcaParams()

  // ── DCA Parameters ──
  const [dateMode, setDateMode] = useState<DateRangeMode>(urlParams?.dateMode ?? 'all')
  const [yearsBack, setYearsBack] = useState(urlParams?.yearsBack ?? 5)
  const [dateFrom, setDateFrom] = useState<string>(urlParams?.dateFrom ?? '')
  const [dateTo, setDateTo] = useState<string>(urlParams?.dateTo ?? '')
  const [initialAmount, setInitialAmount] = useState(urlParams?.initialAmount ?? 5000000)
  const [cashflowAmount, setCashflowAmount] = useState(urlParams?.cashflowAmount ?? 1000000)
  const [cashflowFreq, setCashflowFreq] = useState<DCAFrequency>(urlParams?.cashflowFreq ?? 'monthly')

  // ── Portfolios ──
  const [portfolios, setPortfolios] = useState<DCAPortfolioState[]>(() => {
    if (urlParams?.portfolios && urlParams.portfolios.length > 0) {
      return urlParams.portfolios.map((p, i) => {
        const id = `dca${nextIdRef.current++}`
        return {
          id,
          name: p.slots[0]?.fundId ?? `Danh mục ${i + 1}`,
          slots: p.slots,
          rebalFreq: p.rebalFreq,
        }
      })
    }
    return []
  })
  const [fundData, setFundData] = useState<Map<string, PricePoint[]>>(new Map())
  const [loading, setLoading] = useState(false)
  // Snapshot at run time
  const [committed, setCommitted] = useState<{
    portfolios: DCAPortfolioState[]
    params: { initialAmount: number; cashflowAmount: number; cashflowFreq: DCAFrequency }
    dateFrom: string
    dateTo: string
  } | null>(null)

  const fundOptions = useMemo(() =>
    funds.map(f => ({ value: f.id, label: f.name_vi })),
    [funds],
  )

  // Collect all needed fund IDs
  const neededIds = useMemo(() => {
    const ids = new Set<string>()
    for (const p of portfolios) {
      for (const s of p.slots) {
        if (s.fundId) ids.add(s.fundId)
      }
    }
    return ids
  }, [portfolios])

  // Fetch CSV data, resample to weekly (end-of-week price)
  // Matches Compare/Simulate tabs so all tabs use the same date grid
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
        const daily = parseCSV(text)
        // Resample to weekly (last trading day of each ISO week)
        // Same as Compare/Simulate tabs — unifies date grid across all tabs
        const weekly = resampleToWeekly(daily)
        return { id, daily: weekly }
      }),
    ).then(results => {
      if (cancelled) return
      setFundData(prev => {
        const next = new Map(prev)
        for (const r of results) {
          if (r) next.set(r.id, r.daily)
        }
        return next
      })
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [neededIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Portfolio CRUD ──

  function addPortfolio() {
    if (portfolios.length >= MAX_PORTFOLIOS) return
    const num = nextIdRef.current++
    const defaultFundId = funds[0]?.id || ''
    const portfolio: DCAPortfolioState = {
      id: `dca${num}`,
      name: defaultFundId || `Danh mục ${num}`,
      slots: [{ fundId: defaultFundId, weight: 100 }],
      rebalFreq: 'quarterly',
    }
    setPortfolios([...portfolios, portfolio])
  }

  function removePortfolio(id: string) {
    setPortfolios(portfolios.filter(p => p.id !== id))
  }

  function updatePortfolio(id: string, update: Partial<DCAPortfolioState>) {
    setPortfolios(portfolios.map(p => p.id === id ? { ...p, ...update } : p))
  }

  function addSlot(portfolioId: string) {
    setPortfolios(portfolios.map(p => {
      if (p.id !== portfolioId || p.slots.length >= MAX_FUNDS_PER_PORTFOLIO) return p
      const used = new Set(p.slots.map(s => s.fundId))
      const available = funds.find(f => !used.has(f.id))
      return { ...p, slots: [...p.slots, { fundId: available?.id || '', weight: 0 }] }
    }))
  }

  function removeSlot(portfolioId: string, index: number) {
    setPortfolios(portfolios.map(p => {
      if (p.id !== portfolioId || p.slots.length <= 1) return p
      const newSlots = p.slots.filter((_, i) => i !== index)
      const name = newSlots.length === 1 && newSlots[0]!.fundId ? newSlots[0]!.fundId : p.name
      return { ...p, name, slots: newSlots }
    }))
  }

  function updateSlot(portfolioId: string, index: number, update: Partial<DCASlot>) {
    setPortfolios(portfolios.map(p => {
      if (p.id !== portfolioId) return p
      const newSlots = p.slots.map((s, i) => i === index ? { ...s, ...update } : s)
      const name = newSlots.length === 1 && update.fundId ? update.fundId : p.name
      return { ...p, name, slots: newSlots }
    }))
  }

  function setEqualWeights(portfolioId: string) {
    setPortfolios(portfolios.map(p => {
      if (p.id !== portfolioId || p.slots.length === 0) return p
      const n = p.slots.length
      const w = Math.floor(100 / n)
      const remainder = 100 - w * n
      return {
        ...p,
        slots: p.slots.map((s, i) => ({ ...s, weight: w + (i < remainder ? 1 : 0) })),
      }
    }))
  }

  // ── Compute effective date range ──
  function getEffectiveDates(): { from: string; to: string } {
    if (dateMode === 'years') {
      const now = new Date()
      const from = new Date(now.getFullYear() - yearsBack, now.getMonth(), now.getDate())
      return {
        from: from.toISOString().substring(0, 10),
        to: now.toISOString().substring(0, 10),
      }
    }
    return { from: dateFrom, to: dateTo }
  }

  // ── Run simulation ──
  function runSimulation() {
    const allValid = portfolios.every(p => {
      const total = p.slots.reduce((s, f) => s + f.weight, 0)
      return Math.abs(total - 100) < 0.01
    })
    if (!allValid) return

    const { from, to } = getEffectiveDates()

    setCommitted({
      portfolios: portfolios.map(p => ({ ...p, slots: [...p.slots] })),
      params: { initialAmount, cashflowAmount, cashflowFreq },
      dateFrom: from,
      dateTo: to,
    })
  }

  const canRun = portfolios.length > 0 && portfolios.every(p => {
    const total = p.slots.reduce((s, f) => s + f.weight, 0)
    return Math.abs(total - 100) < 0.01 && p.slots.every(s => s.fundId)
  }) && (initialAmount > 0 || cashflowAmount > 0)

  // ── Compute results ──
  const results = useMemo<DCAPortfolioResult[] | null>(() => {
    if (!committed || committed.portfolios.length === 0) return null

    // ── Step 1: Find the GLOBAL common start/end date across ALL portfolios ──
    // This ensures fair comparison — all portfolios start DCA on the same date
    let globalStart = committed.dateFrom || ''
    let globalEnd = committed.dateTo || '9999-12-31'

    // Collect all unique fund IDs across all portfolios
    const allFundIds = new Set<string>()
    for (const p of committed.portfolios) {
      for (const s of p.slots) {
        if (s.fundId) allFundIds.add(s.fundId)
      }
    }

    // Check all data is loaded & find date boundaries
    for (const fundId of allFundIds) {
      const prices = fundData.get(fundId)
      if (!prices || prices.length === 0) return null // data not loaded yet
      const fundStart = prices[0]!.date
      const fundEnd = prices[prices.length - 1]!.date
      // Global start = latest start among all funds (so all have data)
      if (fundStart > globalStart) globalStart = fundStart
      // Global end = earliest end among all funds
      if (fundEnd < globalEnd) globalEnd = fundEnd
    }

    if (globalStart >= globalEnd) return null

    // Apply user date filters on top
    if (committed.dateFrom && committed.dateFrom > globalStart) globalStart = committed.dateFrom
    if (committed.dateTo && committed.dateTo < globalEnd) globalEnd = committed.dateTo

    // ── Step 2: Collect & align ALL fund prices to a common weekly grid ──
    // Different funds may have different "last trading days" within the same
    // ISO week. Aligning ensures all portfolios share the same date points
    // so chart lines overlap correctly.
    const allFilteredPrices = new Map<string, PricePoint[]>()
    for (const fundId of allFundIds) {
      const prices = fundData.get(fundId)
      if (!prices) return null
      allFilteredPrices.set(fundId, prices.filter(pt => pt.date >= globalStart && pt.date <= globalEnd))
    }
    const alignedPrices = alignFundsToCommonGrid(allFilteredPrices)

    // ── Step 3: Run DCA for each portfolio with aligned dates ──
    const portfolioResults: DCAPortfolioResult[] = []

    for (let pIdx = 0; pIdx < committed.portfolios.length; pIdx++) {
      const p = committed.portfolios[pIdx]!
      const color = PORTFOLIO_COLORS[pIdx % PORTFOLIO_COLORS.length]!

      // Pick this portfolio's fund prices from the aligned grid
      const filteredPrices = new Map<string, PricePoint[]>()
      for (const slot of p.slots) {
        const prices = alignedPrices.get(slot.fundId)
        if (!prices) return null
        filteredPrices.set(slot.fundId, prices)
      }

      const dcaResult = simulateDCA(
        filteredPrices,
        p.slots,
        committed.params,
        p.rebalFreq,
      )

      if (dcaResult.cumulative.length === 0) {
        portfolioResults.push({
          id: p.id, name: p.name, color,
          cumulative: [],
          totalInvested: 0, finalValue: 0, mwrr: null, profitFactor: null,
          investedSeries: [], valueSeries: [],
        })
        continue
      }

      portfolioResults.push({
        id: p.id, name: p.name, color,
        cumulative: dcaResult.cumulative,
        totalInvested: dcaResult.totalInvested,
        finalValue: dcaResult.finalValue,
        mwrr: dcaMWRR(dcaResult.cashflows),
        profitFactor: dcaProfitFactor(dcaResult.returns),
        investedSeries: dcaResult.invested,
        valueSeries: dcaResult.values,
      })
    }

    return portfolioResults
  }, [committed, fundData])

  const validResults = results?.filter(r => r.cumulative.length > 0) ?? []

  const startDate = validResults.length > 0
    ? validResults[0]!.cumulative[0]?.date : undefined
  const endDate = validResults.length > 0
    ? validResults[0]!.cumulative[validResults[0]!.cumulative.length - 1]?.date : undefined

  // ── Format helpers ──
  function formatVND(n: number): string {
    return n.toLocaleString('vi-VN') + ' ₫'
  }

  function formatDate(dateStr: string): string {
    const [y, m, d] = dateStr.split('-')
    return `${d}/${m}/${y}`
  }

  // ── Render ──
  return (
    <div className="simulation-panel dca-panel">
      <div className="panel-header">
        <h2>Tích Lũy Định Kỳ (DCA)</h2>
        <ShareButton getUrl={() => buildDcaUrl({
          initialAmount, cashflowAmount, cashflowFreq,
          dateMode, yearsBack, dateFrom, dateTo,
          portfolios: portfolios.map(p => ({ slots: p.slots, rebalFreq: p.rebalFreq })),
        })} />
      </div>

      {/* ── Parameters Section ── */}
      <div className="dca-params-card">
        <h3 className="dca-section-title">Thông số</h3>

        {/* Date Range Mode */}
        <div className="dca-param-row">
          <label className="dca-label">Khoảng thời gian</label>
          <div className="dca-date-mode">
            <button
              className={`dca-mode-btn ${dateMode === 'all' ? 'dca-mode-btn-active' : ''}`}
              onClick={() => setDateMode('all')}
            >
              Tất cả
            </button>
            <button
              className={`dca-mode-btn ${dateMode === 'years' ? 'dca-mode-btn-active' : ''}`}
              onClick={() => setDateMode('years')}
            >
              X năm qua
            </button>
          </div>
        </div>

        {/* Years selector (only when mode = years) */}
        {dateMode === 'years' && (
          <div className="dca-param-row dca-years-row">
            <label className="dca-label">Số năm</label>
            <div className="dca-years-selector">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <button
                  key={n}
                  className={`dca-year-btn ${yearsBack === n ? 'dca-year-btn-active' : ''}`}
                  onClick={() => setYearsBack(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom date range (only when mode = all) */}
        {dateMode === 'all' && (
          <div className="dca-param-row">
            <label className="dca-label">Từ ngày — Đến ngày</label>
            <div className="dca-date-inputs">
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
              />
              <span className="dca-date-sep">—</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Initial Amount */}
        <div className="dca-param-row">
          <label className="dca-label">Số tiền đầu tiên</label>
          <div className="dca-amount-input">
            <MoneyInput value={initialAmount} onChange={setInitialAmount} min={0} />
            <span className="dca-currency">₫</span>
          </div>
        </div>

        {/* Cashflow Amount */}
        <div className="dca-param-row">
          <label className="dca-label">Số tiền đầu tư định kỳ</label>
          <div className="dca-amount-input">
            <MoneyInput value={cashflowAmount} onChange={setCashflowAmount} min={0} />
            <span className="dca-currency">₫</span>
          </div>
        </div>

        {/* Cashflow Frequency */}
        <div className="dca-param-row">
          <label className="dca-label">Tần suất đầu tư</label>
          <select
            className="dca-freq-select"
            value={cashflowFreq}
            onChange={e => setCashflowFreq(e.target.value as DCAFrequency)}
          >
            {FREQ_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <p className="dca-note">
          * Thời gian đầu, các quỹ cập nhật thông tin giá vào các ngày khác nhau. Trong trường hợp này, hệ thống sẽ tự chọn giá vào ngày giao dịch cuối cùng trong tuần.
        </p>
      </div>

      {/* ── Portfolio Cards ── */}
      {portfolios.map((portfolio, pIdx) => (
        <PortfolioCard
          key={portfolio.id}
          portfolio={portfolio}
          pIdx={pIdx}
          funds={funds}
          fundOptions={fundOptions}
          onUpdate={update => updatePortfolio(portfolio.id, update)}
          onRemove={() => removePortfolio(portfolio.id)}
          onAddSlot={() => addSlot(portfolio.id)}
          onRemoveSlot={idx => removeSlot(portfolio.id, idx)}
          onUpdateSlot={(idx, update) => updateSlot(portfolio.id, idx, update)}
          onSetEqualWeights={() => setEqualWeights(portfolio.id)}
        />
      ))}

      {/* Add portfolio button */}
      {portfolios.length < MAX_PORTFOLIOS && (
        <button className="sim-add-portfolio-btn" onClick={addPortfolio}>
          + Thêm Danh Mục
        </button>
      )}

      {/* Run button */}
      {portfolios.length > 0 && (
        <button
          className="sim-run-btn"
          onClick={runSimulation}
          disabled={!canRun}
        >
          Chạy DCA
        </button>
      )}

      {loading && <div className="loading-indicator">Đang tải dữ liệu...</div>}

      {/* Error when no results */}
      {committed && committed.portfolios.length > 0 && validResults.length === 0 && !loading && (
        <div className="error-banner">
          Không đủ dữ liệu để tính toán. Hãy chọn khoảng thời gian dài hơn hoặc chọn "Tất cả".
        </div>
      )}

      {/* ── Results ── */}
      {validResults.length > 0 && (
        <>
          {/* Period info */}
          {startDate && endDate && (
            <div className="comparison-period" style={{ marginBottom: 16 }}>
              DCA từ {formatDate(startDate)} đến {formatDate(endDate)}
            </div>
          )}

          {/* DCA Summary Cards */}
          <div className="dca-summary-grid">
            {validResults.map(r => {
              // CAGR of investor: (finalValue / totalInvested)^(1/years) - 1
              // Uses actual calendar years from first to last DCA date
              const msPerYear = 365.25 * 24 * 60 * 60 * 1000
              const dcaYears = r.cumulative.length >= 2
                ? (new Date(r.cumulative[r.cumulative.length - 1]!.date).getTime() -
                   new Date(r.cumulative[0]!.date).getTime()) / msPerYear
                : null
              const investorCagr = (dcaYears && dcaYears > 0 && r.totalInvested > 0 && r.finalValue > 0)
                ? Math.pow(r.finalValue / r.totalInvested, 1 / dcaYears) - 1
                : null

              return (
                <div key={r.id} className="dca-summary-card" style={{ borderLeftColor: r.color }}>
                  <div className="dca-summary-name">{r.name}</div>
                  <div className="dca-summary-row">
                    <span>Giá trị cuối kỳ
                      <span className="dca-info-icon" title="Ending Value — giá trị danh mục tại thời điểm cuối kỳ backtest.">?</span>
                    </span>
                    <span className="dca-summary-value">{formatVND(Math.round(r.finalValue))}</span>
                  </div>
                  <div className="dca-summary-row">
                    <span>Tổng đầu tư
                      <span className="dca-info-icon" title="Total Contributions — tổng số tiền đã nạp vào danh mục (vốn ban đầu + tất cả các lần DCA).">?</span>
                    </span>
                    <span className="dca-summary-value">{formatVND(r.totalInvested)}</span>
                  </div>
                  <div className="dca-summary-separator" />
                  <div className="dca-summary-row">
                    <span>Lợi nhuận tích lũy
                      <span className="dca-info-icon" title="Lợi nhuận tích lũy trong kỳ backtest (giá trị cuối kỳ ÷ tổng đầu tư − 1).">?</span>
                    </span>
                    <span className={`dca-summary-value ${r.finalValue >= r.totalInvested ? 'dca-profit' : 'dca-loss'}`}>
                      {r.totalInvested > 0
                        ? ((r.finalValue / r.totalInvested - 1) * 100).toFixed(2) + '%'
                        : '—'}
                    </span>
                  </div>
                  <div className="dca-summary-row">
                    <span>CAGR
                      <span className="dca-info-icon" title="Lợi nhuận tích lũy quy năm: (Giá trị cuối ÷ Tổng đầu tư)^(1/số năm) − 1. Cho biết nếu danh mục tăng đều mỗi năm thì mỗi năm lãi bao nhiêu %. Lưu ý: chỉ số này thường thấp hơn MWRR trong DCA vì giả định toàn bộ vốn đã hoạt động từ đầu.">?</span>
                    </span>
                    <span className={`dca-summary-value ${(investorCagr ?? 0) >= 0 ? 'dca-profit' : 'dca-loss'}`}>
                      {investorCagr !== null ? (investorCagr * 100).toFixed(2) + '%' : '—'}
                    </span>
                  </div>
                  <div className="dca-summary-row">
                    <span>MWRR
                      <span className="dca-info-icon" title="Money-Weighted Rate of Return — lợi nhuận thực tế của nhà đầu tư, tính đến thời điểm và số tiền từng lần nạp (IRR). Chỉ số chính để đánh giá hiệu quả chiến lược DCA. Thường cao hơn CAGR vì nhận ra rằng phần lớn vốn DCA chỉ hoạt động trong thời gian ngắn hơn toàn kỳ.">?</span>
                    </span>
                    <span className={`dca-summary-value ${(r.mwrr ?? 0) >= 0 ? 'dca-profit' : 'dca-loss'}`}>
                      {r.mwrr !== null ? (r.mwrr * 100).toFixed(2) + '%' : '—'}
                    </span>
                  </div>
                  <div className="dca-summary-row">
                    <span>Profit Factor
                      <span className="dca-info-icon" title="Tổng lợi nhuận các tuần tăng ÷ tổng lỗ các tuần giảm. Lớn hơn 1 = tổng lời nhiều hơn tổng lỗ. Ví dụ: 1.5× nghĩa là cứ 1 đồng lỗ thì lời được 1.5 đồng.">?</span>
                    </span>
                    <span className={`dca-summary-value ${(r.profitFactor ?? 0) >= 1 ? 'dca-profit' : 'dca-loss'}`}>
                      {r.profitFactor !== null ? r.profitFactor.toFixed(2) + '×' : '—'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Portfolio Value Chart (MWRR) */}
          <PortfolioValueChart
            portfolios={validResults.map(r => ({
              name: r.name,
              color: r.color,
              values: r.valueSeries,
              invested: r.investedSeries,
            }))}
          />

        </>
      )}

      {portfolios.length === 0 && (
        <div className="chart-empty">
          Bấm "Thêm Danh Mục" để bắt đầu mô phỏng DCA.
        </div>
      )}

      {/* Giải Thích Khái Niệm */}
      <DCAGlossary />
    </div>
  )
}

