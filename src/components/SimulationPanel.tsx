import { useState, useMemo, useEffect, useRef } from 'react'
import Select from 'react-select'
import type {
  ReturnPoint, RebalanceFrequency, FundMeta, WeeklyPrice,
  ChartSeries, KPIData, YearlyReturn,
} from '../types'
import { simulateMultiFundPortfolio } from '../utils/portfolio'
import { alignMultiSeries } from '../utils/dateAlign'
import {
  cumulativeReturns, cagr, maxDrawdown, weeklyReturns,
  drawdownSeries, yearlyReturns, rollingReturns, rollingAverage,
  winRateAmong,
} from '../utils/calculations'
import { parseCSV } from '../utils/csvParser'
import { resampleToWeekly } from '../utils/weeklyResample'
import { DateRangePicker } from './DateRangePicker'
import { KPICards } from './KPICards'
import { CumulativeReturnChart } from './CumulativeReturnChart'
import { DrawdownChart } from './DrawdownChart'
import { YearlyPerformanceChart } from './YearlyPerformanceChart'
import { RollingReturnChart } from './RollingReturnChart'

interface Props {
  funds: FundMeta[]
}

interface FundSlot {
  fundId: string
  weight: number
}

interface Portfolio {
  id: string
  name: string
  slots: FundSlot[]
  rebalFreq: RebalanceFrequency
}

interface PortfolioResult {
  id: string
  name: string
  color: string
  returns: ReturnPoint[]
  cumulative: ReturnPoint[]
  drawdown: ReturnPoint[]
  yearly: YearlyReturn[]
  rolling: ReturnPoint[]
  kpi: KPIData
}

const PORTFOLIO_COLORS = ['#059669', '#2563EB', '#DC2626', '#F59E0B', '#8B5CF6']
const MAX_PORTFOLIOS = 5
const MAX_FUNDS_PER_PORTFOLIO = 10
const REBAL_OPTIONS: { value: RebalanceFrequency; label: string }[] = [
  { value: 'monthly', label: 'Hàng tháng' },
  { value: 'quarterly', label: 'Hàng quý' },
  { value: 'yearly', label: 'Hàng năm' },
]

