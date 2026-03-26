import { useState, useMemo, useEffect, useRef } from 'react'
import Select from 'react-select'
import type {
  ReturnPoint, RebalanceFrequency, FundMeta, PricePoint,
  ChartSeries, KPIData, YearlyReturn,
} from '../types'
import { simulateDCA, type DCAFrequency, type DCASlot } from '../utils/dca'
import {
  cagr, maxDrawdown,
  drawdownSeries, yearlyReturns, rollingReturns, rollingAverage,
  winRateAmong,
} from '../utils/calculations'
import { parseCSV } from '../utils/csvParser'
import { KPICards } from './KPICards'
import { CumulativeReturnChart } from './CumulativeReturnChart'
import { DrawdownChart } from './DrawdownChart'
import { YearlyPerformanceChart } from './YearlyPerformanceChart'
import { RollingReturnChart } from './RollingReturnChart'

interface Props {
  funds: FundMeta[]
}

interface DCAPortfolioState {
  id: string
  name: string
  slots: DCASlot[]
  rebalFreq: RebalanceFrequency
}

type DateRangeMode = 'all' | 'years'

interface DCAPortfolioResult {
  id: string
  name: string
  color: string
  cumulative: ReturnPoint[]
  drawdown: ReturnPoint[]
  yearly: YearlyReturn[]
  rolling: ReturnPoint[]
  kpi: KPIData
  totalInvested: number
  finalValue: number
  investedSeries: { date: string; value: number }[]
  valueSeries: { date: string; value: number }[]
}

const PORTFOLIO_COLORS = ['#059669', '#2563EB', '#DC2626', '#F59E0B', '#8B5CF6']
const MAX_PORTFOLIOS = 5
const MAX_FUNDS_PER_PORTFOLIO = 10

