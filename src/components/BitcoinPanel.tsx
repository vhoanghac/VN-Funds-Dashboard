import { useState, useEffect, useMemo } from 'react'
import Select from 'react-select'
import type { FundMeta, WeeklyPrice, ChartSeries, RebalanceFrequency } from '../types'
import { parseCSV } from '../utils/csvParser'
import { resampleToWeekly } from '../utils/weeklyResample'
import { weeklyReturns, cumulativeReturns, cagr, annualizedStdev, maxDrawdown, riskContribution } from '../utils/calculations'
import { simulateMultiFundPortfolio } from '../utils/portfolio'
import { alignMultiSeries } from '../utils/dateAlign'
import { CumulativeReturnChart } from './CumulativeReturnChart'
import { PerformanceTable } from './PerformanceTable'
import type { PortfolioStats } from './PerformanceTable'
import { RiskContributionChart } from './RiskContributionChart'
import type { RiskContribItem } from './RiskContributionChart'
import { DateRangePicker } from './DateRangePicker'
import { loadLS, saveLS } from '../utils/localStorage'

interface Props {
  funds: FundMeta[]
}

const BTC_ID = 'BTC'
const DEFAULT_FUND_ID = 'E1VFVN30'
const DEFAULT_BTC_PERCENTS: [number, number, number] = [1, 2, 3]
const PORTFOLIO_COLORS = ['#64748B', '#FCD34D', '#F97316', '#B45309']

const REBAL_OPTIONS: { value: RebalanceFrequency; label: string }[] = [
  { value: 'monthly', label: 'Hàng tháng' },
  { value: 'quarterly', label: 'Hàng quý' },
  { value: 'yearly', label: 'Hàng năm' },
]