export function SimulationPanel({ funds }: Props) {
  const nextIdRef = useRef(1)
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [fundData, setFundData] = useState<Map<string, WeeklyPrice[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const [dateFrom, setDateFrom] = useState<string | null>(null)
  const [dateTo, setDateTo] = useState<string | null>(null)
  const [rollingPeriod, setRollingPeriod] = useState(12)
  // Snapshot of portfolios at the time user clicks "Run" — only this triggers computation
  const [committedPortfolios, setCommittedPortfolios] = useState<Portfolio[]>([])

  const fundOptions = useMemo(() =>
    funds.map(f => ({ value: f.id, label: f.name_vi })),
    [funds],
  )

  // Collect all needed fund IDs across all portfolios
  const neededIds = useMemo(() => {
    const ids = new Set<string>()
    for (const p of portfolios) {
      for (const s of p.slots) {
        if (s.fundId) ids.add(s.fundId)
      }
    }
    return ids
  }, [portfolios])

  // Fetch CSV data on demand
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
        const weekly = resampleToWeekly(daily)
        return { id, weekly }
      }),
    ).then(results => {
      if (cancelled) return
      setFundData(prev => {
        const next = new Map(prev)
        for (const r of results) {
          if (r) next.set(r.id, r.weekly)
        }
        return next
      })
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [neededIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Portfolio CRUD ──────────────────────────────

  function addPortfolio() {
    if (portfolios.length >= MAX_PORTFOLIOS) return
    const num = nextIdRef.current++
    const defaultFundId = funds[0]?.id || ''
    const portfolio: Portfolio = {
      id: `p${num}`,
      name: defaultFundId || `Danh mục ${num}`,
      slots: [{ fundId: defaultFundId, weight: 100 }],
      rebalFreq: 'quarterly',
    }
    setPortfolios([...portfolios, portfolio])
  }

  function removePortfolio(id: string) {
    setPortfolios(portfolios.filter(p => p.id !== id))
  }

  function updatePortfolio(id: string, update: Partial<Portfolio>) {
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

  function updateSlot(portfolioId: string, index: number, update: Partial<FundSlot>) {
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

  // ── Run simulation ─────────────────────────────

  function runSimulation() {
    // Validate: all portfolios must have total weight = 100%
    const allValid = portfolios.every(p => {
      const total = p.slots.reduce((s, f) => s + f.weight, 0)
      return Math.abs(total - 100) < 0.01
    })
    if (!allValid) return
    setCommittedPortfolios(portfolios.map(p => ({ ...p, slots: [...p.slots] })))
  }

  // Check if run button should be enabled
  const canRun = portfolios.length > 0 && portfolios.every(p => {
    const total = p.slots.reduce((s, f) => s + f.weight, 0)
    return Math.abs(total - 100) < 0.01 && p.slots.every(s => s.fundId)
  })

  // ── Compute full results for committed portfolios ──────

  const results = useMemo<PortfolioResult[] | null>(() => {
    if (committedPortfolios.length === 0) return null

    // Gather all unique fund IDs
    const allFundIds: string[] = []
    const idSet = new Set<string>()
    for (const p of committedPortfolios) {
      for (const s of p.slots) {
        if (s.fundId && !idSet.has(s.fundId)) {
          idSet.add(s.fundId)
          allFundIds.push(s.fundId)
        }
      }
    }

    // Check all data loaded, apply date filter
    const allWeekly: WeeklyPrice[][] = []
    for (const id of allFundIds) {
      const series = fundData.get(id)
      if (!series) return null
      allWeekly.push(filterDateRange(series, dateFrom, dateTo))
    }
    if (allWeekly.length === 0) return null

    try {
      // Align ALL series to common date range
      const aligned = alignMultiSeries(allWeekly)
      const startDate = aligned.dates[0]
      const allReturns = aligned.prices.map(prices =>
        weeklyReturns(aligned.dates, prices),
      )
      const minLen = Math.min(...allReturns.map(r => r.length))
      const trimmed = allReturns.map(r => r.slice(r.length - minLen))

      // Simulate each portfolio and compute full metrics
      const portfolioReturns: ReturnPoint[][] = []
      const portfolioResults: PortfolioResult[] = []

      for (let pIdx = 0; pIdx < committedPortfolios.length; pIdx++) {
        const p = committedPortfolios[pIdx]!
        const color = PORTFOLIO_COLORS[pIdx % PORTFOLIO_COLORS.length]!
        const validSlots = p.slots.filter(s => s.fundId && s.weight > 0)

        if (validSlots.length === 0) {
          portfolioReturns.push([])
          portfolioResults.push({
            id: p.id, name: p.name, color,
            returns: [], cumulative: [], drawdown: [], yearly: [], rolling: [],
            kpi: { cagr: null, maxDrawdown: null, rollingAvg12M: null, winRate: null },
          })
          continue
        }

        const totalWeight = validSlots.reduce((sum, s) => sum + s.weight, 0)
        const indices = validSlots.map(s => allFundIds.indexOf(s.fundId)).filter(i => i >= 0)
        const returns = indices.map(i => trimmed[i]!)
        const weights = validSlots.map(s => s.weight / totalWeight)

        const simReturns = simulateMultiFundPortfolio(returns, weights, p.rebalFreq)
        portfolioReturns.push(simReturns)

        const cum = cumulativeReturns(simReturns, startDate)
        const dd = drawdownSeries(simReturns, startDate)
        const yr = yearlyReturns(simReturns)
        const roll = rollingReturns(simReturns, rollingPeriod)

        portfolioResults.push({
          id: p.id, name: p.name, color,
          returns: simReturns,
          cumulative: cum,
          drawdown: dd,
          yearly: yr,
          rolling: roll,
          kpi: {
            cagr: cagr(simReturns),
            maxDrawdown: maxDrawdown(simReturns),
            rollingAvg12M: rollingAverage(rollingReturns(simReturns, 12)),
            winRate: null, // computed below
          },
        })
      }

      // Compute win rates among portfolios
      const allYearly = portfolioResults.map(r => r.yearly)
      for (let i = 0; i < portfolioResults.length; i++) {
        if (portfolioResults[i]!.returns.length > 0) {
          portfolioResults[i]!.kpi.winRate = winRateAmong(allYearly, i)
        }
      }

      return portfolioResults
    } catch {
      return null
    }
  }, [committedPortfolios, fundData, dateFrom, dateTo, rollingPeriod])

  // ── Build series for charts ───────────────────────

  const validResults = results?.filter(r => r.returns.length > 0) ?? []

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

  // ── Render ──────────────────────────────────────

  return (
    <div className="simulation-panel">
      <h2>Mô Phỏng Danh Mục</h2>

      {/* Portfolio cards */}
      {portfolios.map((portfolio, pIdx) => {
        const totalWeight = portfolio.slots.reduce((s, f) => s + f.weight, 0)
        const isOverUnder = Math.abs(totalWeight - 100) > 0.01

        return (
          <div key={portfolio.id} className="portfolio-card">
            {/* Header */}
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

            {/* Actions row */}
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

            {/* Fund slots */}
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
                    styles={simSelectStyles}
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

            {/* Total */}
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
          Chạy Mô Phỏng
        </button>
      )}

      {loading && <div className="loading-indicator">Đang tải dữ liệu...</div>}

      {/* Date range picker — always visible when portfolios have been run */}
      {committedPortfolios.length > 0 && (
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChangeFrom={setDateFrom}
          onChangeTo={setDateTo}
        />
      )}

      {/* Error when date range produces no results */}
      {committedPortfolios.length > 0 && validResults.length === 0 && !loading && (
        <div className="error-banner">
          Khoảng thời gian được chọn không đủ dữ liệu để tính toán. Hãy chọn khoảng thời gian dài hơn hoặc nhấn "Tất cả".
        </div>
      )}

      {/* Results section */}
      {validResults.length > 0 && (
        <>
          {/* Period info */}
          {startDate && endDate && (
            <div className="comparison-period" style={{ marginBottom: 16 }}>
              Mô phỏng từ {formatDate(startDate)} đến {formatDate(endDate)}
            </div>
          )}

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
          Bấm "Thêm Danh Mục" để bắt đầu mô phỏng danh mục đầu tư.
        </div>
      )}
    </div>
  )
}

const simSelectStyles = {
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

function filterDateRange(
  series: WeeklyPrice[],
  from: string | null,
  to: string | null,
): WeeklyPrice[] {
  return series.filter(p => {
    if (from && p.date < from) return false
    if (to && p.date > to) return false
    return true
  })
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}
