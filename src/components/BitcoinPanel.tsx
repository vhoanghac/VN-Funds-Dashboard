import { useState, useEffect, useMemo, useDeferredValue, memo } from 'react'
import Select from 'react-select'
import type { FundMeta, PricePoint, ChartSeries, RebalanceFrequency, ReturnPoint } from '../types'
import { useFundSeriesMap } from '../hooks/useFundData'
import { useCommittedRun } from '../hooks/useCommittedRun'
import { DividendNotice } from './DividendNotice'
import { weeklyReturns, cumulativeReturns, cagr, annualizedStdev, maxDrawdown, riskContribution, worstWeeklyReturn, worstMonthlyReturn, ZERO_VOLATILITY_EPSILON } from '../utils/calculations'
import { simulateMultiFundPortfolio } from '../utils/portfolio'
import { alignMultiSeries } from '../utils/dateAlign'
import { BitcoinCycleTable } from './BitcoinCycleTable'
import { CumulativeReturnChart } from './CumulativeReturnChart'
import { PerformanceTable } from './PerformanceTable'
import type { PortfolioStats } from './PerformanceTable'
import { RiskContributionChart } from './RiskContributionChart'
import type { RiskContribItem } from './RiskContributionChart'
import { BtcContributionChart } from './BtcContributionChart'
import { BtcWeightChart } from './BtcWeightChart'
import { BTC_EVENTS } from '../utils/btcEvents'
import { MoneyInput } from './MoneyInput'
import { MoneyMachineBlock } from './MoneyMachineBlock'
import { SavingsRateInput } from './SavingsRateInput'
import {
  isSavingsAssetId, savingsAssetId, assetDisplayName,
  SAVINGS_OPTION_LABEL, DEFAULT_SAVINGS_RATE,
} from '../utils/savingsAsset'
import { SleepTestBlock } from './SleepTestBlock'
import { WinRateBlock } from './WinRateBlock'
import { loadLS, saveLS } from '../utils/localStorage'

interface Props {
  funds: FundMeta[]
}

const BTC_ID = 'BTC'
const DEFAULT_FUND_ID = 'E1VFVN30'
const DEFAULT_BTC_PERCENTS: [number, number, number] = [1, 2, 3]
const DEFAULT_INVESTMENT = 100_000_000 // 100 triệu, retail default
const PORTFOLIO_COLORS = ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51']

type DateRangeMode = 'all' | 'years'

interface BitcoinParams {
  fundId: string
  rebalFreq: RebalanceFrequency
  btcPercents: [number, number, number]
  investAmount: number
  dateFrom: string | null
  dateTo: string | null
}

interface BitcoinSnapshot {
  params: BitcoinParams
  data: Map<string, PricePoint[]>
}

const REBAL_OPTIONS: { value: RebalanceFrequency; label: string }[] = [
  { value: 'monthly', label: 'Hàng tháng' },
  { value: 'quarterly', label: 'Hàng quý' },
  { value: 'yearly', label: 'Hàng năm' },
]