const REBAL_OPTIONS: { value: RebalanceFrequency; label: string }[] = [
  { value: 'monthly', label: 'Hàng tháng' },
  { value: 'quarterly', label: 'Hàng quý' },
  { value: 'yearly', label: 'Hàng năm' },
]

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

  // ── DCA Parameters ──
  const [dateMode, setDateMode] = useState<DateRangeMode>('all')
  const [yearsBack, setYearsBack] = useState(5)
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [initialAmount, setInitialAmount] = useState(5000000)
  const [cashflowAmount, setCashflowAmount] = useState(1000000)
  const [cashflowFreq, setCashflowFreq] = useState<DCAFrequency>('monthly')

  // ── Portfolios ──
  const [portfolios, setPortfolios] = useState<DCAPortfolioState[]>([])
  const [fundData, setFundData] = useState<Map<string, PricePoint[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const [rollingPeriod, setRollingPeriod] = useState(12)

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

  // Fetch DAILY CSV data (not weekly — DCA needs daily precision)
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
        return { id, daily }
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
    const portfolio: DCAPortfolioState = {
      id: `dca${num}`,
      name: `Danh mục ${num}`,
      slots: [{ fundId: funds[0]?.id || '', weight: 100 }],
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
      return { ...p, slots: p.slots.filter((_, i) => i !== index) }
    }))
  }

  function updateSlot(portfolioId: string, index: number, update: Partial<DCASlot>) {
    setPortfolios(portfolios.map(p => {
      if (p.id !== portfolioId) return p
      return { ...p, slots: p.slots.map((s, i) => i === index ? { ...s, ...update } : s) }
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

    // ── Step 2: Run DCA for each portfolio with aligned dates ──
    const portfolioResults: DCAPortfolioResult[] = []

    for (let pIdx = 0; pIdx < committed.portfolios.length; pIdx++) {
      const p = committed.portfolios[pIdx]!
      const color = PORTFOLIO_COLORS[pIdx % PORTFOLIO_COLORS.length]!

      // Filter daily prices to the GLOBAL common range
      const filteredPrices = new Map<string, PricePoint[]>()
      for (const slot of p.slots) {
        const prices = fundData.get(slot.fundId)
        if (!prices) return null
        const filtered = prices.filter(pt => pt.date >= globalStart && pt.date <= globalEnd)
        filteredPrices.set(slot.fundId, filtered)
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
          cumulative: [], drawdown: [], yearly: [], rolling: [],
          kpi: { cagr: null, maxDrawdown: null, rollingAvg12M: null, winRate: null },
          totalInvested: 0, finalValue: 0,
          investedSeries: [], valueSeries: [],
        })
        continue
      }

      const dd = drawdownSeries(dcaResult.returns)
      const yr = yearlyReturns(dcaResult.returns)
      const roll = rollingReturns(dcaResult.returns, rollingPeriod)

      portfolioResults.push({
        id: p.id, name: p.name, color,
        cumulative: dcaResult.cumulative,
        drawdown: dd,
        yearly: yr,
        rolling: roll,
        kpi: {
          cagr: cagr(dcaResult.returns),
          maxDrawdown: maxDrawdown(dcaResult.returns),
          rollingAvg12M: rollingAverage(rollingReturns(dcaResult.returns, 12)),
          winRate: null,
        },
        totalInvested: dcaResult.totalInvested,
        finalValue: dcaResult.finalValue,
        investedSeries: dcaResult.invested,
        valueSeries: dcaResult.values,
      })
    }

    // Compute win rates
    const allYearly = portfolioResults.map(r => r.yearly)
    for (let i = 0; i < portfolioResults.length; i++) {
      if (portfolioResults[i]!.cumulative.length > 0) {
        portfolioResults[i]!.kpi.winRate = winRateAmong(allYearly, i)
      }
    }

    return portfolioResults
  }, [committed, fundData, rollingPeriod])

  // ── Build chart series ──
  const validResults = results?.filter(r => r.cumulative.length > 0) ?? []

  const cumulativeSeries: ChartSeries[] = validResults.map(r => ({
    name: r.name, color: r.color, data: r.cumulative,
  }))

  const ddSeries: ChartSeries[] = validResults.map(r => ({
    name: r.name, color: r.color, data: r.drawdown,
  }))

  const rollSeries: ChartSeries[] = validResults.map(r => ({
    name: r.name, color: r.color, data: r.rolling,
  }))

  const yearlySeries = validResults.map(r => ({
    name: r.name, color: r.color, data: r.yearly,
  }))

  const kpiFunds = validResults.map(r => ({
    name: r.name, color: r.color, kpi: r.kpi,
  }))

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
      <h2>Tích Lũy Định Kỳ (DCA)</h2>

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
            <input
              type="number"
              min={0}
              step={1000000}
              value={initialAmount}
              onChange={e => setInitialAmount(Math.max(0, Number(e.target.value)))}
            />
            <span className="dca-currency">₫</span>
          </div>
        </div>

        {/* Cashflow Amount */}
        <div className="dca-param-row">
          <label className="dca-label">Số tiền đầu tư định kỳ</label>
          <div className="dca-amount-input">
            <input
              type="number"
              min={0}
              step={500000}
              value={cashflowAmount}
              onChange={e => setCashflowAmount(Math.max(0, Number(e.target.value)))}
            />
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
      </div>

      {/* ── Portfolio Cards ── */}
      {portfolios.map((portfolio, pIdx) => {
        const totalWeight = portfolio.slots.reduce((s, f) => s + f.weight, 0)
        const isOverUnder = Math.abs(totalWeight - 100) > 0.01

        return (
          <div key={portfolio.id} className="portfolio-card">
            <div className="portfolio-card-header">
              <span
                className="portfolio-color-dot"
                style={{ background: PORTFOLIO_COLORS[pIdx % PORTFOLIO_COLORS.length] }}
              />
              <input
                className="portfolio-name-input"
                value={portfolio.name}
                onChange={e => updatePortfolio(portfolio.id, { name: e.target.value })}
              />
              <div className="portfolio-rebal">
                <label>Rebalance</label>
                <select
                  value={portfolio.rebalFreq}
                  onChange={e => updatePortfolio(portfolio.id, { rebalFreq: e.target.value as RebalanceFrequency })}
                >
                  {REBAL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="portfolio-actions">
              <button
                className="portfolio-add-btn"
                onClick={() => addSlot(portfolio.id)}
                disabled={portfolio.slots.length >= MAX_FUNDS_PER_PORTFOLIO}
                title="Thêm quỹ"
              >
                +
              </button>
              <button
                className="portfolio-delete-btn"
                onClick={() => removePortfolio(portfolio.id)}
                title="Xoá danh mục"
              >
                ✕
              </button>
              <button
                className="portfolio-set-btn"
                onClick={() => setEqualWeights(portfolio.id)}
                title="Chia đều tỷ trọng"
              >
                SET
              </button>
            </div>

            <div className="portfolio-slots">
              {portfolio.slots.map((slot, idx) => (
                <div key={idx} className="portfolio-slot-row">
                  <Select
                    className="portfolio-fund-select"
                    classNamePrefix="fund-search"
                    options={fundOptions}
                    value={fundOptions.find(o => o.value === slot.fundId) || null}
                    onChange={opt => updateSlot(portfolio.id, idx, { fundId: opt?.value || '' })}
                    placeholder="Tìm quỹ..."
                    noOptionsMessage={() => 'Không tìm thấy'}
                    isSearchable
                    styles={dcaSelectStyles}
                  />
                  <div className="portfolio-weight-input">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={slot.weight}
                      onChange={e => updateSlot(portfolio.id, idx, {
                        weight: Math.max(0, Math.min(100, Number(e.target.value))),
                      })}
                    />
                    <span>%</span>
                  </div>
                  <button
                    className="portfolio-remove-slot-btn"
                    onClick={() => removeSlot(portfolio.id, idx)}
                    disabled={portfolio.slots.length <= 1}
                    title="Xoá"
                  >
                    −
                  </button>
                </div>
              ))}
            </div>

            <div className={`portfolio-total ${isOverUnder ? 'portfolio-total-warn' : ''}`}>
              <span>Total</span>
              <span className="portfolio-total-value">{totalWeight}</span>
              <span>%</span>
            </div>
          </div>
        )
      })}

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
            {validResults.map(r => (
              <div key={r.id} className="dca-summary-card" style={{ borderLeftColor: r.color }}>
                <div className="dca-summary-name">{r.name}</div>
                <div className="dca-summary-row">
                  <span>Tổng đầu tư</span>
                  <span className="dca-summary-value">{formatVND(r.totalInvested)}</span>
                </div>
                <div className="dca-summary-row">
                  <span>Giá trị hiện tại</span>
                  <span className="dca-summary-value">{formatVND(Math.round(r.finalValue))}</span>
                </div>
                <div className="dca-summary-row">
                  <span>Lợi nhuận</span>
                  <span className={`dca-summary-value ${r.finalValue >= r.totalInvested ? 'dca-profit' : 'dca-loss'}`}>
                    {r.totalInvested > 0
                      ? ((r.finalValue / r.totalInvested - 1) * 100).toFixed(2) + '%'
                      : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* KPI Cards */}
          <KPICards funds={kpiFunds} />

          {/* Charts */}
          <CumulativeReturnChart series={cumulativeSeries} />
          <DrawdownChart series={ddSeries} />
          <YearlyPerformanceChart series={yearlySeries} />
          <RollingReturnChart
            series={rollSeries}
            period={rollingPeriod}
            onPeriodChange={setRollingPeriod}
          />
        </>
      )}

      {portfolios.length === 0 && (
        <div className="chart-empty">
          Bấm "Thêm Danh Mục" để bắt đầu mô phỏng DCA.
        </div>
      )}
    </div>
  )
}

const dcaSelectStyles = {
  control: (base: Record<string, unknown>) => ({
    ...base,
    minHeight: 36,
    borderColor: '#e5e7eb',
    boxShadow: 'none',
    '&:hover': { borderColor: '#2563EB' },
    fontSize: '0.9rem',
  }),
  menu: (base: Record<string, unknown>) => ({
    ...base,
    zIndex: 20,
  }),
  option: (base: Record<string, unknown>, state: { isFocused: boolean; isSelected: boolean }) => ({
    ...base,
    fontSize: '0.85rem',
    backgroundColor: state.isSelected ? '#059669' : state.isFocused ? '#ecfdf5' : undefined,
    color: state.isSelected ? 'white' : '#1a1a1a',
  }),
}