export function BitcoinPanel({ funds }: Props) {
  const [selectedFundId, setSelectedFundId] = useState(
    () => loadLS<string>('btc_fund', DEFAULT_FUND_ID),
  )
  const [rebalFreq, setRebalFreq] = useState<RebalanceFrequency>(
    () => loadLS<RebalanceFrequency>('btc_rebal', 'quarterly'),
  )
  const [btcPercents, setBtcPercents] = useState<[number, number, number]>(
    () => loadLS<[number, number, number]>('btc_weights', DEFAULT_BTC_PERCENTS),
  )
  const [dateFrom, setDateFrom] = useState<string | null>(null)
  const [dateTo, setDateTo] = useState<string | null>(null)
  const [fundData, setFundData] = useState<Map<string, WeeklyPrice[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Persist selections
  useEffect(() => { saveLS('btc_fund', selectedFundId) }, [selectedFundId])
  useEffect(() => { saveLS('btc_rebal', rebalFreq) }, [rebalFreq])
  useEffect(() => { saveLS('btc_weights', btcPercents) }, [btcPercents])

  // Fund options (exclude BTC itself)
  const fundOptions = useMemo(
    () => funds
      .filter(f => f.id !== BTC_ID)
      .map(f => ({ value: f.id, label: f.name_vi })),
    [funds],
  )

  // Load BTC + selected fund CSV
  useEffect(() => {
    const needed = [BTC_ID, selectedFundId].filter(id => !fundData.has(id))
    if (needed.length === 0) return

    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all(
      needed.map(async id => {
        const resp = await fetch(`/data/${id}.csv`)
        if (!resp.ok) throw new Error(`Không tải được ${id} (${resp.status})`)
        const text = await resp.text()
        const daily = parseCSV(text)
        const weekly = resampleToWeekly(daily)
        return { id, weekly }
      }),
    )
      .then(results => {
        if (cancelled) return
        setFundData(prev => {
          const next = new Map(prev)
          for (const r of results) next.set(r.id, r.weekly)
          return next
        })
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [selectedFundId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build 4 portfolio cumulative return series + performance stats + risk contribution
  const { portfolioSeries, portfolioStats, riskContribData } = useMemo<{
    portfolioSeries: ChartSeries[]
    portfolioStats: PortfolioStats[]
    riskContribData: RiskContribItem[]
  }>(() => {
    const btcWeekly = fundData.get(BTC_ID)
    const fundWeekly = fundData.get(selectedFundId)
    if (!btcWeekly || !fundWeekly) return { portfolioSeries: [], portfolioStats: [], riskContribData: [] }

    try {
      // Apply date filter before alignment
      const filteredBtc = filterDateRange(btcWeekly, dateFrom, dateTo)
      const filteredFund = filterDateRange(fundWeekly, dateFrom, dateTo)

      const aligned = alignMultiSeries([filteredBtc, filteredFund])
      const startDate = aligned.dates[0]!
      const btcReturns = weeklyReturns(aligned.dates, aligned.prices[0]!)
      const fundReturns = weeklyReturns(aligned.dates, aligned.prices[1]!)
      const minLen = Math.min(btcReturns.length, fundReturns.length)
      const btcR = btcReturns.slice(btcReturns.length - minLen)
      const fundR = fundReturns.slice(fundReturns.length - minLen)

      const weights = [0, ...btcPercents.map(p => p / 100)]
      const series: ChartSeries[] = []
      const stats: PortfolioStats[] = []
      const riskData: RiskContribItem[] = []

      for (let i = 0; i < weights.length; i++) {
        const btcW = weights[i]!
        const fundW = 1 - btcW
        const simReturns = simulateMultiFundPortfolio(
          [btcR, fundR],
          [btcW, fundW],
          rebalFreq,
        )
        const cum = cumulativeReturns(simReturns, startDate)
        const pct = btcW * 100
        const pctStr = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)
        const name = btcW === 0
          ? `100% ${selectedFundId}`
          : `${pctStr}% Bitcoin`
        const color = PORTFOLIO_COLORS[i]!

        series.push({ name, color, data: cum })

        const cagrVal = cagr(simReturns) ?? 0
        const stdevVal = annualizedStdev(simReturns)
        stats.push({
          name,
          color,
          cumReturn: cum.length > 1 ? cum[cum.length - 1]!.value : 0,
          cagrValue: cagrVal,
          stdev: stdevVal,
          sharpe: stdevVal > 0 ? cagrVal / stdevVal : 0,
          maxDD: maxDrawdown(simReturns),
        })

        // Risk contribution for non-zero BTC portfolios
        if (btcW > 0) {
          const rc = riskContribution(btcR, fundR, btcW, fundW)
          riskData.push({
            name,
            btcWeight: btcW,
            btcRiskPct: rc.contribA,
            fundWeight: fundW,
            fundRiskPct: rc.contribB,
          })
        }
      }

      return { portfolioSeries: series, portfolioStats: stats, riskContribData: riskData }
    } catch {
      return { portfolioSeries: [], portfolioStats: [], riskContribData: [] }
    }
  }, [fundData, selectedFundId, rebalFreq, dateFrom, dateTo, btcPercents])

  const startDate = portfolioSeries[0]?.data[0]?.date
  const endDate = portfolioSeries[0]?.data[portfolioSeries[0].data.length - 1]?.date

  return (
    <div className="simulation-panel">
      <div className="panel-header">
        <h2>Bitcoin</h2>
      </div>

      <p className="bitcoin-description">
        Chọn một quỹ làm nền tảng, hệ thống sẽ so sánh lợi nhuận tích lũy của danh mục gốc
        với các danh mục có pha trộn 1%, 2% và 3% Bitcoin. Danh mục được tái cân bằng tỷ trọng định kỳ.
      </p>

      <div className="bitcoin-controls">
        <div className="bitcoin-ctrl-group bitcoin-ctrl-fund">
          <label className="bitcoin-ctrl-label">Quỹ nền tảng</label>
          <Select
            className="bitcoin-fund-select"
            classNamePrefix="fund-search"
            options={fundOptions}
            value={fundOptions.find(o => o.value === selectedFundId) || null}
            onChange={opt => opt && setSelectedFundId(opt.value)}
            isSearchable
            placeholder="Tìm quỹ..."
            noOptionsMessage={() => 'Không tìm thấy'}
            styles={bitcoinSelectStyles}
          />
        </div>
        <div className="bitcoin-ctrl-group">
          <label className="bitcoin-ctrl-label">Tái cân bằng</label>
          <select
            className="bitcoin-rebal-select"
            value={rebalFreq}
            onChange={e => setRebalFreq(e.target.value as RebalanceFrequency)}
          >
            {REBAL_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="bitcoin-ctrl-group">
          <label className="bitcoin-ctrl-label">Tỷ trọng Bitcoin trong danh mục</label>
          <div className="bitcoin-weight-inputs">
            {btcPercents.map((pct, i) => (
              <div key={i} className="bitcoin-weight-chip">
                <span
                  className="weight-chip-dot"
                  style={{ background: PORTFOLIO_COLORS[i + 1] }}
                />
                <input
                  type="number"
                  className="bitcoin-weight-input"
                  min={0}
                  max={100}
                  step={0.5}
                  value={pct}
                  onChange={e => {
                    const val = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0))
                    setBtcPercents(prev => {
                      const next = [...prev] as [number, number, number]
                      next[i] = val
                      return next
                    })
                  }}
                />
                <span className="bitcoin-weight-unit">%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <DateRangePicker
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChangeFrom={setDateFrom}
        onChangeTo={setDateTo}
      />

      {loading && <div className="loading-indicator">Đang tải dữ liệu...</div>}
      {error && <div className="error-banner">{error}</div>}

      {!loading && !error && portfolioSeries.length === 0 && fundData.has(BTC_ID) && (
        <div className="error-banner">
          Khoảng thời gian được chọn không đủ dữ liệu. Hãy chọn khoảng thời gian dài hơn hoặc nhấn "Tất cả".
        </div>
      )}

      {portfolioSeries.length > 0 && !loading && (
        <>
          {startDate && endDate && (
            <div className="comparison-period" style={{ marginBottom: 16 }}>
              Mô phỏng từ {formatDate(startDate)} đến {formatDate(endDate)}
            </div>
          )}
          <CumulativeReturnChart series={portfolioSeries} />
          <PerformanceTable stats={portfolioStats} />
          <RiskContributionChart data={riskContribData} fundId={selectedFundId} />
        </>
      )}
    </div>
  )
}

function filterDateRange(series: WeeklyPrice[], from: string | null, to: string | null): WeeklyPrice[] {
  return series.filter(p => {
    if (from && p.date < from) return false
    if (to && p.date > to) return false
    return true
  })
}

const bitcoinSelectStyles = {
  control: (base: Record<string, unknown>) => ({
    ...base,
    minHeight: 38,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    boxShadow: 'none',
    '&:hover': { borderColor: '#F97316' },
    fontSize: '0.9rem',
    backgroundColor: '#fff',
  }),
  menu: (base: Record<string, unknown>) => ({
    ...base,
    zIndex: 20,
  }),
  option: (base: Record<string, unknown>, state: { isFocused: boolean; isSelected: boolean }) => ({
    ...base,
    fontSize: '0.85rem',
    backgroundColor: state.isSelected ? '#F97316' : state.isFocused ? '#FFF7ED' : undefined,
    color: state.isSelected ? 'white' : '#1a1a1a',
  }),
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}
