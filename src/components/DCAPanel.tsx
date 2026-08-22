import { useState, useMemo, useEffect, useRef, memo } from 'react'
import { MoneyInput } from './MoneyInput'
import { ShareButton } from './ShareButton'
import { buildDcaUrl } from '../utils/shareUrl'
import type { DcaShareState, ShareUrlState } from '../utils/shareUrl'
import { saveLS } from '../utils/localStorage'
import { useSharePersistence } from '../hooks/useSharePersistence'
import type { Portfolio, PortfolioCardState, ReturnPoint, FundMeta, PricePoint, RebalanceFrequency } from '../types'
import { simulateDCA, dcaMWRR, dcaCagr, investorCagr, dcaProfitFactor, dcaStormStats, trackDividendNarrative, derivePortfolioName, monthlyEquivalentContribution, isDCAFrequency, slicePricesWithPredecessor, type DCAFrequency, type DCASlot, type DCAStormStats } from '../utils/dca'
import { avgDrawdown, longestDrawdownDays, annualizedStdevFromCumulative } from '../utils/drawdownStats'
import { alignFundsToCommonGridDaily } from '../utils/weeklyResample'
import { loadDividends, type DividendEvent, type DividendNarrativeStats } from '../utils/dividendAdjust'
import { useFundSeriesMap } from '../hooks/useFundData'
import { useCommittedRun } from '../hooks/useCommittedRun'
import { PortfolioValueChart } from './PortfolioValueChart'
import { DcaHistoricalPercentileBlock } from './DcaHistoricalPercentileBlock'
import { DcaRatioChart } from './DcaRatioChart'
import { DcaReturnPainChart } from './DcaReturnPainChart'
import { DcaEntryPointBlock } from './DcaEntryPointBlock'
import { DCAStatsTable } from './DCAStatsTable'
import { DCAGlossary } from './DCAGlossary'
import { DcaJourneyBlock, EOYReturnsTable } from './DcaJourneyBlock'
import { BankComparisonBlock } from './BankComparisonBlock'
import { DcaStormBlock } from './DcaStormBlock'
import { DcaReturnExplainer } from './DcaReturnExplainer'
import { ProjectionBlock } from './ProjectionBlock'
import { MonteCarloBlock } from './MonteCarloBlock'
import { RollingReturnBlock } from './RollingReturnBlock'
import { DcaConsistencyBlock } from './DcaConsistencyBlock'
import { DividendBlock } from './DividendBlock'
import { GoldLotWarningBlock } from './GoldLotWarningBlock'
import { DataQualityBlock } from './DataQualityBlock'
import { parsePortfolios } from '../utils/portfolio'
import { FUND_COLORS } from '../constants'
import {
  savingsAssetId,
  SAVINGS_OPTION_LABEL,
  DEFAULT_SAVINGS_RATE,
} from '../utils/savingsAsset'
import {
  PortfolioCard,
  PORTFOLIO_COLORS,
  MAX_PORTFOLIOS,
  MAX_FUNDS_PER_PORTFOLIO,
} from './PortfolioCard'

interface Props {
  funds: FundMeta[]
  shareUrl: ShareUrlState<Partial<DcaShareState>>
  active: boolean
}

type DCAPortfolioState = PortfolioCardState

function hydrateDcaPortfolios(
  source: Portfolio[],
  nextIdRef: { current: number },
): DCAPortfolioState[] {
  return source.map(p => {
    const num = nextIdRef.current++
    return {
      id: `dca${num}`,
      num,
      name: p.name || derivePortfolioName(p.slots, `Portfolio ${num}`),
      isNameCustom: !!p.name,
      slots: p.slots,
      rebalFreq: p.rebalFreq,
    }
  })
}

type DateRangeMode = 'all' | 'years'

interface DCAPortfolioResult {
  id: string
  name: string
  color: string
  cumulative: ReturnPoint[]
  drawdown: ReturnPoint[]
  totalInvested: number
  finalValue: number
  mwrr: number | null
  storm: DCAStormStats
  profitFactor: number | null
  investedSeries: { date: string; value: number }[]
  valueSeries: { date: string; value: number }[]
  /** Toàn bộ cashflows (âm = nạp tiền, dòng cuối dương = finalValue) — dùng để tính MWRR theo từng năm */
  cashflows: { date: string; amount: number }[]
  /**
   * Inputs để re-run simulation cho các biến thể hành vi (panic-stop, skip months...).
   * Null nếu simulation gốc thất bại (data không đủ, portfolio rỗng).
   */
  simulationInputs: {
    filteredPrices: Map<string, PricePoint[]>
    slots: DCASlot[]
    params: { initialAmount: number; cashflowAmount: number; cashflowFreq: DCAFrequency }
    rebalFreq: RebalanceFrequency
    /** Giá "bán ra" cho các slot là quỹ 2-giá (vàng) — xem simulateDCA's purchasePrices option. */
    purchasePrices: Map<string, PricePoint[]>
  } | null
  /**
   * Shadow simulation cổ tức trên RAW NAV — số tiền thật, số ccq thật nhà
   * đầu tư nhận được trong kỳ. Rỗng nếu danh mục không chứa quỹ chia cổ tức.
   */
  dividendNarrative: DividendNarrativeStats[]
}