function BitcoinPanelImpl({ funds }: Props) {
  const [selectedFundId, setSelectedFundId] = useState(
    () => loadLS<string>('btc_fund', DEFAULT_FUND_ID),
  )
  const [rebalFreq, setRebalFreq] = useState<RebalanceFrequency>(
    () => loadLS<RebalanceFrequency>('btc_rebal', 'quarterly'),
  )
  const [btcPercents, setBtcPercents] = useState<[number, number, number]>(
    () => loadLS<[number, number, number]>('btc_weights', DEFAULT_BTC_PERCENTS),
  )
  const [investAmount, setInvestAmount] = useState<number>(
    () => loadLS<number>('btc_invest_amount', DEFAULT_INVESTMENT),
  )
  const [dateMode, setDateMode] = useState<DateRangeMode>(
    () => loadLS<DateRangeMode>('btc_dateMode', 'all'),
  )
  const [yearsBack, setYearsBack] = useState(
    () => loadLS<number>('btc_yearsBack', 5),
  )
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const neededFundIds = useMemo(() => {
    return Array.from(new Set([BTC_ID, selectedFundId]))
  }, [selectedFundId])

  const {
    data: fundData,
    loading,
    errors,
  } = useFundSeriesMap(neededFundIds)
  const error = Array.from(errors.values())[0] ?? null

  // Persist selections
  useEffect(() => { saveLS('btc_fund', selectedFundId) }, [selectedFundId])
  useEffect(() => { saveLS('btc_rebal', rebalFreq) }, [rebalFreq])
  useEffect(() => { saveLS('btc_weights', btcPercents) }, [btcPercents])
  useEffect(() => { saveLS('btc_invest_amount', investAmount) }, [investAmount])
  useEffect(() => { saveLS('btc_dateMode', dateMode) }, [dateMode])
  useEffect(() => { saveLS('btc_yearsBack', yearsBack) }, [yearsBack])

  // Chế độ "X năm qua" quy ra khoảng ngày cụ thể, giống hệt tab DCA.
  function getEffectiveDates(): { from: string | null; to: string | null } {
    if (dateMode === 'years') {
      const now = new Date()
      const from = new Date(now.getFullYear() - yearsBack, now.getMonth(), now.getDate())
      return {
        from: from.toISOString().substring(0, 10),
        to: now.toISOString().substring(0, 10),
      }
    }
    return { from: dateFrom || null, to: dateTo || null }
  }

  // Fund options (exclude BTC itself)
  const fundOptions = useMemo(
    () => [
      ...funds
        .filter(f => f.id !== BTC_ID)
        .map(f => ({ value: f.id, label: f.name_vi })),
      { value: savingsAssetId(DEFAULT_SAVINGS_RATE), label: SAVINGS_OPTION_LABEL },
    ],
    [funds],
  )

  // Lãi suất nằm ngay trong id ("SAVINGS:7"), nên khi người dùng đổi lãi suất,
  // id mới không còn khớp option nào trong danh sách. Tự dựng lại option cho
  // đúng id hiện tại để ô chọn không bị rỗng.
  const selectedFundOption = isSavingsAssetId(selectedFundId)
    ? { value: selectedFundId, label: SAVINGS_OPTION_LABEL }
    : fundOptions.find(o => o.value === selectedFundId) || null

  // BTC weight 0–10% used by the scatter chart, computed once here and passed
  // down so BtcWeightChart doesn't re-simulate the same 11 portfolios itself.
  const SCATTER_WEIGHTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  const canRun = !!selectedFundId
  const dataReady = neededFundIds.every(id => fundData.has(id)) && !loading && errors.size === 0
  const effectiveDates = getEffectiveDates()

  function buildSnapshot(): BitcoinSnapshot {
    return {
      params: {
        fundId: selectedFundId,
        rebalFreq,
        btcPercents: [...btcPercents] as [number, number, number],
        investAmount,
        dateFrom: effectiveDates.from,
        dateTo: effectiveDates.to,
      },
      data: new Map(fundData),
    }
  }

  // Chỉ mô phỏng sau khi hook đã chốt params và Map dữ liệu.
  const committedRun = useCommittedRun({
    ready: dataReady,
    valid: canRun,
    liveParams: {
      fundId: selectedFundId,
      rebalFreq,
      btcPercents,
      investAmount,
      dateFrom: effectiveDates.from,
      dateTo: effectiveDates.to,
    },
    captureSnapshot: buildSnapshot,
    compute: snapshot => {
      const applied = snapshot.params
      const committedData = snapshot.data
      const empty = {
        portfolioSeries: [] as ChartSeries[],
        portfolioStats: [] as PortfolioStats[],
        riskContribData: [] as RiskContribItem[],
        portfolioReturns: [] as ReturnPoint[][],
        allSimReturns: [] as ReturnPoint[][],
      }
      const btcWeekly = committedData.get(BTC_ID)
      const fundWeekly = committedData.get(applied.fundId)
      if (!btcWeekly || !fundWeekly) return empty

      try {
      // Apply date filter before alignment
      const filteredBtc = filterDateRange(btcWeekly, applied.dateFrom, applied.dateTo)
      const filteredFund = filterDateRange(fundWeekly, applied.dateFrom, applied.dateTo)

      const aligned = alignMultiSeries([filteredBtc, filteredFund])
      const startDate = aligned.dates[0]!
      const btcReturns = weeklyReturns(aligned.dates, aligned.prices[0]!)
      const fundReturns = weeklyReturns(aligned.dates, aligned.prices[1]!)
      const minLen = Math.min(btcReturns.length, fundReturns.length)
      const btcR = btcReturns.slice(btcReturns.length - minLen)
      const fundR = fundReturns.slice(fundReturns.length - minLen)

      // ── Main chart portfolios (0%, w1%, w2%, w3%) ──
      const weights = [0, ...applied.btcPercents.map(p => p / 100)]
      const series: ChartSeries[] = []
      const stats: PortfolioStats[] = []
      const riskData: RiskContribItem[] = []
      const portReturns: ReturnPoint[][] = []

      // `name` vừa là nhãn hiển thị, vừa là DANH TÍNH của danh mục: React key ở
      // bảng thành quả/bài kiểm tra tâm lý, và dataKey khi gộp series trong
      // CumulativeReturnChart. Người dùng có thể nhập 2 mức tỷ trọng bằng nhau
      // (vd 5, 5, 10), hoặc 2 mức chỉ khác nhau ở phần thập phân bị làm tròn khi
      // hiển thị (5,04 và 5,02 đều ra "5.0% Bitcoin"). Khi đó tên trùng nhau và
      // series sau ĐÈ LÊN series trước lúc gộp, làm mất hẳn 1 đường trên biểu đồ.
      // Thêm hậu tố để mỗi danh mục luôn có tên riêng.
      const usedNames = new Set<string>()

      for (let i = 0; i < weights.length; i++) {
        const btcW = weights[i]!
        const fundW = 1 - btcW
        const simReturns = simulateMultiFundPortfolio(
          [btcR, fundR],
          [btcW, fundW],
          applied.rebalFreq,
        )
        const cum = cumulativeReturns(simReturns, startDate)
        const pct = btcW * 100
        const pctStr = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)
        const baseName = btcW === 0
          ? `100% ${assetDisplayName(applied.fundId)}`
          : `${pctStr}% Bitcoin`
        let name = baseName
        for (let dup = 2; usedNames.has(name); dup++) name = `${baseName} (${dup})`
        usedNames.add(name)
        const color = PORTFOLIO_COLORS[i]!

        portReturns.push(simReturns)
        series.push({ name, color, data: cum })

        const cagrVal = cagr(simReturns) ?? 0
        const stdevVal = annualizedStdev(simReturns)
        stats.push({
          name,
          color,
          cumReturn: cum.length > 1 ? cum[cum.length - 1]!.value : 0,
          cagrValue: cagrVal,
          stdev: stdevVal,
          // null = không định nghĩa được (danh mục không biến động), xem PortfolioStats.sharpe
          sharpe: stdevVal > ZERO_VOLATILITY_EPSILON ? cagrVal / stdevVal : null,
          maxDD: maxDrawdown(simReturns),
          worstWeek: worstWeeklyReturn(simReturns),
          worstMonth: worstMonthlyReturn(simReturns),
        })

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

      // ── Scatter chart portfolios (0%–10% in 1% steps), computed once ──
      const scatterSims: ReturnPoint[][] = []
      for (const w of SCATTER_WEIGHTS) {
        try {
          scatterSims.push(simulateMultiFundPortfolio(
            [btcR, fundR],
            [w / 100, 1 - w / 100],
            applied.rebalFreq,
          ))
        } catch {
          scatterSims.push([])
        }
      }

        return {
        portfolioSeries: series,
        portfolioStats: stats,
        riskContribData: riskData,
        portfolioReturns: portReturns,
        allSimReturns: scatterSims,
        }
      } catch {
        return empty
      }
    },
  })

  const {
    committed,
    result: computed,
    dirty: isDirty,
    run: runCommitted,
  } = committedRun
  const portfolioSeries = computed?.portfolioSeries ?? []
  const portfolioStats = computed?.portfolioStats ?? []
  const riskContribData = computed?.riskContribData ?? []

  // Phần "phân tích chi tiết" bên dưới (WinRateBlock + BtcContributionChart +
  // BtcWeightChart) nặng hơn vì hai lý do: rollingCumulativeReturns chạy trên
  // từng kịch bản (11 trọng số scatter × 1-3 kỳ hạn), và BtcWeightChart dựng
  // ~11 nghìn điểm scatter từ dữ liệu daily. Dùng useDeferredValue để phần
  // nhanh ở trên (MoneyMachine, chart chính, bảng hiệu suất...) hiện ngay lập
  // tức, không phải chờ phần nặng tính xong mới thấy gì cả. React tự lùi phần
  // nặng xuống 1 update có độ ưu tiên thấp hơn, chạy sau khi phần nhanh đã
  // paint xong.
  const runView = useMemo(
    () => committed ? { committed, computed } : null,
    [committed, computed],
  )
  const deferredRun = useDeferredValue(runView)
  const deferredPortfolioReturns = deferredRun?.computed?.portfolioReturns ?? []
  const deferredAllSimReturns = deferredRun?.computed?.allSimReturns ?? []
  const deferredPortfolioStats = deferredRun?.computed?.portfolioStats ?? portfolioStats
  const heavyParams = deferredRun?.committed?.params ?? committed?.params
  const isHeavySectionStale = deferredRun !== runView

  const startDate = portfolioSeries[0]?.data[0]?.date
  const endDate = portfolioSeries[0]?.data[portfolioSeries[0].data.length - 1]?.date

  return (
    <div className="simulation-panel">
      <div className="panel-header">
        <h2>Bitcoin</h2>
      </div>

      <div className="bitcoin-controls">
        <p className="bitcoin-description">
          Chọn một quỹ làm nền tảng, hệ thống sẽ so sánh lợi nhuận tích lũy của danh mục gốc
          với các danh mục có pha trộn Bitcoin. Danh mục được tái cân bằng tỷ trọng định kỳ.
        </p>
        <div className="bitcoin-ctrl-group bitcoin-ctrl-fund">
          <label className="bitcoin-ctrl-label">Quỹ nền tảng</label>
          <div className="bitcoin-fund-row">
            <Select
              className="bitcoin-fund-select"
              classNamePrefix="fund-search"
              options={fundOptions}
              value={selectedFundOption}
              onChange={opt => opt && setSelectedFundId(opt.value)}
              isSearchable
              placeholder="Tìm quỹ..."
              noOptionsMessage={() => 'Không tìm thấy'}
              styles={bitcoinSelectStyles}
            />
            {isSavingsAssetId(selectedFundId) && (
              <SavingsRateInput
                fundId={selectedFundId}
                onCommit={rate => setSelectedFundId(savingsAssetId(rate))}
              />
            )}
          </div>
        </div>
        <div className="bitcoin-ctrl-group">
          <label className="bitcoin-ctrl-label">Số tiền đầu tư</label>
          <div className="bitcoin-money-wrap">
            <MoneyInput
              value={investAmount}
              onChange={setInvestAmount}
              min={1_000_000}
              className="bitcoin-money-input"
            />
            <span className="bitcoin-money-unit">đ</span>
          </div>
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

      <div className="dca-params-card">
        <div className="dca-param-row">
          <label className="dca-label">Khoảng thời gian</label>
          <div className="dca-date-mode">
            <button className={`dca-mode-btn ${dateMode === 'all' ? 'dca-mode-btn-active' : ''}`} onClick={() => setDateMode('all')}>Tất cả</button>
            <button className={`dca-mode-btn ${dateMode === 'years' ? 'dca-mode-btn-active' : ''}`} onClick={() => setDateMode('years')}>X năm qua</button>
          </div>
        </div>

        {dateMode === 'years' && (
          <div className="dca-param-row dca-years-row">
            <label className="dca-label">Số năm</label>
            <div className="dca-years-selector">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <button key={n} className={`dca-year-btn ${yearsBack === n ? 'dca-year-btn-active' : ''}`} onClick={() => setYearsBack(n)}>{n}</button>
              ))}
            </div>
          </div>
        )}

        {dateMode === 'all' && (
          <div className="dca-param-row">
            <label className="dca-label">Từ ngày đến ngày</label>
            <div className="dca-date-inputs">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span className="dca-date-sep">→</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      <div className="btc-run-row">
        <button
          className="btc-run-btn"
          onClick={() => { if (selectedFundId) runCommitted() }}
          disabled={!canRun}
        >
          {committed ? 'Chạy lại mô phỏng' : 'Chạy mô phỏng'}
        </button>
        {committed && isDirty && (
          <span className="btc-run-hint">
            Thông số đã thay đổi, bấm "Chạy lại mô phỏng" để cập nhật biểu đồ.
          </span>
        )}
      </div>

      {loading && <div className="loading-indicator">Đang tải dữ liệu...</div>}
      {error && <div className="error-banner">{error}</div>}

      {!committed && !loading && !error && (
        <div className="btc-run-placeholder">
          Bấm "Chạy mô phỏng" để tính toán và hiển thị biểu đồ.
        </div>
      )}

      {committed && !loading && !error && portfolioSeries.length === 0 && committed.data.has(BTC_ID) && (
        <div className="error-banner">
          Khoảng thời gian được chọn không đủ dữ liệu. Hãy chọn khoảng thời gian dài hơn hoặc nhấn "Tất cả".
        </div>
      )}

      {committed && portfolioSeries.length > 0 && !loading && (
        <>
          {startDate && endDate && (
            <div className="comparison-period" style={{ marginBottom: 16 }}>
              Mô phỏng từ {formatDate(startDate)} đến {formatDate(endDate)}
            </div>
          )}
           <DividendNotice fundIds={[committed.params.fundId]} />

          <MoneyMachineBlock
             investAmount={committed.params.investAmount}
            stats={portfolioStats}
             fundId={assetDisplayName(committed.params.fundId)}
            startDate={startDate}
            endDate={endDate}
          />
          <CumulativeReturnChart series={portfolioSeries} events={BTC_EVENTS} />
          <PerformanceTable stats={portfolioStats} />

          <BitcoinCycleTable
             btc={committed.data.get(BTC_ID) ?? []}
             base={committed.data.get(committed.params.fundId) ?? []}
             baseName={assetDisplayName(committed.params.fundId)}
          />
           <SleepTestBlock investAmount={committed.params.investAmount} stats={portfolioStats} />

          <div className="section-divider">
            <span className="section-divider-label">
              Vai trò của Bitcoin trong danh mục
            </span>
          </div>

           <RiskContributionChart data={riskContribData} fundId={assetDisplayName(committed.params.fundId)} />

          {/* Phần bên dưới tính nặng hơn — deferred để không chặn phần trên hiện ngay
              (xem useDeferredValue ở trên). Mờ nhẹ trong lúc React tính phần mới. */}
          <div style={{ opacity: isHeavySectionStale ? 0.6 : 1, transition: 'opacity 0.15s' }}>
            <BtcContributionChart
              portfolioReturns={deferredPortfolioReturns}
                btcPercents={heavyParams!.btcPercents}
                fundId={assetDisplayName(heavyParams!.fundId)}
            />
            <WinRateBlock
              portfolioReturns={deferredPortfolioReturns}
                btcPercents={heavyParams!.btcPercents}
               stats={deferredPortfolioStats}
            />

            <div className="section-divider">
              <span className="section-divider-label">
                Phân tích chi tiết theo tỷ trọng Bitcoin (0%–10%)
              </span>
            </div>

            <BtcWeightChart
               allSimReturns={deferredAllSimReturns}
               fundId={heavyParams!.fundId}
               rebalFreq={heavyParams!.rebalFreq}
            />
          </div>
        </>
      )}
    </div>
  )
}

// Memo hoá: App.tsx luôn mount cả 5 tab (ẩn bằng display:none), nên mỗi lần
// chuyển tab hoặc đổi state ở tab khác đều khiến App re-render. Không memo,
// component này (và toàn bộ chart bên trong) sẽ re-render/reconcile lại mỗi
// lần đó dù props không đổi — với dữ liệu daily (nhiều điểm hơn tuần 5-7 lần)
// chi phí này đủ lớn để gây "đơ" khi chuyển tab.
export const BitcoinPanel = memo(BitcoinPanelImpl)

function filterDateRange(series: PricePoint[], from: string | null, to: string | null): PricePoint[] {
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