interface DcaParams {
  portfolios: DCAPortfolioState[]
  initialAmount: number
  cashflowAmount: number
  cashflowFreq: DCAFrequency
  dateFrom: string
  dateTo: string
}

interface DcaSnapshot {
  params: DcaParams
  data: {
    fundData: Map<string, PricePoint[]>
    rawFundData: Map<string, PricePoint[]>
    purchasePriceData: Map<string, PricePoint[]>
    dividendsByFund: Map<string, DividendEvent[]>
  }
}

/**
 * Các section kết quả, kiểu hl.eco: bấm pill để chỉ hiện section đó.
 * "Tất cả" (mặc định) giữ nguyên mạch kể chuyện đọc từ trên xuống.
 * Ẩn/hiện bằng display:none để các block (đã bọc React.memo) không phải
 * mount lại khi chuyển qua lại.
 */
type DcaSectionId = 'all' | 'perf' | 'journey' | 'risk' | 'endgame'

const DCA_SECTIONS: { id: DcaSectionId; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'perf', label: 'Hiệu suất đầu tư' },
  { id: 'journey', label: 'Hành trình của bạn' },
  { id: 'risk', label: 'Rủi ro & biến động' },
  { id: 'endgame', label: 'Endgame' },
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

function DCAPanelImpl({ funds, shareUrl, active }: Props) {
  const nextIdRef = useRef(1)

  // URL payload comes from App; this hook keeps localStorage precedence and the persist gate.
  const {
    parsedPayload: urlParams,
    hasExplicitPayload: hasUrlPayload,
    skipUrlPersist,
    readLocal,
  } = useSharePersistence({ source: shareUrl })

  // ── DCA Parameters ──
  const [dateMode, setDateMode] = useState<DateRangeMode>(
    urlParams?.dateMode ?? readLocal('dca_dateMode', 'all' as DateRangeMode)
  )
  const [yearsBack, setYearsBack] = useState(
    urlParams?.yearsBack ?? readLocal('dca_yearsBack', 5)
  )
  const [dateFrom, setDateFrom] = useState<string>(urlParams?.dateFrom ?? '')
  const [dateTo, setDateTo] = useState<string>(urlParams?.dateTo ?? '')
  const [initialAmount, setInitialAmount] = useState(
    urlParams?.initialAmount ?? readLocal('dca_initialAmount', 5_000_000)
  )
  const [cashflowAmount, setCashflowAmount] = useState(
    urlParams?.cashflowAmount ?? readLocal('dca_cashflowAmount', 0)
  )
  const [cashflowFreq, setCashflowFreq] = useState<DCAFrequency>(() => {
    if (urlParams?.cashflowFreq) return urlParams.cashflowFreq
    const saved = readLocal<unknown>('dca_cashflowFreq', 'monthly')
    return isDCAFrequency(saved) ? saved : 'monthly'
  })
  // Section kết quả đang hiện ('all' = toàn bộ, giữ mạch kể chuyện)
  const [activeSection, setActiveSection] = useState<DcaSectionId>('all')
  const showSection = (id: DcaSectionId) =>
    activeSection === 'all' || activeSection === id ? undefined : 'none'

  // ── Portfolios ──
  const [portfolios, setPortfolios] = useState<DCAPortfolioState[]>(() => {
    const source = urlParams?.portfolios !== undefined
      ? urlParams.portfolios
      : hasUrlPayload ? [] : parsePortfolios(readLocal<unknown>('dca_portfolios', null))
    return hydrateDcaPortfolios(source, nextIdRef)
  })
  // Dividend events per fund (loaded once từ public/data/dividends.json).
  // Ở VN hiện tại chỉ DCDE chi trả cổ tức; nếu thêm quỹ khác chỉ cần bổ sung vào JSON.
  // Dùng cho narrative (DividendBlock). Adjustment đã áp dụng sẵn ở CSV
  // loader cho simulation chính, nên simulation không cần biết về cổ tức nữa.
  const [dividendsByFund, setDividendsByFund] = useState<Map<string, DividendEvent[]>>(new Map())
  const [dividendsReady, setDividendsReady] = useState(false)

  // Load dividends.json một lần lúc mount (cho narrative DividendBlock)
  useEffect(() => {
    let cancelled = false
    loadDividends()
      .then(map => {
        if (!cancelled) {
          setDividendsByFund(map)
          setDividendsReady(true)
        }
      })
      .catch(() => { if (!cancelled) setDividendsReady(true) })
    return () => { cancelled = true }
  }, [])

  const lastShareKeyRef = useRef(shareUrl.key)
  useEffect(() => {
    if (shareUrl.key === lastShareKeyRef.current) return
    lastShareKeyRef.current = shareUrl.key

    if (!hasUrlPayload && !active) return

    setDateMode(urlParams?.dateMode ?? (hasUrlPayload ? 'all' : readLocal('dca_dateMode', 'all' as DateRangeMode)))
    setYearsBack(urlParams?.yearsBack ?? (hasUrlPayload ? 5 : readLocal('dca_yearsBack', 5)))
    setDateFrom(urlParams?.dateFrom ?? '')
    setDateTo(urlParams?.dateTo ?? '')
    setInitialAmount(urlParams?.initialAmount ?? (hasUrlPayload ? 5_000_000 : readLocal('dca_initialAmount', 5_000_000)))
    setCashflowAmount(urlParams?.cashflowAmount ?? (hasUrlPayload ? 0 : readLocal('dca_cashflowAmount', 0)))
    const savedFreq = readLocal<unknown>('dca_cashflowFreq', 'monthly')
    setCashflowFreq(urlParams?.cashflowFreq ?? (hasUrlPayload ? 'monthly' : isDCAFrequency(savedFreq) ? savedFreq : 'monthly'))
    nextIdRef.current = 1
    const localPortfolios = parsePortfolios(readLocal<unknown>('dca_portfolios', null))
    setPortfolios(hydrateDcaPortfolios(urlParams?.portfolios ?? (hasUrlPayload ? [] : localPortfolios), nextIdRef))
    resetCommitted()
    setActiveSection('all')
  }, [shareUrl.key, active]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist to localStorage ──
  useEffect(() => { if (!skipUrlPersist) saveLS('dca_initialAmount', initialAmount) }, [initialAmount])
  useEffect(() => { if (!skipUrlPersist) saveLS('dca_cashflowAmount', cashflowAmount) }, [cashflowAmount])
  useEffect(() => { if (!skipUrlPersist) saveLS('dca_cashflowFreq', cashflowFreq) }, [cashflowFreq])
  useEffect(() => { if (!skipUrlPersist) saveLS('dca_dateMode', dateMode) }, [dateMode])
  useEffect(() => { if (!skipUrlPersist) saveLS('dca_yearsBack', yearsBack) }, [yearsBack])
  useEffect(() => {
    if (!skipUrlPersist) saveLS('dca_portfolios', portfolios.map(p => ({
      slots: p.slots, rebalFreq: p.rebalFreq,
      name: p.isNameCustom ? p.name : undefined,
    })))
  }, [portfolios])

  const fundOptions = useMemo(() => [
    ...funds.map(f => ({ value: f.id, label: f.name_vi })),
    { value: savingsAssetId(DEFAULT_SAVINGS_RATE), label: SAVINGS_OPTION_LABEL },
  ], [funds])

  // Quỹ 2-giá (mua/bán khác nhau, vd vàng miếng SJC) — xem giải thích ở
  // purchasePriceData phía trên.
  const dualPriceFundIds = useMemo(() =>
    new Set(funds.filter(f => f.type === 'gold').map(f => f.id)),
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

  // Hook dùng chung giữ daily adjusted, raw và giá sell của vàng. Snapshot đã
  // clone các Map nên cache live chỉ cần giữ portfolio đang chỉnh.
  const neededIdList = useMemo(() => Array.from(neededIds), [neededIds])
  const {
    data: fundData,
    raw: rawFundData,
    purchase: purchasePriceData,
    loading,
    errors,
  } = useFundSeriesMap(neededIdList, { dualPriceFundIds })

  // ── Portfolio CRUD ──

  function addPortfolio() {
    if (portfolios.length >= MAX_PORTFOLIOS) return
    const num = nextIdRef.current++
    const defaultFundId = funds[0]?.id || ''
    const slots = [{ fundId: defaultFundId, weight: 100 }]
    const portfolio: DCAPortfolioState = {
      id: `dca${num}`,
      num,
      name: derivePortfolioName(slots, `Portfolio ${num}`),
      isNameCustom: false,
      slots,
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
      const newSlots = [...p.slots, { fundId: available?.id || '', weight: 0 }]
      const name = p.isNameCustom ? p.name : derivePortfolioName(newSlots, `Portfolio ${p.num}`)
      return { ...p, name, slots: newSlots }
    }))
  }

  function removeSlot(portfolioId: string, index: number) {
    setPortfolios(portfolios.map(p => {
      if (p.id !== portfolioId || p.slots.length <= 1) return p
      const newSlots = p.slots.filter((_, i) => i !== index)
      const name = p.isNameCustom ? p.name : derivePortfolioName(newSlots, `Portfolio ${p.num}`)
      return { ...p, name, slots: newSlots }
    }))
  }

  function updateSlot(portfolioId: string, index: number, update: Partial<DCASlot>) {
    setPortfolios(portfolios.map(p => {
      if (p.id !== portfolioId) return p
      const newSlots = p.slots.map((s, i) => i === index ? { ...s, ...update } : s)
      const name = p.isNameCustom ? p.name : derivePortfolioName(newSlots, `Portfolio ${p.num}`)
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
    runCommitted()
  }

  const canRun = portfolios.length > 0 && portfolios.every(p => {
    const total = p.slots.reduce((s, f) => s + f.weight, 0)
    return Math.abs(total - 100) < 0.01 && p.slots.every(s => s.fundId)
  }) && (initialAmount > 0 || cashflowAmount > 0)

  const liveDates = getEffectiveDates()
  const liveParams: DcaParams = {
    portfolios,
    initialAmount,
    cashflowAmount,
    cashflowFreq,
    dateFrom: liveDates.from,
    dateTo: liveDates.to,
  }
  const dataReady = Array.from(neededIds).every(id => fundData.has(id))
    && !loading
    && errors.size === 0
    && dividendsReady

  // ── Compute results ──
  const committedRun = useCommittedRun({
    ready: dataReady,
    valid: canRun,
    liveParams,
    captureSnapshot: (): DcaSnapshot => ({
      params: {
        portfolios: portfolios.map(p => ({ ...p, slots: [...p.slots] })),
        initialAmount,
        cashflowAmount,
        cashflowFreq,
        dateFrom: getEffectiveDates().from,
        dateTo: getEffectiveDates().to,
      },
      data: {
        fundData: new Map(fundData),
        rawFundData: new Map(rawFundData),
        purchasePriceData: new Map(purchasePriceData),
        dividendsByFund: new Map(dividendsByFund),
      },
    }),
    compute: snapshot => {
      const committed = {
        ...snapshot.params,
        ...snapshot.data,
        params: snapshot.params,
      }
      const fundData = snapshot.data.fundData
      const rawFundData = snapshot.data.rawFundData
      const purchasePriceData = snapshot.data.purchasePriceData
      const dividendsByFund = snapshot.data.dividendsByFund
      if (committed.portfolios.length === 0) return null

    // ── Step 1: Find the GLOBAL common start/end date across ALL portfolios ──
    // This ensures fair comparison, all portfolios start DCA on the same date
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

      const purchasePrices = purchasePriceData.get(fundId)
      if (purchasePrices && purchasePrices.length > 0 && purchasePrices[0]!.date > globalStart) {
        globalStart = purchasePrices[0]!.date
      }
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
    const allFilteredRawPrices = new Map<string, PricePoint[]>()
    const allFilteredPurchasePrices = new Map<string, PricePoint[]>()
    for (const fundId of allFundIds) {
      const prices = fundData.get(fundId)
      if (!prices) return null
      allFilteredPrices.set(fundId, prices.filter(pt => pt.date >= globalStart && pt.date <= globalEnd))
      // Raw cho shadow dividend simulation; nếu chưa load thì skip narrative
      // bằng cách để map rỗng — trackDividendNarrative sẽ trả [] an toàn.
      const rawPrices = rawFundData.get(fundId)
      if (rawPrices) {
        allFilteredRawPrices.set(fundId, rawPrices.filter(pt => pt.date >= globalStart && pt.date <= globalEnd))
      }
      // Giá "bán ra" — chỉ khác với giá định giá (fundData) ở quỹ 2-giá (vàng).
      // QUAN TRỌNG: phải có entry cho MỌI fundId (fallback về `prices` nếu quỹ
      // không có giá bán riêng), không chỉ riêng vàng — nếu không, map này có
      // ít fundId hơn allFilteredPrices, alignFundsToCommonGridDaily sẽ merge
      // lưới ngày khác nhau giữa 2 map, khiến vàng thiếu giá đúng ngày cần mua
      // khi so sánh chung với quỹ khác (portfolio khác) → NaN.
      const purchasePrices = purchasePriceData.get(fundId) ?? prices
      allFilteredPurchasePrices.set(
        fundId,
        slicePricesWithPredecessor(purchasePrices, globalStart, globalEnd),
      )
    }
    const alignedPrices = alignFundsToCommonGridDaily(allFilteredPrices)
    const alignedRawPrices = allFilteredRawPrices.size > 0
      ? alignFundsToCommonGridDaily(allFilteredRawPrices)
      : new Map<string, PricePoint[]>()
    const alignedPurchasePrices = allFilteredPurchasePrices.size > 0
      ? alignFundsToCommonGridDaily(allFilteredPurchasePrices)
      : new Map<string, PricePoint[]>()

    // ── Step 3: Run DCA for each portfolio with aligned dates ──
    const portfolioResults: DCAPortfolioResult[] = []

    for (let pIdx = 0; pIdx < committed.portfolios.length; pIdx++) {
      const p = committed.portfolios[pIdx]!
      const color = PORTFOLIO_COLORS[pIdx % PORTFOLIO_COLORS.length]!

      // Pick this portfolio's fund prices from the aligned grid
      const filteredPrices = new Map<string, PricePoint[]>()
      const portfolioPurchasePrices = new Map<string, PricePoint[]>()
      for (const slot of p.slots) {
        const prices = alignedPrices.get(slot.fundId)
        if (!prices) return null
        filteredPrices.set(slot.fundId, prices)
        const purchasePrices = alignedPurchasePrices.get(slot.fundId)
        // The main simulation needs only dual-price overrides. Passing adjusted
        // fund prices into the raw-NAV dividend shadow would corrupt its units.
        if (dualPriceFundIds.has(slot.fundId) && purchasePrices) {
          portfolioPurchasePrices.set(slot.fundId, purchasePrices)
        }
      }

      const dcaResult = simulateDCA(
        filteredPrices,
        p.slots,
        committed.params,
        p.rebalFreq,
        { purchasePrices: portfolioPurchasePrices },
      )

      if (dcaResult.cumulative.length === 0) {
        portfolioResults.push({
          id: p.id, name: p.name, color,
          cumulative: [], drawdown: [],
          totalInvested: 0, finalValue: 0, mwrr: null, profitFactor: null,
          storm: { maxDrawdown: 0, maxDDDate: '', maxDDPeakDate: '', recoveryMonths: null, stormsCount: 0, inBearPeriod: null },
          investedSeries: [], valueSeries: [], cashflows: [],
          simulationInputs: null,
          dividendNarrative: [],
        })
        continue
      }

      // Shadow simulation trên RAW NAV để kể "tổng tiền thật, tổng ccq thật"
      // nhà đầu tư nhận. Chỉ chạy nếu portfolio có ít nhất 1 quỹ chia cổ tức
      // và raw prices đã sẵn sàng.
      const portfolioRawPrices = new Map<string, PricePoint[]>()
      for (const slot of p.slots) {
        const raw = alignedRawPrices.get(slot.fundId)
        if (raw) portfolioRawPrices.set(slot.fundId, raw)
      }
      const dividendNarrative = portfolioRawPrices.size === p.slots.length
        ? trackDividendNarrative(
            portfolioRawPrices,
            p.slots,
            committed.params,
            p.rebalFreq,
            dividendsByFund,
            portfolioPurchasePrices,
          )
        : []

      portfolioResults.push({
        id: p.id, name: p.name, color,
        cumulative: dcaResult.cumulative,
        drawdown: dcaResult.drawdown,
        totalInvested: dcaResult.totalInvested,
        finalValue: dcaResult.finalValue,
        mwrr: dcaMWRR(dcaResult.cashflows),
        storm: dcaStormStats(dcaResult.drawdown, dcaResult.cumulative),
        profitFactor: dcaProfitFactor(dcaResult.returns),
        investedSeries: dcaResult.invested,
        valueSeries: dcaResult.values,
        cashflows: dcaResult.cashflows,
        simulationInputs: {
          filteredPrices,
          slots: p.slots,
          params: committed.params,
          rebalFreq: p.rebalFreq,
          purchasePrices: portfolioPurchasePrices,
        },
        dividendNarrative,
      })
    }

    return portfolioResults
    },
  })

  const {
    committed,
    result: results,
    dirty: isDirty,
    run: runCommitted,
    reset: resetCommitted,
  } = committedRun
  const dataError = Array.from(errors.values())[0] ?? null
  const isLoading = loading || !dividendsReady

  // Memo hóa để giữ reference ổn định — nếu không, các block hiển thị kết quả
  // bên dưới (đã bọc React.memo) sẽ vẫn re-render + tính toán lại mỗi khi gõ
  // số vào ô nào đó trong panel này, dù kết quả DCA chưa thực sự đổi (chỉ đổi
  // sau khi bấm "Chạy DCA" — tức khi `results` đổi reference).
  const validResults = useMemo(
    () => results?.filter(r => r.cumulative.length > 0) ?? [],
    [results],
  )

  const startDate = validResults.length > 0
    ? validResults[0]!.cumulative[0]?.date : undefined
  const endDate = validResults.length > 0
    ? validResults[0]!.cumulative[validResults[0]!.cumulative.length - 1]?.date : undefined

  // ── Props ổn định cho các block hiển thị kết quả bên dưới ──
  // Tất cả đều đã bọc React.memo; nếu tính .map() trực tiếp trong JSX, mỗi
  // props sẽ là mảng MỚI mỗi lần DCAPanel re-render (kể cả khi chỉ gõ số ở
  // ô khác), khiến React.memo vô tác dụng. Tách ra useMemo theo [validResults]
  // để props chỉ đổi khi kết quả DCA thực sự đổi (sau khi bấm "Chạy DCA").
  const portfolioValueChartData = useMemo(() => validResults.map(r => ({
    name: r.name,
    color: r.color,
    values: r.valueSeries,
    invested: r.investedSeries,
  })), [validResults])

  const historicalPercentileData = useMemo(() => validResults.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    cumulative: r.cumulative,
  })), [validResults])

  const ratioChartData = useMemo(() => validResults.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    values: r.valueSeries,
  })), [validResults])

  const dcaStatsTableData = useMemo(() => validResults.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    finalValue: r.finalValue,
    totalInvested: r.totalInvested,
    cagr: investorCagr(r.cumulative, r.totalInvested, r.finalValue),
    mwrr: r.mwrr,
    maxDrawdown: r.storm.maxDrawdown,
    avgDrawdown: avgDrawdown(r.drawdown),
    longestDrawdownDays: longestDrawdownDays(r.drawdown),
    stdev: annualizedStdevFromCumulative(r.cumulative),
    profitFactor: r.profitFactor,
  })), [validResults])

  // EOYReturnsTable và DcaJourneyBlock dùng chung 1 shape props
  const journeyPortfolios = useMemo(() => validResults.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    totalInvested: r.totalInvested,
    finalValue: r.finalValue,
    valueSeries: r.valueSeries,
    cashflows: r.cashflows,
  })), [validResults])

  const dcaReturnExplainerData = useMemo(() => validResults.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    cagr: investorCagr(r.cumulative, r.totalInvested, r.finalValue),
    mwrr: r.mwrr,
  })), [validResults])

  const dividendFundIds = useMemo(() => Array.from(new Set(
    committed?.params.portfolios.flatMap(p => p.slots.map(s => s.fundId)) ?? [],
  )), [committed])

  // Fund IDs cho DataQualityBlock: lấy từ portfolios ĐANG NHẬP (live state), không
  // đợi committed — để cảnh báo chất lượng dữ liệu hiện ra ngay khi chọn quỹ, trước
  // cả khi bấm "Chạy DCA" (giống cách GoldLotWarningBlock đã làm ngay phía dưới).
  const dataQualityFundIds = useMemo(() => Array.from(new Set(
    portfolios.flatMap(p => p.slots.map(s => s.fundId).filter(Boolean)),
  )), [portfolios])

  // Khoảng ngày thực tế đã dùng để backtest (giao của tất cả danh mục đã chạy) —
  // chỉ có sau khi bấm "Chạy DCA"; trước đó DataQualityBlock vẫn hoạt động bình
  // thường, chỉ là chưa hiển thị dòng "khoảng so sánh thực tế đã căn chỉnh".
  const dataQualityAlignedRange = useMemo(() => {
    if (validResults.length === 0) return null
    const starts = validResults.map(r => r.cumulative[0]?.date).filter((d): d is string => !!d)
    const ends = validResults.map(r => r.cumulative[r.cumulative.length - 1]?.date).filter((d): d is string => !!d)
    if (starts.length === 0 || ends.length === 0) return null
    return {
      start: starts.reduce((a, b) => (a > b ? a : b)),
      end: ends.reduce((a, b) => (a < b ? a : b)),
    }
  }, [validResults])

  const dividendNarrativeData = useMemo(() => validResults.map(r => ({
    portfolioId: r.id,
    portfolioName: r.name,
    color: r.color,
    stats: r.dividendNarrative,
  })), [validResults])

  const bankComparisonData = useMemo(() => validResults.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    finalValue: r.finalValue,
    investedSeries: r.investedSeries,
  })), [validResults])

  const entryPointPortfolios = useMemo(() => validResults
    .filter(r => r.simulationInputs !== null)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.color,
      slots: r.simulationInputs!.slots,
      rebalFreq: r.simulationInputs!.rebalFreq,
    })), [validResults])

  const returnPainData = useMemo(() => validResults.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    finalValue: r.finalValue,
    totalInvested: r.totalInvested,
    maxDrawdown: r.storm.maxDrawdown * 100,
  })), [validResults])

  const dcaStormData = useMemo(() => validResults.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    storm: r.storm,
    drawdown: r.drawdown,
    valueSeries: r.valueSeries,
  })), [validResults])

  const dcaConsistencyData = useMemo(() => validResults.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    totalInvested: r.totalInvested,
    finalValue: r.finalValue,
    valueSeries: r.valueSeries,
    simulationInputs: r.simulationInputs,
  })), [validResults])

  const projectionData = useMemo(() => validResults.map(r => {
    // CAGR của danh mục (TWRR, tách khỏi thời điểm dòng tiền) — dùng làm base
    // rate chiếu tương lai, KHÔNG dùng finalValue/totalInvested (bị kéo thấp
    // vì phần lớn vốn DCA chỉ mới nạp gần đây, chưa kịp sinh lời).
    const cagr = dcaCagr(r.cumulative)
    // Số tiền nạp mỗi tháng: quy đổi trực tiếp từ cashflowAmount/cashflowFreq
    // NGƯỜI DÙNG ĐÃ NHẬP — không suy ra từ totalInvested/số tháng backtest,
    // vì cách đó lẫn cả "Số tiền đầu tiên" (nạp 1 lần) vào trung bình, khiến
    // con số cao hơn mức nạp định kỳ thực tế.
    const params = r.simulationInputs!.params
    const monthlyContribution = monthlyEquivalentContribution(params.cashflowAmount, params.cashflowFreq)
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      totalInvested: r.totalInvested,
      finalValue: r.finalValue,
      cagr,
      monthlyContribution,
    }
  }), [validResults])

  const monteCarloData = useMemo(() => validResults.map(r => {
    const params = r.simulationInputs!.params
    const monthlyContribution = monthlyEquivalentContribution(params.cashflowAmount, params.cashflowFreq)
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      finalValue: r.finalValue,
      monthlyContribution,
      cumulative: r.cumulative,
      cagr: dcaCagr(r.cumulative),
    }
  }), [validResults])

  const rollingReturnData = useMemo(() => validResults.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    cumulative: r.cumulative,
  })), [validResults])

  // ── Format helpers ──
  function formatDate(dateStr: string): string {
    const [y, m, d] = dateStr.split('-')
    return `${d}/${m}/${y}`
  }

  // ── Render ──
  const effectiveDates = getEffectiveDates()
  return (
    <div className="simulation-panel dca-panel">
      <div className="panel-header">
        <h2>Tích Lũy Định Kỳ (DCA)</h2>
        <ShareButton getUrl={() => buildDcaUrl({
          initialAmount, cashflowAmount, cashflowFreq,
          dateMode, yearsBack, dateFrom, dateTo,
          portfolios: portfolios.map(p => ({
            slots: p.slots, rebalFreq: p.rebalFreq,
            name: p.isNameCustom ? p.name : undefined,
          })),
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
            <label className="dca-label">Từ ngày đến ngày</label>
            <div className="dca-date-inputs">
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
              />
              <span className="dca-date-sep">→</span>
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

        {/* DCA Cash Flow subsection — mặc định 0, tức là mô phỏng đầu tư 1 lần */}
        <div className="dca-subsection">
          <h4 className="dca-subsection-title">Dòng Tiền DCA</h4>
          <p className="dca-subsection-hint">
            Để 0 nếu chỉ muốn mô phỏng đầu tư 1 lần. Nhập số tiền nếu muốn lên kế hoạch DCA định kỳ.
          </p>

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
        </div>

        <p className="dca-note">
          * Thời gian đầu, các quỹ cập nhật thông tin giá vào các ngày khác nhau. Trong trường hợp này, hệ thống sẽ tự chọn giá vào ngày giao dịch cuối cùng trong tuần.
        </p>
      </div>

      {/* ── Portfolio Cards ── */}
      <div className="dca-portfolios-card">
        <div className="dca-portfolios-card-header">
          <h3 className="dca-section-title">Danh mục</h3>
          {portfolios.length < MAX_PORTFOLIOS && (
            <button className="dca-add-portfolio-btn" onClick={addPortfolio}>
              + Thêm Danh Mục
            </button>
          )}
        </div>
        <div className="dca-portfolio-grid">
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
        </div>
      </div>

      {/* Run button */}
      {portfolios.length > 0 && (
        <div className="btc-run-row">
          <button
            className="sim-run-btn"
            onClick={runSimulation}
            disabled={!canRun}
          >
            {committed ? 'Chạy lại DCA' : 'Chạy DCA'}
          </button>
          {isDirty && (
            <span className="btc-run-hint">
              Thông số đã thay đổi, bấm "Chạy lại DCA" để cập nhật biểu đồ.
            </span>
          )}
        </div>
      )}

      <DataQualityBlock
        fundIds={dataQualityFundIds}
        fundData={fundData}
        colors={FUND_COLORS}
        dateFrom={effectiveDates.from || null}
        dateTo={effectiveDates.to || null}
        alignedStart={dataQualityAlignedRange?.start}
        alignedEnd={dataQualityAlignedRange?.end}
      />

      <GoldLotWarningBlock
        portfolios={portfolios}
        initialAmount={initialAmount}
        cashflowAmount={cashflowAmount}
        funds={funds}
        purchasePriceData={purchasePriceData}
        dateFrom={effectiveDates.from}
        dateTo={effectiveDates.to}
      />

      {/* Chọn section kết quả muốn xem (kiểu hl.eco) */}
      {validResults.length > 0 && (
        <div className="dca-anchor-nav">
          {DCA_SECTIONS.map(s => (
            <button
              key={s.id}
              className={`dca-anchor-btn${activeSection === s.id ? ' dca-anchor-btn--active' : ''}`}
              onClick={() => setActiveSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {isLoading && <div className="loading-indicator">Đang tải dữ liệu...</div>}

      {!isLoading && dataError && (
        <div className="error-banner">{dataError}</div>
      )}

      {/* Error when no results */}
      {committed && committed.params.portfolios.length > 0 && validResults.length === 0 && !isLoading && !dataError && (
        <div className="error-banner">
          Không đủ dữ liệu để tính toán. Hãy chọn khoảng thời gian dài hơn hoặc chọn "Tất cả".
        </div>
      )}

      {/* ── Results ──
          Mỗi section bọc trong div ẩn/hiện theo pill đang chọn. Dùng
          display:none (không unmount) để chuyển section không phải render
          lại các chart nặng. */}
      {validResults.length > 0 && (
        <>
          <div style={{ display: showSection('perf') }}>
            <div className="section-divider">
              <span className="section-divider-label">Hiệu suất đầu tư</span>
            </div>

            {/* Period info */}
            {startDate && endDate && (
              <div className="comparison-period" style={{ marginBottom: 16 }}>
                DCA từ {formatDate(startDate)} đến {formatDate(endDate)}
              </div>
            )}

            {/* Bảng thống kê: mỗi danh mục 1 hàng, các chỉ số nằm cạnh nhau để dễ so sánh. */}
            <DCAStatsTable
              portfolios={dcaStatsTableData}
            />

            {/* Portfolio Value Chart (MWRR): visual hook trước narrative */}
            <PortfolioValueChart
              portfolios={portfolioValueChartData}
            />

            {/* Tỷ số sức mạnh tương đối giữa 2 danh mục (chỉ hiện khi có từ 2 danh mục) */}
            {validResults.length >= 2 && (
              <DcaRatioChart portfolios={ratioChartData} />
            )}

            {/* Hiệu suất từng năm (Modified Dietz) — ngay dưới summary cards vì cùng
                trả lời câu hỏi "hiệu suất thực sự của tôi", trước khi đi vào giải thích chi tiết */}
            <EOYReturnsTable
              portfolios={journeyPortfolios}
            />

            {/* Giải thích CAGR vs MWRR (collapsible), ngay dưới summary cards để trả lời câu hỏi về 2 con số */}
            <DcaReturnExplainer
              portfolios={dcaReturnExplainerData}
            />
          </div>

          <div style={{ display: showSection('journey') }}>
            {/* Journey narrative */}
            {startDate && endDate && (
              <div className="section-divider">
                <span className="section-divider-label">Hành trình của bạn</span>
              </div>
            )}
            {startDate && endDate && (
              <DcaJourneyBlock
                portfolios={journeyPortfolios}
                startDate={startDate}
                endDate={endDate}
              />
            )}

            {/* Cổ tức & tái đầu tư (chỉ hiển thị khi danh mục có quỹ chia cổ tức như DCDE) */}
            {startDate && endDate && (
              <DividendBlock
                fundIds={dividendFundIds}
                dividendsByFund={committed!.data.dividendsByFund}
                startDate={startDate}
                endDate={endDate}
                narrativeByPortfolio={dividendNarrativeData}
              />
            )}

            {/* So sánh với gửi tiết kiệm */}
            {endDate && (
              <BankComparisonBlock
                results={bankComparisonData}
                endDate={endDate}
              />
            )}
          </div>

          <div style={{ display: showSection('risk') }}>
            {/* Kiên trì qua bão */}
            <div className="section-divider">
              <span className="section-divider-label">Rủi ro &amp; biến động</span>
            </div>

            {/* Tổng quan lợi nhuận đổi lấy rủi ro, trước khi đi vào chi tiết từng chart */}
            <DcaReturnPainChart portfolios={returnPainData} />

            <DcaHistoricalPercentileBlock portfolios={historicalPercentileData} />

            <DcaStormBlock
              portfolios={dcaStormData}
            />

            <DcaConsistencyBlock
              portfolios={dcaConsistencyData}
            />

            {/* Câu chuyện tiền thật ngày thật, trước khi vào phân phối xác suất (rolling) */}
            <DcaEntryPointBlock
              portfolios={entryPointPortfolios}
              fundData={committed!.data.fundData}
              purchasePriceData={committed!.data.purchasePriceData}
            />

            <RollingReturnBlock
              portfolios={rollingReturnData}
            />
          </div>

          <div style={{ display: showSection('endgame') }}>
            {/* Endgame: projection */}
            <div className="section-divider">
              <span className="section-divider-label">Endgame</span>
            </div>
            <ProjectionBlock
              portfolios={projectionData}
            />

            <MonteCarloBlock
              portfolios={monteCarloData}
            />
          </div>
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

// Memo hoá: App.tsx luôn mount cả 5 tab (ẩn bằng display:none), nên mỗi lần
// chuyển tab hoặc đổi state ở tab khác đều khiến App re-render. Không memo,
// component này (và toàn bộ chart bên trong) sẽ re-render/reconcile lại mỗi
// lần đó dù props không đổi — với dữ liệu daily (nhiều điểm hơn tuần 5-7 lần)
// chi phí này đủ lớn để gây "đơ" khi chuyển tab.
export const DCAPanel = memo(DCAPanelImpl)

