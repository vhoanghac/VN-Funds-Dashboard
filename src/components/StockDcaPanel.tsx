import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { MoneyInput } from './MoneyInput'
import { ShareButton } from './ShareButton'
import { PortfolioValueChart } from './PortfolioValueChart'
import { DrawdownChart } from './DrawdownChart'
import { DcaRecoveryChart } from './DcaRecoveryChart'
import { YearlyPerformanceChart } from './YearlyPerformanceChart'
import { DCAStatsTable } from './DCAStatsTable'
import { DcaHistoricalPercentileBlock } from './DcaHistoricalPercentileBlock'
import { DcaReturnPainChart } from './DcaReturnPainChart'
import { DcaReturnExplainer } from './DcaReturnExplainer'
import { DcaJourneyBlock, EOYReturnsTable } from './DcaJourneyBlock'
import { DcaStormBlock } from './DcaStormBlock'
import { RollingReturnBlock } from './RollingReturnBlock'
import { ProjectionBlock } from './ProjectionBlock'
import { MonteCarloBlock } from './MonteCarloBlock'
import { BankComparisonBlock } from './BankComparisonBlock'
import { DcaBlock, DcaSectionPanel } from './DcaLayout'
import { DcaAllocationBlock } from './DcaAllocationBlock'
import { DataQualityBlock } from './DataQualityBlock'
import { StockAnnualDividendsBlock } from './StockAnnualDividendsBlock'
import { StockShareHoldingsBlock } from './StockShareHoldingsBlock'
import { StockPositionValueChart } from './StockPositionValueChart'
import { PortfolioCard, MAX_FUNDS_PER_PORTFOLIO, MAX_PORTFOLIOS, PORTFOLIO_COLORS } from './PortfolioCard'
import { useCommittedRun } from '../hooks/useCommittedRun'
import { useSharePersistence } from '../hooks/useSharePersistence'
import { loadStockData, type PendingCorporateAction, type StockData } from '../data/stockData'
import {
  dcaCagr,
  dcaMWRR,
  dcaYearlyMWRR,
  investorCagr,
  monthlyEquivalentContribution,
  derivePortfolioName,
  DEFAULT_TRANSACTION_COST_RATES,
  normalizeAnnualContributionIncreaseAmount,
  normalizeDCAContributionSchedule,
  normalizeTransactionCostRates,
  type DCAContributionPhase,
  type DCAFrequency,
} from '../utils/dca'
import type { Portfolio, PortfolioCardState, ReturnPoint, TransactionCostRates } from '../types'
import { parsePortfolios } from '../utils/portfolio'
import { saveLS } from '../utils/localStorage'
import { avgDrawdown, annualizedStdevFromCumulative, longestDrawdownDays } from '../utils/drawdownStats'
import { generateStockContributions, type CorporateAction } from '../utils/stockAccountDca'
import { simulateStockPortfolioDca, type StockPortfolioDcaResult, type StockPortfolioPositionPoint, type StockPortfolioValuePoint } from '../utils/stockPortfolioDca'
import { annualStockDividends, filterStockPrices, presentStockPortfolioDcaResult, stockShareHoldings, type StockAnnualDividendPoint, type StockDcaPresentation } from '../utils/stockDcaPresentation'
import { buildStockDcaUrl, type ShareUrlState, type StockDcaShareState } from '../utils/shareUrl'
import { yearsBackDateRange } from '../utils/dateRange'

interface StockOption {
  id: string
  label: string
  load: () => Promise<StockData>
}

const STOCK_OPTIONS: StockOption[] = [
  { id: 'ACB', label: 'ACB · Ngân hàng Á Châu', load: () => loadStockData('ACB') },
  { id: 'BID', label: 'BID · BIDV', load: () => loadStockData('BID') },
  { id: 'BMP', label: 'BMP · Nhựa Bình Minh', load: () => loadStockData('BMP') },
  { id: 'BWE', label: 'BWE · Nước Bình Dương', load: () => loadStockData('BWE') },
  { id: 'CHP', label: 'CHP · Thủy điện miền Trung', load: () => loadStockData('CHP') },
  { id: 'CTG', label: 'CTG · VietinBank', load: () => loadStockData('CTG') },
  { id: 'DVP', label: 'DVP · Cảng Đình Vũ', load: () => loadStockData('DVP') },
  { id: 'FPT', label: 'FPT · Tập đoàn FPT', load: () => loadStockData('FPT') },
  { id: 'GEE', label: 'GEE · GELEX Electric', load: () => loadStockData('GEE') },
  { id: 'HDB', label: 'HDB · HDBank', load: () => loadStockData('HDB') },
  { id: 'MBB', label: 'MBB · Ngân hàng Quân đội', load: () => loadStockData('MBB') },
  { id: 'MSB', label: 'MSB · Ngân hàng Hàng Hải', load: () => loadStockData('MSB') },
  { id: 'NT2', label: 'NT2 · Điện NT2', load: () => loadStockData('NT2') },
  { id: 'NTP', label: 'NTP · Nhựa Tiền Phong', load: () => loadStockData('NTP') },
  { id: 'PC1', label: 'PC1 · Tập đoàn PC1', load: () => loadStockData('PC1') },
  { id: 'POW', label: 'POW · PV Power', load: () => loadStockData('POW') },
  { id: 'QNS', label: 'QNS · Đường Quảng Ngãi', load: () => loadStockData('QNS') },
  { id: 'REE', label: 'REE · Cơ điện lạnh', load: () => loadStockData('REE') },
  { id: 'SLS', label: 'SLS · Mía đường Sơn La', load: () => loadStockData('SLS') },
  { id: 'STB', label: 'STB · Sacombank', load: () => loadStockData('STB') },
  { id: 'TCB', label: 'TCB · Techcombank', load: () => loadStockData('TCB') },
  { id: 'TCL', label: 'TCL · Vận tải TCL', load: () => loadStockData('TCL') },
  { id: 'TDM', label: 'TDM · Nước Thủ Dầu Một', load: () => loadStockData('TDM') },
  { id: 'VCB', label: 'VCB · Vietcombank', load: () => loadStockData('VCB') },
  { id: 'VCS', label: 'VCS · Vicostone', load: () => loadStockData('VCS') },
  { id: 'VEA', label: 'VEA · VEAM', load: () => loadStockData('VEA') },
  { id: 'VIB', label: 'VIB · Ngân hàng Quốc tế', load: () => loadStockData('VIB') },
  { id: 'VNM', label: 'VNM · Vinamilk', load: () => loadStockData('VNM') },
  { id: 'VPB', label: 'VPB · VPBank', load: () => loadStockData('VPB') },
]

const STOCK_COLOR = '#a8512f'
const STOCK_POSITION_COLORS = ['#a8512f', '#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#4d7c0f']
const OPEN_ENDED_DATE = '9999-12-31'
const INITIAL_AMOUNT = 5_000_000
const DEFAULT_PHASES: DCAContributionPhase[] = [{ amount: 5_000_000, freq: 'monthly', until: null }]
const FREQ_OPTIONS: { value: DCAFrequency; label: string }[] = [
  { value: 'daily', label: 'Hàng ngày' },
  { value: 'weekly', label: '1 tuần' },
  { value: 'biweekly', label: '2 tuần' },
  { value: 'monthly', label: '1 tháng' },
  { value: 'quarterly', label: '1 quý' },
  { value: 'semiannual', label: '6 tháng' },
  { value: 'yearly', label: '1 năm' },
]

type DateRangeMode = 'all' | 'years'
type StockSectionId = 'summary' | 'perf' | 'allocation' | 'journey' | 'risk' | 'drawdowns' | 'endgame'

const STOCK_SECTIONS: { id: StockSectionId; label: string }[] = [
  { id: 'summary', label: 'Tóm Tắt' },
  { id: 'perf', label: 'Hiệu suất đầu tư' },
  { id: 'drawdowns', label: 'Mức sụt giảm' },
  { id: 'journey', label: 'Cổ tức' },
  { id: 'risk', label: 'Rủi ro & biến động' },
  { id: 'allocation', label: 'Phân bổ' },
  { id: 'endgame', label: 'Endgame' },
]

const ALL_RISK_PORTFOLIOS = '__all__'
const ALL_STOCK_POSITIONS = '__all__'
const ALL_PERFORMANCE_SCOPE = '__all__'

const MemoDrawdownChart = memo(DrawdownChart)
const MemoYearlyPerformanceChart = memo(YearlyPerformanceChart)

interface StockRunParams {
  dateMode: DateRangeMode
  yearsBack: number
  dateFrom: string
  dateTo: string
  initialAmount: number
  phases: DCAContributionPhase[]
  annualContributionIncreaseAmount: number
  portfolios: StockPortfolioState[]
}

interface StockSnapshot {
  params: StockRunParams
  data: Map<string, StockData>
}

type StockPortfolioState = PortfolioCardState & {
  transactionCostRates: TransactionCostRates
}

interface Props {
  active: boolean
  shareUrl: ShareUrlState<Partial<StockDcaShareState>>
}

interface StockView {
  id: string
  name: string
  color: string
  result: StockPortfolioDcaResult
  presentation: StockDcaPresentation
  /** TWRR khi bỏ toàn bộ phí giao dịch mô phỏng — dùng tách phần phí ăn mòn. */
  grossCumulative: ReturnPoint[]
  prices: StockData['prices']
  pricesByStock: Map<string, StockData['prices']>
  actionsByStock: Map<string, CorporateAction[]>
  pendingActionsByStock: Map<string, PendingCorporateAction[]>
  allPricesByStock: Map<string, StockData['prices']>
  allActionsByStock: Map<string, CorporateAction[]>
  params: StockRunParams
  portfolio: StockPortfolioState
}

interface StockRunResult {
  views: StockView[]
  noCommonRange: boolean
}

function hydrateStockPortfolios(source: Portfolio[], nextIdRef: { current: number }): StockPortfolioState[] {
  const usedNames = new Set<string>()
  return source.map(portfolio => {
    const num = nextIdRef.current++
    const baseName = portfolio.name || derivePortfolioName(portfolio.slots, `Portfolio ${num}`)
    const name = uniquePortfolioName(baseName, usedNames)
    usedNames.add(name)
    return {
      id: `stock${num}`,
      num,
      name,
      isNameCustom: !!portfolio.name,
      slots: portfolio.slots,
      rebalFreq: portfolio.rebalFreq,
      transactionCostRates: normalizeTransactionCostRates(portfolio.transactionCostRates),
    }
  })
}

function uniquePortfolioName(baseName: string, usedNames: Set<string>): string {
  if (!usedNames.has(baseName)) return baseName
  let suffix = 2
  while (usedNames.has(`${baseName} ${suffix}`)) suffix += 1
  return `${baseName} ${suffix}`
}

function hydrateStockPhases(source: unknown): DCAContributionPhase[] {
  const phases = normalizeDCAContributionSchedule(source)
  return phases.length > 0 ? clonePhases(phases) : clonePhases(DEFAULT_PHASES)
}

function getEffectiveDates(dateMode: DateRangeMode, yearsBack: number, dateFrom: string, dateTo: string): { from: string; to: string } {
  if (dateMode === 'years') {
    return yearsBackDateRange(yearsBack)
  }
  return { from: dateFrom, to: dateTo }
}

function StockDcaPanelImpl({ active, shareUrl }: Props) {
  const {
    parsedPayload: initialUrlParams,
    hasExplicitPayload,
    skipUrlPersist,
    readLocal,
  } = useSharePersistence({ source: shareUrl })
  const nextIdRef = useRef(1)
  const [portfolios, setPortfolios] = useState<StockPortfolioState[]>(() => {
    const source = initialUrlParams?.portfolios !== undefined
      ? initialUrlParams.portfolios
      : hasExplicitPayload ? [] : parsePortfolios(readLocal<unknown>('stockdca_portfolios', null))
    return hydrateStockPortfolios(source, nextIdRef)
  })
  const [stockData, setStockData] = useState<Map<string, StockData>>(new Map())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dateMode, setDateMode] = useState<DateRangeMode>(initialUrlParams?.dateMode ?? (hasExplicitPayload ? 'all' : readLocal('stockdca_dateMode', 'all' as DateRangeMode)))
  const [yearsBack, setYearsBack] = useState(initialUrlParams?.yearsBack ?? (hasExplicitPayload ? 5 : readLocal('stockdca_yearsBack', 5)))
  const [dateFrom, setDateFrom] = useState(initialUrlParams?.dateFrom ?? (hasExplicitPayload ? '' : readLocal('stockdca_dateFrom', '')))
  const [dateTo, setDateTo] = useState(initialUrlParams?.dateTo ?? (hasExplicitPayload ? '' : readLocal('stockdca_dateTo', '')))
  const [initialAmount, setInitialAmount] = useState(initialUrlParams?.initialAmount ?? (hasExplicitPayload ? INITIAL_AMOUNT : readLocal('stockdca_initialAmount', INITIAL_AMOUNT)))
  const [phases, setPhases] = useState<DCAContributionPhase[]>(() => hydrateStockPhases(
    initialUrlParams?.cashflowSchedule ?? (hasExplicitPayload ? null : readLocal<unknown>('stockdca_cashflowSchedule', null)),
  ))
  const [annualContributionIncreaseAmount, setAnnualContributionIncreaseAmount] = useState(() => normalizeAnnualContributionIncreaseAmount(
    initialUrlParams?.annualContributionIncreaseAmount ?? (hasExplicitPayload ? 0 : readLocal('stockdca_annualContributionIncreaseAmount', 0)),
  ))

  const stockIds = useMemo(
    () => Array.from(new Set(portfolios.flatMap(portfolio => portfolio.slots.map(slot => slot.fundId).filter(Boolean)))),
    [portfolios],
  )
  const stockIdsKey = stockIds.join(',')

  useEffect(() => {
    let active = true
    if (stockIds.length === 0) {
      setStockData(new Map())
      setLoadError(null)
      return () => { active = false }
    }
    setStockData(new Map())
    setLoadError(null)
    Promise.all(stockIds.map(async stockId => {
      const option = STOCK_OPTIONS.find(item => item.id === stockId)
      if (!option) return { stockId, error: new Error(`Không tải được dữ liệu ${stockId}`) }
      try {
        return { stockId, data: await option.load() }
      } catch (error) {
        return { stockId, error }
      }
    }))
      .then(entries => {
        if (!active) return
        const loaded = entries.filter((entry): entry is { stockId: string; data: StockData } => 'data' in entry)
        const failed = entries.filter((entry): entry is { stockId: string; error: unknown } => 'error' in entry)
        setStockData(new Map(loaded.map(entry => [entry.stockId, entry.data])))
        if (failed.length > 0) {
          const messages = failed.map(entry => entry.error instanceof Error ? entry.error.message : `Không tải được dữ liệu ${entry.stockId}`)
          setLoadError(messages.join('; '))
        }
      })
    return () => { active = false }
  }, [stockIdsKey])

  const liveDates = getEffectiveDates(dateMode, yearsBack, dateFrom, dateTo)
  const liveParams: StockRunParams = {
    dateMode,
    yearsBack,
    dateFrom: liveDates.from,
    dateTo: liveDates.to,
    initialAmount: Math.max(0, initialAmount),
    phases: clonePhases(phases),
    annualContributionIncreaseAmount: normalizeAnnualContributionIncreaseAmount(annualContributionIncreaseAmount),
    portfolios: portfolios.map(portfolio => ({ ...portfolio, slots: portfolio.slots.map(slot => ({ ...slot })) })),
  }

  const scheduleError = cashflowScheduleError(phases)
  const dateRangeError = dateMode === 'all' && !!dateFrom && !!dateTo && dateFrom > dateTo
  const portfolioError = portfolios.some(portfolio => {
    const activeSlots = portfolio.slots.filter(slot => slot.fundId && slot.weight > 0)
    const totalWeight = activeSlots.reduce((sum, slot) => sum + slot.weight, 0)
    return activeSlots.length === 0 || Math.abs(totalWeight - 100) > 0.01 || new Set(activeSlots.map(slot => slot.fundId)).size !== activeSlots.length
  })
  const committedRun = useCommittedRun<StockRunParams, StockSnapshot, StockRunResult>({
    ready: stockIds.length > 0 && (stockIds.every(stockId => stockData.has(stockId)) || !!loadError),
    valid: portfolios.length > 0 && !portfolioError && !scheduleError && !dateRangeError,
    liveParams,
    captureSnapshot: () => ({
      params: {
        ...liveParams,
        phases: clonePhases(liveParams.phases),
        portfolios: liveParams.portfolios.map(portfolio => ({ ...portfolio, slots: portfolio.slots.map(slot => ({ ...slot })) })),
      },
      data: new Map(stockData),
    }),
    compute: snapshot => {
      const { params } = snapshot
      const allStockIds = Array.from(new Set(params.portfolios.flatMap(portfolio => portfolio.slots.map(slot => slot.fundId).filter(Boolean))))
      const globalStart = params.dateFrom || ''
      const globalEnd = params.dateTo || OPEN_ENDED_DATE

      const filteredPricesByStock = new Map<string, StockData['prices']>()
      for (const stockId of allStockIds) {
        const data = snapshot.data.get(stockId)
        filteredPricesByStock.set(stockId, data ? filterStockPrices(data.prices, globalStart, globalEnd) : [])
      }
      const availableStockIds = allStockIds.filter(stockId => (filteredPricesByStock.get(stockId)?.length ?? 0) > 0)
      if (availableStockIds.length === 0) return { views: [], noCommonRange: false }

      const commonStart = availableStockIds
        .map(stockId => filteredPricesByStock.get(stockId)![0]!.date)
        .reduce((latest, date) => latest > date ? latest : date)
      const commonEnd = availableStockIds
        .map(stockId => {
          const prices = filteredPricesByStock.get(stockId)!
          return prices[prices.length - 1]!.date
        })
        .reduce((earliest, date) => earliest < date ? earliest : date)
      if (commonStart > commonEnd) return { views: [], noCommonRange: true }

      const views: StockView[] = []
      for (const [portfolioIndex, portfolio] of params.portfolios.entries()) {
        const activeSlots = portfolio.slots.filter(slot => slot.fundId && slot.weight > 0)
        if (activeSlots.length === 0) continue
        const pricesByStock = new Map<string, StockData['prices']>()
        const actionsByStock = new Map<string, CorporateAction[]>()
        const pendingActionsByStock = new Map<string, PendingCorporateAction[]>()
        for (const slot of activeSlots) {
          const data = snapshot.data.get(slot.fundId)
          const prices = filteredPricesByStock.get(slot.fundId)?.filter(point => point.date >= commonStart && point.date <= commonEnd)
          if (!data || !prices || prices.length === 0) continue
          pricesByStock.set(slot.fundId, prices)
          const firstDate = prices[0]!.date
          const lastDate = prices[prices.length - 1]!.date
          actionsByStock.set(slot.fundId, data.corporateActions.filter(action => action.exDate >= firstDate && action.exDate <= lastDate))
          pendingActionsByStock.set(slot.fundId, data.pendingCorporateActions.filter(action => action.exDate >= firstDate && action.exDate <= lastDate))
        }
        if (pricesByStock.size !== activeSlots.length) continue
        const prices = commonStockPrices(pricesByStock)
        if (prices.length === 0) continue
        const contributions = generateStockContributions(prices, {
          initialAmount: params.initialAmount,
          phases: params.phases,
          annualContributionIncreaseAmount: params.annualContributionIncreaseAmount,
        })
        const result = simulateStockPortfolioDca({
          pricesByStock,
          slots: activeSlots,
          contributions,
          corporateActionsByStock: actionsByStock,
          rebalFreq: portfolio.rebalFreq,
          transactionCostRates: portfolio.transactionCostRates,
          lotSize: 1,
        })
        const grossResult = simulateStockPortfolioDca({
          pricesByStock,
          slots: activeSlots,
          contributions,
          corporateActionsByStock: actionsByStock,
          rebalFreq: portfolio.rebalFreq,
          transactionCostRates: { buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0 },
          lotSize: 1,
        })
        views.push({
          id: portfolio.id,
          name: portfolio.name,
          color: PORTFOLIO_COLORS[portfolioIndex % PORTFOLIO_COLORS.length] ?? STOCK_COLOR,
          result,
          presentation: presentStockPortfolioDcaResult(result),
          grossCumulative: grossResult.twrrCumulative,
          prices,
          pricesByStock,
          actionsByStock,
          pendingActionsByStock,
          allPricesByStock: new Map(activeSlots.map(slot => [slot.fundId, snapshot.data.get(slot.fundId)!.prices])),
          allActionsByStock: new Map(activeSlots.map(slot => [slot.fundId, snapshot.data.get(slot.fundId)!.corporateActions])),
            params,
            portfolio,
          })
      }
      return { views, noCommonRange: false }
    },
  })

  const {
    committed,
    result: stockRun,
    dirty: isDirty,
    run: runCommitted,
    reset: resetCommitted,
  } = committedRun
  const views = stockRun?.views
  const noCommonRange = stockRun?.noCommonRange ?? false
  const stockDataLoading = stockIds.length > 0 && stockIds.some(stockId => !stockData.has(stockId)) && !loadError
  const stockPriceData = useMemo(
    () => new Map<string, StockData['prices']>(Array.from(stockData, ([stockId, data]) => [stockId, data.prices])),
    [stockData],
  )
  const dataQualityAlignedRange = useMemo(() => {
    if (!views || views.length === 0 || views.length !== portfolios.length) return null
    const starts = views.map(view => view.prices[0]?.date).filter((date): date is string => !!date)
    const ends = views.map(view => view.prices[view.prices.length - 1]?.date).filter((date): date is string => !!date)
    if (starts.length === 0 || ends.length === 0) return null
    return {
      start: starts.reduce((a, b) => (a > b ? a : b)),
      end: ends.reduce((a, b) => (a < b ? a : b)),
    }
  }, [views])
  const missingPortfolioNames = committed && views
    ? committed.params.portfolios
      .filter(portfolio => !views.some(view => view.id === portfolio.id))
      .map(portfolio => portfolio.name)
    : []
  const dataQualityAlignmentStatus = committed && !isDirty
    ? {
        hasCommonRange: !noCommonRange && !!views && views.length > 0,
        validPointCount: views && views.length > 0 ? Math.min(...views.map(view => view.prices.length)) : 0,
        excludedPortfolioCount: missingPortfolioNames.length,
      }
    : undefined

  const lastShareKeyRef = useRef(shareUrl.key)
  useEffect(() => {
    if (shareUrl.key === lastShareKeyRef.current) return
    lastShareKeyRef.current = shareUrl.key
    if (!hasExplicitPayload && !active) return

    const params = shareUrl.parsedPayload
    nextIdRef.current = 1
    const localPortfolios = parsePortfolios(readLocal<unknown>('stockdca_portfolios', null))
    setPortfolios(hydrateStockPortfolios(params?.portfolios ?? (hasExplicitPayload ? [] : localPortfolios), nextIdRef))
    setDateMode(params?.dateMode ?? (hasExplicitPayload ? 'all' : readLocal('stockdca_dateMode', 'all' as DateRangeMode)))
    setYearsBack(params?.yearsBack ?? (hasExplicitPayload ? 5 : readLocal('stockdca_yearsBack', 5)))
    setDateFrom(params?.dateFrom ?? (hasExplicitPayload ? '' : readLocal('stockdca_dateFrom', '')))
    setDateTo(params?.dateTo ?? (hasExplicitPayload ? '' : readLocal('stockdca_dateTo', '')))
    setInitialAmount(params?.initialAmount ?? (hasExplicitPayload ? INITIAL_AMOUNT : readLocal('stockdca_initialAmount', INITIAL_AMOUNT)))
    setPhases(hydrateStockPhases(params?.cashflowSchedule ?? (hasExplicitPayload ? null : readLocal<unknown>('stockdca_cashflowSchedule', null))))
    setAnnualContributionIncreaseAmount(normalizeAnnualContributionIncreaseAmount(
      params?.annualContributionIncreaseAmount ?? (hasExplicitPayload ? 0 : readLocal('stockdca_annualContributionIncreaseAmount', 0)),
    ))
    resetCommitted()
  }, [shareUrl.key, active]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!skipUrlPersist) saveLS('stockdca_dateMode', dateMode) }, [dateMode, skipUrlPersist])
  useEffect(() => { if (!skipUrlPersist) saveLS('stockdca_yearsBack', yearsBack) }, [yearsBack, skipUrlPersist])
  useEffect(() => { if (!skipUrlPersist) saveLS('stockdca_dateFrom', dateFrom) }, [dateFrom, skipUrlPersist])
  useEffect(() => { if (!skipUrlPersist) saveLS('stockdca_dateTo', dateTo) }, [dateTo, skipUrlPersist])
  useEffect(() => { if (!skipUrlPersist) saveLS('stockdca_initialAmount', initialAmount) }, [initialAmount, skipUrlPersist])
  useEffect(() => {
    if (!skipUrlPersist) saveLS('stockdca_cashflowSchedule', phases)
  }, [phases, skipUrlPersist])
  useEffect(() => {
    if (!skipUrlPersist) saveLS('stockdca_annualContributionIncreaseAmount', annualContributionIncreaseAmount)
  }, [annualContributionIncreaseAmount, skipUrlPersist])
  useEffect(() => {
    if (!skipUrlPersist) saveLS('stockdca_portfolios', portfolios.map(portfolio => ({
      slots: portfolio.slots,
      rebalFreq: portfolio.rebalFreq,
      name: portfolio.isNameCustom ? portfolio.name : undefined,
      transactionCostRates: portfolio.transactionCostRates,
    })))
  }, [portfolios, skipUrlPersist])

  function addPortfolio() {
    if (portfolios.length >= MAX_PORTFOLIOS) return
    const num = nextIdRef.current++
    const slots = [{ fundId: STOCK_OPTIONS[0]?.id ?? '', weight: 100 }]
    setPortfolios(current => {
      const usedNames = new Set(current.map(portfolio => portfolio.name))
      return [...current, {
        id: `stock${num}`,
        num,
        name: uniquePortfolioName(derivePortfolioName(slots, `Portfolio ${num}`), usedNames),
        isNameCustom: false,
        slots,
        rebalFreq: 'yearly',
        transactionCostRates: { ...DEFAULT_TRANSACTION_COST_RATES },
      }]
    })
  }

  function removePortfolio(id: string) {
    setPortfolios(current => current.filter(portfolio => portfolio.id !== id))
  }

  function updatePortfolio(id: string, update: Partial<StockPortfolioState>) {
    setPortfolios(current => current.map(portfolio => portfolio.id === id ? { ...portfolio, ...update } : portfolio))
  }

  function addSlot(portfolioId: string) {
    setPortfolios(current => current.map(portfolio => {
      if (portfolio.id !== portfolioId || portfolio.slots.length >= MAX_FUNDS_PER_PORTFOLIO) return portfolio
      const used = new Set(portfolio.slots.map(slot => slot.fundId))
      const available = STOCK_OPTIONS.find(option => !used.has(option.id))
      const slots = [...portfolio.slots, { fundId: available?.id ?? '', weight: 0 }]
      return portfolio.isNameCustom ? { ...portfolio, slots } : { ...portfolio, slots, name: derivePortfolioName(slots, `Portfolio ${portfolio.num}`) }
    }))
  }

  function removeSlot(portfolioId: string, index: number) {
    setPortfolios(current => current.map(portfolio => {
      if (portfolio.id !== portfolioId || portfolio.slots.length <= 1) return portfolio
      const slots = portfolio.slots.filter((_, slotIndex) => slotIndex !== index)
      return portfolio.isNameCustom ? { ...portfolio, slots } : { ...portfolio, slots, name: derivePortfolioName(slots, `Portfolio ${portfolio.num}`) }
    }))
  }

  function updateSlot(portfolioId: string, index: number, update: Partial<StockPortfolioState['slots'][number]>) {
    setPortfolios(current => current.map(portfolio => {
      if (portfolio.id !== portfolioId) return portfolio
      const slots = portfolio.slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...update } : slot)
      return portfolio.isNameCustom ? { ...portfolio, slots } : { ...portfolio, slots, name: derivePortfolioName(slots, `Portfolio ${portfolio.num}`) }
    }))
  }

  function setEqualWeights(portfolioId: string) {
    setPortfolios(current => current.map(portfolio => portfolio.id === portfolioId
      ? { ...portfolio, slots: portfolio.slots.map((slot, index, slots) => {
        const baseWeight = Math.floor(100 / slots.length)
        return { ...slot, weight: baseWeight + (index < 100 - baseWeight * slots.length ? 1 : 0) }
      }) }
      : portfolio,
    ))
  }

  function runSimulation() {
    runCommitted()
  }

  function updatePhase(index: number, update: Partial<DCAContributionPhase>) {
    setPhases(current => current.map((phase, phaseIndex) => phaseIndex === index ? { ...phase, ...update } : phase))
  }

  function togglePhaseUntil(index: number, enabled: boolean) {
    setPhases(current => {
      if (!enabled) return current.slice(0, index + 1).map((phase, phaseIndex) => phaseIndex === index ? { ...phase, until: null } : phase)
      const updated = current.map((phase, phaseIndex) => phaseIndex === index ? { ...phase, until: '' } : phase)
      return index < current.length - 1 ? updated : [...updated, { amount: 0, freq: current[index]!.freq, until: null }]
    })
  }

  return (
    <PanelShell>
      <div className="panel-header">
        <h2>Tích Lũy Cổ Phiếu</h2>
        <ShareButton disabled={!!scheduleError || dateRangeError} getUrl={() => buildStockDcaUrl({
          dateMode,
          yearsBack,
          dateFrom,
          dateTo,
          initialAmount: Math.max(0, initialAmount),
          portfolios: portfolios.map(portfolio => ({
            slots: portfolio.slots,
            rebalFreq: portfolio.rebalFreq,
            name: portfolio.isNameCustom ? portfolio.name : undefined,
            transactionCostRates: portfolio.transactionCostRates,
          })),
          cashflowSchedule: phases,
          annualContributionIncreaseAmount: normalizeAnnualContributionIncreaseAmount(annualContributionIncreaseAmount),
        })} />
      </div>

      <div className="dca-params-card">
        <h3 className="dca-title">Thông số</h3>
        <div className="dca-param-row">
          <label className="dca-label">Khoảng thời gian</label>
          <div className="dca-date-mode">
            <button className={`dca-choice-btn dca-mode-btn${dateMode === 'all' ? ' dca-choice-btn--active' : ''}`} onClick={() => setDateMode('all')}>Tất cả</button>
            <button className={`dca-choice-btn dca-mode-btn${dateMode === 'years' ? ' dca-choice-btn--active' : ''}`} onClick={() => setDateMode('years')}>X năm qua</button>
          </div>
        </div>
        {dateMode === 'years' && (
          <div className="dca-param-row dca-years-row">
            <label className="dca-label">Số năm</label>
            <div className="dca-years-selector">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(year => (
                <button key={year} className={`dca-choice-btn dca-year-btn${yearsBack === year ? ' dca-choice-btn--active' : ''}`} onClick={() => setYearsBack(year)}>{year}</button>
              ))}
            </div>
          </div>
        )}
        {dateMode === 'all' && (
          <div className="dca-param-row">
            <label className="dca-label">Từ ngày đến ngày</label>
            <div className="dca-date-inputs">
              <input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} />
              <span className="dca-date-sep">→</span>
              <input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} />
            </div>
          </div>
        )}
        <div className="dca-param-row">
          <label className="dca-label" htmlFor="stock-initial-amount">Số tiền đầu tiên</label>
          <div className="dca-amount-input"><MoneyInput id="stock-initial-amount" value={initialAmount} onChange={setInitialAmount} min={0} /><span className="dca-currency">₫</span></div>
        </div>

        <div className="dca-subsection">
          <h4 className="dca-title">Dòng Tiền DCA</h4>
          <p className="dca-subsection-hint">Để 0 nếu chỉ muốn mô phỏng đầu tư một lần. Nhập số tiền nếu muốn lên kế hoạch DCA định kỳ.</p>
          <div className="dca-param-row">
            <label className="dca-label">Mỗi năm tăng thêm tiền DCA</label>
            <div className="dca-amount-input"><MoneyInput value={annualContributionIncreaseAmount} onChange={setAnnualContributionIncreaseAmount} min={0} /><span className="dca-currency">₫</span></div>
          </div>
          {phases.length > 1 && <p className="dca-annual-increase-note">Khi có nhiều dòng tiền DCA thì mục tăng tiền DCA mỗi năm sẽ không được sử dụng để tính toán</p>}
          {phases.map((phase, index) => (
            <div className="dca-param-row dca-cashflow-row" key={`stock-phase-${index}`}>
              <label className="dca-label">{index === 0 ? 'Số tiền đầu tư định kỳ' : `Dòng tiền DCA ${index + 1}`}</label>
              <div className="dca-amount-input"><MoneyInput value={phase.amount} onChange={amount => updatePhase(index, { amount })} min={0} /><span className="dca-currency">₫</span></div>
              <label className="dca-label dca-freq-label">{index === 0 ? 'Tần suất đầu tư' : 'Tần suất'}</label>
              <select className="dca-freq-select" value={phase.freq} onChange={event => updatePhase(index, { freq: event.target.value as DCAFrequency })}>
                {FREQ_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <div className="dca-until-control">
                <label className="dca-until-toggle"><input type="checkbox" checked={phase.until !== null} onChange={event => togglePhaseUntil(index, event.target.checked)} /><span>Cho đến</span></label>
                {phase.until !== null && <input className="dca-until-date" type="date" value={phase.until} aria-label={`Ngày kết thúc dòng tiền DCA ${index + 1}`} onChange={event => updatePhase(index, { until: event.target.value })} />}
              </div>
            </div>
          ))}
          {scheduleError && <p className="dca-cashflow-error">{scheduleError}</p>}
        </div>

      <p className="dca-note">Thị trường cho mua lô lẻ nên mỗi kỳ dashboard đầu tư hết tiền. Tiền nạp chia theo tỷ trọng danh mục; cổ tức tiền của mã nào tái đầu tư vào chính mã đó. Phần chưa mua hết nằm lại trong tài khoản chờ kỳ sau.</p>
      </div>

      <div className="dca-portfolios-card">
        <div className="dca-portfolios-card-header">
          <h3 className="dca-title">Danh mục</h3>
          {portfolios.length < MAX_PORTFOLIOS && (
            <button className="dca-add-portfolio-btn" onClick={addPortfolio}>+ Thêm Danh Mục</button>
          )}
        </div>
        <div className="dca-portfolio-grid">
          {portfolios.map((portfolio, pIdx) => (
            <PortfolioCard
              key={portfolio.id}
              portfolio={portfolio}
              pIdx={pIdx}
              funds={[]}
              fundOptions={STOCK_OPTIONS.map(option => ({ value: option.id, label: option.label }))}
              assetLabel="cổ phiếu"
              maxSlots={Math.min(STOCK_OPTIONS.length, MAX_FUNDS_PER_PORTFOLIO)}
               showRebal
               transactionCostRates={portfolio.transactionCostRates}
               onTransactionCostRatesChange={transactionCostRates => updatePortfolio(portfolio.id, { transactionCostRates })}
              onUpdate={update => updatePortfolio(portfolio.id, update)}
              onRemove={() => removePortfolio(portfolio.id)}
              onAddSlot={() => addSlot(portfolio.id)}
              onRemoveSlot={index => removeSlot(portfolio.id, index)}
              onUpdateSlot={(idx, update) => updateSlot(portfolio.id, idx, update)}
              onSetEqualWeights={() => setEqualWeights(portfolio.id)}
            />
          ))}
        </div>
      </div>

      {portfolios.length > 0 && (
        <div className="btc-run-row">
          <button className="sim-run-btn" onClick={runSimulation} disabled={portfolioError || !!scheduleError || dateRangeError || (!!committed && !isDirty)}>
            {!committed ? 'Chạy DCA' : isDirty ? 'Chạy lại DCA' : 'Đã cập nhật'}
          </button>
          {isDirty && <span className="btc-run-hint">Thông số đã thay đổi, bấm nút để cập nhật biểu đồ.</span>}
        </div>
      )}

      <DataQualityBlock
        fundIds={stockIds}
        fundData={stockPriceData}
        colors={PORTFOLIO_COLORS}
        assetLabel="cổ phiếu"
        dateFrom={liveDates.from || null}
        dateTo={liveDates.to || null}
        alignedStart={!isDirty ? dataQualityAlignedRange?.start : undefined}
        alignedEnd={!isDirty ? dataQualityAlignedRange?.end : undefined}
        alignmentStatus={dataQualityAlignmentStatus}
        loading={stockDataLoading}
      />

      {stockDataLoading && <div className="loading-indicator">Đang tải chuỗi giá cổ phiếu...</div>}
      {loadError && <div className="error-banner">{loadError}</div>}

      {noCommonRange ? (
        <div className="error-banner">Các danh mục có dữ liệu, nhưng không cùng một khoảng ngày để so sánh.</div>
      ) : missingPortfolioNames.length > 0 && (
        <div className="error-banner">
          Không đủ dữ liệu giá trong khoảng đang chọn cho: {missingPortfolioNames.join(', ')}. Các danh mục còn lại vẫn hiển thị để bạn kiểm tra riêng.
        </div>
      )}
      {views && views.length > 0 ? <StockResults views={views} /> : committed && missingPortfolioNames.length === 0 ? (
        <div className="error-banner">Khoảng thời gian đang chọn chưa có dữ liệu giá cho danh mục nào.</div>
      ) : null}
    </PanelShell>
  )
}

function PanelShell({ children }: { children: ReactNode }) {
  return <div className="simulation-panel dca-panel stock-dca-panel">{children}</div>
}

const StockResults = memo(function StockResults({ views }: { views: StockView[] }) {
  const [activeSection, setActiveSection] = useState<StockSectionId>('summary')
  const [activePortfolioId, setActivePortfolioId] = useState(views[0]!.id)
  const [activeRiskPortfolioId, setActiveRiskPortfolioId] = useState('')
  const [activeStockId, setActiveStockId] = useState(ALL_STOCK_POSITIONS)
  const [perfScope, setPerfScope] = useState(ALL_PERFORMANCE_SCOPE)
  useEffect(() => {
    setActivePortfolioId(current => views.some(view => view.id === current) ? current : views[0]!.id)
  }, [views])
  useEffect(() => {
    if (activeRiskPortfolioId !== ALL_RISK_PORTFOLIOS && !views.some(view => view.id === activeRiskPortfolioId)) {
      setActiveRiskPortfolioId(views[0]?.id ?? '')
    }
  }, [activeRiskPortfolioId, views])

  const view = views.find(candidate => candidate.id === activePortfolioId) ?? views[0]!
  const riskPortfolioId = activeRiskPortfolioId || views[0]?.id
  const riskView = views.find(candidate => candidate.id === riskPortfolioId) ?? views[0]!
  const { result } = view
  // "Tất cả" chỉ có nghĩa khi danh mục có từ hai mã. Một mã thì luôn chọn chính nó.
  const showAllStocks = activeStockId === ALL_STOCK_POSITIONS && result.positions.length > 1
  const selectedPosition = showAllStocks
    ? undefined
    : (result.positions.find(position => position.stockId === activeStockId) ?? result.positions[0])
  const selectedPositionLastPoint = selectedPosition?.points[selectedPosition.points.length - 1]
  const selectedPositionInvested = selectedPositionLastPoint?.investedCash ?? 0
  useEffect(() => {
    setActiveStockId(current => current === ALL_STOCK_POSITIONS || result.positions.some(position => position.stockId === current) ? current : ALL_STOCK_POSITIONS)
  }, [result.positions])
  const annualDividends = useMemo(() => {
    if (!showAllStocks) return annualStockDividends(selectedPosition?.points ?? [])
    const byYear = new Map<number, StockAnnualDividendPoint>()
    for (const position of result.positions) {
      for (const row of annualStockDividends(position.points)) {
        const accumulated = byYear.get(row.year) ?? { year: row.year, cashVnd: 0, stockShares: 0, stockValueVnd: 0 }
        accumulated.cashVnd += row.cashVnd
        accumulated.stockShares += row.stockShares
        accumulated.stockValueVnd += row.stockValueVnd
        byYear.set(row.year, accumulated)
      }
    }
    return [...byYear.values()].sort((a, b) => a.year - b.year)
  }, [showAllStocks, selectedPosition, result.positions])
  const shareHoldings = useMemo(() => stockShareHoldings(selectedPosition?.points ?? []), [selectedPosition])
  const startDate = view.prices[0]!.date
  const endDate = view.prices[view.prices.length - 1]!.date
  const stats = useMemo(() => views.map(candidate => {
    const candidateResult = candidate.result
    const candidatePresentation = candidate.presentation
    return {
      id: candidate.id,
      name: candidate.name,
      color: candidate.color,
      finalValue: candidateResult.finalValue,
      totalInvested: candidateResult.totalContributed,
       transactionCosts: candidateResult.totalTransactionCosts,
      cagr: investorCagr(candidatePresentation.cumulative, candidateResult.totalContributed, candidateResult.finalValue),
      mwrr: dcaMWRR(candidateResult.cashflows),
      twrrNet: dcaCagr(candidatePresentation.cumulative),
      twrrGross: dcaCagr(candidate.grossCumulative),
      maxDrawdown: candidatePresentation.storm.maxDrawdown,
      avgDrawdown: avgDrawdown(candidatePresentation.drawdown),
      longestDrawdownDays: longestDrawdownDays(candidatePresentation.drawdown),
      stdev: annualizedStdevFromCumulative(candidatePresentation.cumulative),
      profitFactor: candidatePresentation.profitFactor,
    }
  }), [views])
  const valueChart = useMemo(() => views.map(candidate => ({ id: candidate.id, name: candidate.name, color: candidate.color, values: candidate.presentation.valueSeries, invested: candidate.presentation.investedSeries })), [views])
  const drawdownChart = useMemo(() => views.map(candidate => ({ name: candidate.name, color: candidate.color, data: candidate.presentation.drawdown })), [views])
  const journey = useMemo(() => views.map(candidate => ({ id: candidate.id, name: candidate.name, color: candidate.color, totalInvested: candidate.result.totalContributed, finalValue: candidate.result.finalValue, valueSeries: candidate.presentation.valueSeries, cashflows: candidate.result.cashflows })), [views])
  const yearly = useMemo(() => views.map(candidate => ({ id: candidate.id, name: candidate.name, color: candidate.color, data: dcaYearlyMWRR(candidate.presentation.valueSeries, candidate.result.cashflows).map(row => ({ year: row.year, value: row.value, isPartial: row.isPartial, isOpeningYear: row.isOpeningYear })) })), [views])
  const projection = useMemo(() => views.map(candidate => {
    const candidateCagr = dcaCagr(candidate.presentation.cumulative)
    const monthlyContribution = monthlyEquivalentContribution(candidate.params.phases[0]?.amount ?? 0, candidate.params.phases[0]?.freq ?? 'monthly')
    return { id: candidate.id, name: candidate.name, color: candidate.color, totalInvested: candidate.result.totalContributed, finalValue: candidate.result.finalValue, cagr: candidateCagr, monthlyContribution, monthlyContributionIncrease: candidate.params.phases.length > 1 ? 0 : monthlyEquivalentContribution(candidate.params.annualContributionIncreaseAmount, candidate.params.phases[0]?.freq ?? 'monthly'), cashflowSchedule: candidate.params.phases.length > 1 ? candidate.params.phases : undefined, projectionStartDate: endDate }
  }), [views, endDate])
  const monteCarlo = useMemo(() => views.map((candidate, index) => ({ ...projection[index]!, cumulative: candidate.presentation.cumulative })), [views, projection])
  const recoveryPortfolios = useMemo(() => views.map(candidate => ({ id: candidate.id, name: candidate.name, color: candidate.color, drawdown: candidate.presentation.drawdown })), [views])
  const returnExplainerPortfolios = useMemo(() => stats.map(row => ({ id: row.id, name: row.name, color: row.color, cagr: row.cagr, twrr: row.twrrNet, mwrr: row.mwrr })), [stats])
  const riskReturnPainPortfolios = useMemo(() => views.map(candidate => ({ id: candidate.id, name: candidate.name, color: candidate.color, finalValue: candidate.result.finalValue, totalInvested: candidate.result.totalContributed, maxDrawdown: candidate.presentation.storm.maxDrawdown * 100 })), [views])
  const riskHistoricalPortfolios = useMemo(() => views.map(candidate => ({ id: candidate.id, name: candidate.name, color: candidate.color, cumulative: candidate.presentation.cumulative })), [views])
  const drawdownPortfolios = useMemo(() => views.map(candidate => ({ id: candidate.id, name: candidate.name, color: candidate.color, assetCount: candidate.portfolio.slots.filter(slot => slot.weight > 0).length, storm: candidate.presentation.storm, drawdown: candidate.presentation.drawdown, valueSeries: candidate.presentation.valueSeries })), [views])
  const riskRollingPortfolios = useMemo(() => views.map(candidate => ({ id: candidate.id, name: candidate.name, color: candidate.color, cumulative: candidate.presentation.cumulative })), [views])
  const bankComparisonResults = useMemo(() => views.map(candidate => ({
    id: candidate.id,
    name: candidate.name,
    color: candidate.color,
    finalValue: candidate.result.finalValue,
    investedSeries: candidate.presentation.investedSeries,
  })), [views])
  const bankComparisonEndDate = views[0]!.prices[views[0]!.prices.length - 1]!.date
  // Bộ lọc Hiệu suất giữ theo id danh mục, không theo index/name. Id biến mất thì tự về "Tất cả",
  // và một danh mục duy nhất tự vào chế độ chi tiết mà không cần toolbar.
  const hasMultiplePortfolios = views.length > 1
  const effectivePerfScope = !hasMultiplePortfolios
    ? (views[0]?.id ?? ALL_PERFORMANCE_SCOPE)
    : (perfScope !== ALL_PERFORMANCE_SCOPE && views.some(candidate => candidate.id === perfScope) ? perfScope : ALL_PERFORMANCE_SCOPE)
  const perfView = effectivePerfScope === ALL_PERFORMANCE_SCOPE ? undefined : views.find(candidate => candidate.id === effectivePerfScope)
  const perfStats = useMemo(() => effectivePerfScope === ALL_PERFORMANCE_SCOPE ? stats : stats.filter(row => row.id === effectivePerfScope), [stats, effectivePerfScope])
  const perfValueChart = useMemo(() => effectivePerfScope === ALL_PERFORMANCE_SCOPE ? valueChart : valueChart.filter(series => series.id === effectivePerfScope), [valueChart, effectivePerfScope])
  const perfYearly = useMemo(() => effectivePerfScope === ALL_PERFORMANCE_SCOPE ? yearly : yearly.filter(series => series.id === effectivePerfScope), [yearly, effectivePerfScope])
  const perfJourney = useMemo(() => effectivePerfScope === ALL_PERFORMANCE_SCOPE ? journey : journey.filter(candidate => candidate.id === effectivePerfScope), [journey, effectivePerfScope])
  const perfBankComparison = useMemo(() => effectivePerfScope === ALL_PERFORMANCE_SCOPE ? bankComparisonResults : bankComparisonResults.filter(candidate => candidate.id === effectivePerfScope), [bankComparisonResults, effectivePerfScope])
  const perfReturnExplainer = useMemo(() => effectivePerfScope === ALL_PERFORMANCE_SCOPE ? returnExplainerPortfolios : returnExplainerPortfolios.filter(candidate => candidate.id === effectivePerfScope), [returnExplainerPortfolios, effectivePerfScope])
  const perfStockCharts = useMemo(() => perfView
    ? perfView.result.positions.map((position, index) => ({
        stockId: position.stockId,
        points: position.points,
        color: STOCK_POSITION_COLORS[index % STOCK_POSITION_COLORS.length] ?? STOCK_COLOR,
      }))
    : [], [perfView])
  const selectedJourney = useMemo(() => journey.filter(candidate => candidate.id === activePortfolioId), [activePortfolioId, journey])
   const selectedRiskReturnPainPortfolios = useMemo(() => riskReturnPainPortfolios.filter(candidate => candidate.id === riskPortfolioId), [riskPortfolioId, riskReturnPainPortfolios])
   const selectedRiskHistoricalPortfolios = useMemo(() => riskHistoricalPortfolios.filter(candidate => candidate.id === riskPortfolioId), [riskPortfolioId, riskHistoricalPortfolios])
   const selectedRiskRollingPortfolios = useMemo(() => riskRollingPortfolios.filter(candidate => candidate.id === riskPortfolioId), [riskPortfolioId, riskRollingPortfolios])
  const selectedDrawdownPortfolios = useMemo(() => drawdownPortfolios.filter(candidate => candidate.id === activePortfolioId), [activePortfolioId, drawdownPortfolios])
  const selectedProjection = useMemo(() => projection.filter(candidate => candidate.id === activePortfolioId), [activePortfolioId, projection])
  const selectedMonteCarlo = useMemo(() => monteCarlo.filter(candidate => candidate.id === activePortfolioId), [activePortfolioId, monteCarlo])
  const needsPortfolioFilter = (
    activeSection === 'journey'
    || activeSection === 'risk'
    || activeSection === 'drawdowns'
    || activeSection === 'endgame'
    || activeSection === 'perf'
  ) && !(activeSection === 'perf' && !hasMultiplePortfolios)
  const activeSectionLabel = STOCK_SECTIONS.find(section => section.id === activeSection)?.label ?? ''
  // Mọi section dùng chung một thanh lọc danh mục ngay dưới thanh nav, nhưng mỗi
  // section giữ state riêng: Rủi ro dùng riskPortfolioId, Hiệu suất dùng perfScope.
  const scopedPortfolioFilterId = activeSection === 'risk'
    ? riskPortfolioId
    : activeSection === 'perf'
      ? effectivePerfScope
      : activePortfolioId

  return (
    <>
      <div className="dca-results-surface stock-account-results">
        <div className="dca-results-toolbar">
          <div className="dca-anchor-nav">
            {STOCK_SECTIONS.map(section => (
              <button
                key={section.id}
                className={`dca-anchor-btn${activeSection === section.id ? ' dca-anchor-btn--active' : ''}`}
                onClick={() => setActiveSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </div>
          {needsPortfolioFilter && (
            <div className="dca-results-filter-toolbar" aria-label={`Chọn danh mục trong ${activeSectionLabel}`}>
              {(activeSection === 'risk' || activeSection === 'perf') && views.length > 1 && (
                <button
                  className={`dca-results-filter-btn${scopedPortfolioFilterId === (activeSection === 'risk' ? ALL_RISK_PORTFOLIOS : ALL_PERFORMANCE_SCOPE) ? ' dca-results-filter-btn--active' : ''}`}
                  aria-pressed={scopedPortfolioFilterId === (activeSection === 'risk' ? ALL_RISK_PORTFOLIOS : ALL_PERFORMANCE_SCOPE)}
                  onClick={() => activeSection === 'risk' ? setActiveRiskPortfolioId(ALL_RISK_PORTFOLIOS) : setPerfScope(ALL_PERFORMANCE_SCOPE)}
                >
                  Tất cả
                </button>
              )}
              {views.map(candidate => (
                <button
                  key={candidate.id}
                    className={`dca-results-filter-btn${scopedPortfolioFilterId === candidate.id ? ' dca-results-filter-btn--active' : ''}`}
                    aria-pressed={scopedPortfolioFilterId === candidate.id}
                    onClick={() => activeSection === 'risk' ? setActiveRiskPortfolioId(candidate.id) : activeSection === 'perf' ? setPerfScope(candidate.id) : setActivePortfolioId(candidate.id)}
                >
                  {candidate.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="dca-results-content">
          <DcaSectionPanel id="summary" active={activeSection === 'summary'}>
            <DCAStatsTable portfolios={stats} assetLabel="cổ phiếu" />
            <PortfolioValueChart portfolios={valueChart} />
            <MemoDrawdownChart series={drawdownChart} />
            <DcaRecoveryChart portfolios={recoveryPortfolios} assetLabel="cổ phiếu" />
          </DcaSectionPanel>

          <DcaSectionPanel id="perf" active={activeSection === 'perf'}>
            <DCAStatsTable portfolios={perfStats} assetLabel="cổ phiếu" />
            <PortfolioValueChart portfolios={perfValueChart} />
            {perfStockCharts.map(chart => (
              <StockPositionValueChart key={chart.stockId} stockId={chart.stockId} points={chart.points} color={chart.color} />
            ))}
            <MemoYearlyPerformanceChart series={perfYearly} title="Hiệu suất theo năm" assetLabel="cổ phiếu" />
            <EOYReturnsTable portfolios={perfJourney} assetLabel="cổ phiếu" />
            <BankComparisonBlock results={perfBankComparison} endDate={bankComparisonEndDate} assetLabel="cổ phiếu" />
            <DcaReturnExplainer portfolios={perfReturnExplainer} assetLabel="cổ phiếu" />
          </DcaSectionPanel>

          <DcaSectionPanel id="journey" active={activeSection === 'journey'}>
            <DcaJourneyBlock
              portfolios={selectedJourney}
              startDate={startDate}
              endDate={endDate}
              details={<StockAccountDetails result={result} />}
            />
            {result.positions.length > 1 && (
              <div className="dca-results-filter-toolbar dca-results-filter-toolbar--inline" aria-label="Chọn cổ phiếu trong danh mục">
                <button
                  className={`dca-results-filter-btn${showAllStocks ? ' dca-results-filter-btn--active' : ''}`}
                  aria-pressed={showAllStocks}
                  onClick={() => setActiveStockId(ALL_STOCK_POSITIONS)}
                >
                  Tất cả
                </button>
                {result.positions.map(position => (
                  <button
                    key={position.stockId}
                    className={`dca-results-filter-btn${!showAllStocks && selectedPosition?.stockId === position.stockId ? ' dca-results-filter-btn--active' : ''}`}
                    aria-pressed={!showAllStocks && selectedPosition?.stockId === position.stockId}
                    onClick={() => setActiveStockId(position.stockId)}
                  >
                    {position.stockId}
                  </button>
                ))}
              </div>
            )}
            {result.positions.length > 1 && !showAllStocks && selectedPosition && (
              <DcaBlock title="Chi tiết khoản đầu tư" className="stock-position-dividends-block">
                <div className="stock-account-details-grid">
                  <AccountDetail label="Giá trị hiện tại" value={formatVND(selectedPositionLastPoint?.value ?? 0)} />
                  <AccountDetail label="Số cổ phiếu" value={formatShares(selectedPositionLastPoint?.shares ?? 0)} />
                  <AccountDetail label="Tổng tiền đã giải ngân" value={formatVND(selectedPositionInvested)} hint="Tổng tiền đã bỏ ra mua mã này trong suốt kỳ: tiền đầu tư chia theo tỷ trọng, cổ tức tiền tái đầu tư và tiền quyền mua (nếu có). Khi thiết lập tái cân bằng làm cho danh mục mua thêm mã này hoặc bán bớt mã kia cho nên số tiền ở đây có thể chênh lệch lớn giữa các mã cổ phiếu." />
                  <AccountDetail label="Cổ tức tiền mặt đã nhận" value={formatVND(selectedPosition.totalCashDividends)} />
                  <AccountDetail label="Cổ tức bằng cổ phiếu đã nhận" value={formatShares(selectedPosition.totalStockDividendShares)} />
                </div>
              </DcaBlock>
            )}
            <StockAnnualDividendsBlock data={annualDividends} defaultStockMode={showAllStocks ? 'value' : 'shares'} aggregate={showAllStocks} />
            {!showAllStocks && <StockShareHoldingsBlock points={shareHoldings} />}
            {!showAllStocks && (
              <StockCorporateActions
                actions={selectedPosition ? view.actionsByStock.get(selectedPosition.stockId) ?? [] : []}
                pendingActions={selectedPosition ? view.pendingActionsByStock.get(selectedPosition.stockId) ?? [] : []}
              />
            )}
            <StockLedger result={result} position={result.positions.length > 1 ? selectedPosition : undefined} />
          </DcaSectionPanel>

          <DcaSectionPanel id="risk" active={activeSection === 'risk'}>
            {riskPortfolioId === ALL_RISK_PORTFOLIOS ? (
              <DcaReturnPainChart portfolios={riskReturnPainPortfolios} />
            ) : (
              <>
                <DcaReturnPainChart portfolios={selectedRiskReturnPainPortfolios} />
                <DcaHistoricalPercentileBlock portfolios={selectedRiskHistoricalPortfolios} assetLabel="cổ phiếu" />
                <StockBehaviorBlock view={riskView} />
                <StockEntryPointBlock view={riskView} />
                <RollingReturnBlock portfolios={selectedRiskRollingPortfolios} assetLabel="cổ phiếu" />
              </>
            )}
          </DcaSectionPanel>

          <DcaSectionPanel id="allocation" active={activeSection === 'allocation'}>
            <StockAllocationBlock views={views} />
          </DcaSectionPanel>

          <DcaSectionPanel id="drawdowns" active={activeSection === 'drawdowns'}>
             <DcaStormBlock portfolios={selectedDrawdownPortfolios} assetLabel="cổ phiếu" />
          </DcaSectionPanel>

          <DcaSectionPanel id="endgame" active={activeSection === 'endgame'}>
            <ProjectionBlock portfolios={selectedProjection} />
            <MonteCarloBlock portfolios={selectedMonteCarlo} assetLabel="cổ phiếu" />
          </DcaSectionPanel>
        </div>
      </div>
    </>
  )
})

const StockAccountDetails = memo(function StockAccountDetails({ result }: { result: StockPortfolioDcaResult }) {
  return (
    <div className="stock-account-details">
      <div className="stock-account-details-title">Chi tiết tài khoản cuối kỳ</div>
      <div className="stock-account-details-grid">
        <AccountDetail label="Số mã đang nắm giữ" value={String(result.positions.length)} />
        <AccountDetail label="Cổ tức tiền mặt đã nhận" value={formatVND(result.totalCashDividends)} />
        <AccountDetail label="Cổ tức bằng cổ phiếu" value={formatShares(result.totalStockDividendShares)} />
      </div>
    </div>
  )
})

function AccountDetail({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="dca-journey-stat stock-account-detail"><div className="dca-journey-stat-label">{label}{hint && <span className="chart-tooltip-icon" title={hint}>?</span>}</div><div className="dca-journey-stat-value">{value}</div></div>
}

const StockAllocationBlock = memo(function StockAllocationBlock({ views }: { views: readonly StockView[] }) {
  return <DcaAllocationBlock assetLabel="cổ phiếu" portfolios={views.map(view => ({
    id: view.id,
    name: view.name,
    assetValues: [
      // `point.value` là giá trị sleeve đầy đủ (gồm cả tiền để dành và khoản phải thu),
      // nên ở đây tách lại phần giá thị trường để biểu đồ tỷ trọng vẫn hiện tiền mặt riêng.
      ...view.result.positions.map(position => ({
        fundId: position.stockId,
        values: position.points.map(point => ({ date: point.date, value: point.value - point.reservedCash - point.cashReceivables })),
      })),
      { fundId: 'Tiền mặt', values: view.result.points.map(point => ({ date: point.date, value: point.cash })) },
      { fundId: 'Tiền chờ nhận', values: view.result.points.map(point => ({ date: point.date, value: point.cashReceivables })) },
    ],
  }))} />
})

const StockCorporateActions = memo(function StockCorporateActions({ actions, pendingActions }: { actions: readonly CorporateAction[]; pendingActions: readonly PendingCorporateAction[] }) {
  const cashDividends = actions.filter((action): action is Extract<CorporateAction, { kind: 'cash_dividend' }> => action.kind === 'cash_dividend')
  const stockDividends = actions.filter((action): action is Extract<CorporateAction, { kind: 'stock_dividend' }> => action.kind === 'stock_dividend')
  const rightsIssues = actions.filter((action): action is Extract<CorporateAction, { kind: 'rights_issue' }> => action.kind === 'rights_issue')
  const pendingStockDividends = pendingActions.filter((action): action is Extract<PendingCorporateAction, { kind: 'stock_dividend' }> => action.kind === 'stock_dividend')
  const pendingRightsIssues = pendingActions.filter((action): action is Extract<PendingCorporateAction, { kind: 'rights_issue' }> => action.kind === 'rights_issue')
  return (
    <DcaBlock title="Sự kiện doanh nghiệp">
      <div className="stock-action-groups">
        <details className="stock-action-group"><summary>Cổ tức tiền mặt <span>{cashDividends.length} đợt</span></summary><div className="stock-action-table-wrap"><table className="stock-action-table"><thead><tr><th>Ngày chốt</th><th>Cổ tức</th><th>Thực nhận sau thuế</th><th>Ngày tiền về</th></tr></thead><tbody>{cashDividends.map((action, index) => <tr key={`${action.kind}-${action.exDate}-${index}`}><td>{formatDate(action.exDate)}</td><td>{formatVND(action.amountPerShare)}/cp</td><td>{formatVND(action.amountPerShare * (1 - (action.taxRate ?? 0)))}/cp</td><td>{formatDate(action.payDate)}</td></tr>)}</tbody></table></div></details>
        <details className="stock-action-group"><summary>Cổ tức bằng cổ phiếu <span>{stockDividends.length} đợt</span></summary><p className="dca-note stock-action-note">Tỷ lệ 13% nghĩa là cứ 1 cổ phiếu cũ nhận 0,13 cổ phiếu mới. Ví dụ, 100 cổ phiếu nhận thêm 13 cổ phiếu, không phải nhận 13% bằng tiền.</p><div className="stock-action-table-wrap"><table className="stock-action-table"><thead><tr><th>Ngày chốt</th><th>Cổ phiếu phát hành thêm</th><th>Ngày cổ phiếu về</th></tr></thead><tbody>{stockDividends.map((action, index) => <tr key={`${action.kind}-${action.exDate}-${index}`}><td>{formatDate(action.exDate)}</td><td>{formatStockDividendRatio(action.sharesPerShare)}</td><td>{formatDate(action.payDate)}</td></tr>)}</tbody></table></div></details>
        <details className="stock-action-group"><summary>Quyền mua <span>{rightsIssues.length} đợt</span></summary><div className="stock-action-table-wrap"><table className="stock-action-table"><thead><tr><th>Ngày chốt</th><th>Tỷ lệ</th><th>Giá thực hiện</th><th>Ngày cổ phiếu về</th></tr></thead><tbody>{rightsIssues.map((action, index) => <tr key={`${action.kind}-${action.exDate}-${index}`}><td>{formatDate(action.exDate)}</td><td>{formatPercent(action.rightsPerShare)}</td><td>{formatVND(action.subscriptionPrice)}/cp</td><td>{formatDate(action.settlementDate)}</td></tr>)}</tbody></table></div></details>
        {pendingActions.length > 0 && (
          <details className="stock-action-group stock-action-group--pending" open>
            <summary>Đang chờ ngày thanh toán <span>{pendingActions.length} đợt</span></summary>
            <p className="dca-note stock-action-note">VCI đã công bố các sự kiện này, nhưng chưa có ngày cổ phiếu về. Dashboard chỉ hiển thị để theo dõi, chưa cộng vào sổ tài khoản.</p>
            <div className="stock-action-table-wrap">
              <table className="stock-action-table">
                <thead><tr><th>Loại</th><th>Ngày chốt</th><th>Tỷ lệ</th><th>Giá thực hiện</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  {pendingStockDividends.map((action, index) => <tr key={`${action.kind}-${action.exDate}-${index}`}><td>Cổ tức bằng cổ phiếu</td><td>{formatDate(action.exDate)}</td><td>{formatStockDividendRatio(action.sharesPerShare)}</td><td>Chưa có</td><td>Chưa có ngày cổ phiếu về</td></tr>)}
                  {pendingRightsIssues.map((action, index) => <tr key={`${action.kind}-${action.exDate}-${index}`}><td>Quyền mua</td><td>{formatDate(action.exDate)}</td><td>{formatPercent(action.rightsPerShare)}</td><td>{formatVND(action.subscriptionPrice)}/cp</td><td>Chưa có ngày cổ phiếu về</td></tr>)}
                </tbody>
              </table>
            </div>
            {pendingRightsIssues.length > 0 && <p className="dca-note stock-action-note stock-action-note-muted">Giá quyền mua 10.000 đ/cp là giả định mô phỏng. VCI chưa trả giá phát hành trong event này.</p>}
          </details>
        )}
      </div>
    </DcaBlock>
  )
})

const StockLedger = memo(function StockLedger({ result, position }: {
  result: StockPortfolioDcaResult
  /** Có mã đang chọn thì sổ hiển thị riêng mã đó; không thì hiển thị sổ chung danh mục. */
  position?: StockPortfolioDcaResult['positions'][number]
}) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const monthlyPortfolioPoints = useMemo(() => {
    const lastPointByMonth = new Map<string, StockPortfolioValuePoint>()
    for (const point of result.points) lastPointByMonth.set(point.date.slice(0, 7), point)
    return Array.from(lastPointByMonth.values())
  }, [result.points])
  const monthlyPositionPoints = useMemo(() => {
    if (!position) return []
    const lastPointByMonth = new Map<string, StockPortfolioPositionPoint>()
    for (const point of position.points) lastPointByMonth.set(point.date.slice(0, 7), point)
    return Array.from(lastPointByMonth.values())
  }, [position])
  const totalCount = position ? monthlyPositionPoints.length : monthlyPortfolioPoints.length
  const pageSize = 100
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))
  const visiblePortfolioPoints = monthlyPortfolioPoints.slice(page * pageSize, (page + 1) * pageSize)
  const visiblePositionPoints = monthlyPositionPoints.slice(page * pageSize, (page + 1) * pageSize)

  useEffect(() => {
    setPage(0)
  }, [result, position])

  return (
    <DcaBlock title="Sổ tài khoản">
      <details onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>Hiện theo tháng, {totalCount.toLocaleString('vi-VN')} mốc cuối tháng</summary>
        {open && (
          <>
            <div className="stock-account-table-wrap">
              {position ? (
                <table className="stock-account-table"><thead><tr><th>Ngày</th><th>Giá</th><th>Tổng cổ phiếu</th><th>Đã đầu tư</th><th>Giá trị phân bổ</th><th>Cổ tức tiền đã nhận</th><th>Cổ tức cổ phiếu đã nhận</th></tr></thead><tbody>{visiblePositionPoints.map(point => <tr key={point.date}><td>{formatDate(point.date)}</td><td>{formatVND(point.price)}</td><td>{formatShares(point.shares)}</td><td>{formatVND(point.investedCash)}</td><td>{formatVND(point.value)}</td><td>{formatVND(point.cashDividends)}</td><td>{formatShares(point.stockDividendShares)}</td></tr>)}</tbody></table>
              ) : (
                <table className="stock-account-table"><thead><tr><th>Ngày</th><th>Tiền mặt</th><th>Chờ nhận</th><th>Đã đầu tư</th><th>Giá trị danh mục</th></tr></thead><tbody>{visiblePortfolioPoints.map(point => <tr key={point.date}><td>{formatDate(point.date)}</td><td>{formatVND(point.cash)}</td><td>{formatVND(point.cashReceivables)}</td><td>{formatVND(point.contributed)}</td><td>{formatVND(point.value)}</td></tr>)}</tbody></table>
              )}
            </div>
            {pageCount > 1 && (
              <div className="stock-ledger-pagination">
                <button onClick={() => setPage(current => Math.max(0, current - 1))} disabled={page === 0}>Trước</button>
                <span>Trang {page + 1}/{pageCount}</span>
                <button onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))} disabled={page === pageCount - 1}>Sau</button>
              </div>
            )}
          </>
        )}
      </details>
    </DcaBlock>
  )
})

const StockEntryPointBlock = memo(function StockEntryPointBlock({ view }: { view: StockView }) {
  const rows = useMemo(() => {
    const latest = view.prices[view.prices.length - 1]?.date
    if (!latest) return []
    return [120, 60, 36, 12, 6].map(months => {
      const entryDate = subtractMonths(latest, months)
      const pricesByStock = new Map(Array.from(view.allPricesByStock, ([stockId, prices]) => [stockId, prices.filter(point => point.date >= entryDate)]))
      const startDate = firstCommonStockDate(pricesByStock)
      if (!startDate) return null
      const sim = simulateStockPortfolioVariant(view, pricesByStock, [{ date: startDate, amount: 100_000_000 }])
      return { months, entryDate: startDate, value: sim.finalValue }
    }).filter((row): row is { months: number; entryDate: string; value: number } => row !== null)
  }, [view])
  if (rows.length === 0) return null
  return (
    <DcaBlock title="Cùng 100 triệu, vào ở thời điểm khác nhau">
      <p className="dca-ratio-sub">
        Giả sử bạn dùng 100 triệu mua một lần tại từng mốc thời gian rồi giữ đến nay. Đây là con số
        của tài khoản cổ phiếu, có tính lô mua, phí và corporate actions.
      </p>
      <div className="dca-stats-table-scroll">
        <table className="dca-stats-table">
          <thead>
            <tr><th>Thời điểm vào</th><th>Ngày bắt đầu</th><th>Giá trị hiện tại</th><th>Hệ số</th></tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.months}>
                <td>{row.months >= 12 ? `${row.months / 12} năm trước` : `${row.months} tháng trước`}</td>
                <td>{formatDate(row.entryDate)}</td>
                <td className={row.value < 100_000_000 ? 'dca-loss' : ''}>{formatVND(row.value)}</td>
                <td>{(row.value / 100_000_000).toFixed(2)}×</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dca-eoy-footnote">Khoản đầu tư nào bắt đầu trước khi mã này có dữ liệu thì không được nội suy.</div>
    </DcaBlock>
  )
})

const StockBehaviorBlock = memo(function StockBehaviorBlock({ view }: { view: StockView }) {
  const [extraAmount, setExtraAmount] = useState(0)
  const baseline = view.result
  const scenarios = useMemo(() => {
    const baselineDD = new Map(view.presentation.drawdown.map(point => [point.date, point.value]))
    const run = (threshold: number, mode: 'stop' | 'boost') => {
      let skippedCash = 0
      const contributions = generateStockContributions(view.prices, { initialAmount: view.params.initialAmount, phases: view.params.phases, annualContributionIncreaseAmount: view.params.annualContributionIncreaseAmount })
        .flatMap((contribution, index) => {
          if (index === 0) return [contribution]
          const isRed = (baselineDD.get(contribution.date) ?? 0) <= threshold
          if (mode === 'stop' && isRed) { skippedCash += contribution.amount; return [] }
          return [{ ...contribution, amount: contribution.amount + (mode === 'boost' && isRed ? extraAmount : 0) }]
        })
      return { result: simulateStockPortfolioVariant(view, view.pricesByStock, contributions), skippedCash }
    }
    return { stop15: run(-0.15, 'stop'), stop25: run(-0.25, 'stop'), boost15: run(-0.15, 'boost'), boost25: run(-0.25, 'boost') }
  }, [extraAmount, view])
  const chartData = mergeScenarioPoints(baseline, scenarios.stop15.result, scenarios.stop25.result)
  const boostData = mergeScenarioPoints(baseline, scenarios.boost15.result, scenarios.boost25.result)
  const formatVND = formatStockAxisVND
  return <DcaBlock title="Nếu bạn hoảng loạn dừng đầu tư khi thấy đỏ?" className="dca-consist-block"><p className="dca-consist-sub">Đây là phép đối chứng bằng chính chuỗi giá cổ phiếu: so sánh đầu tư đều đặn với việc dừng đầu tư khi cổ phiếu nằm dưới đỉnh 15% hoặc 25%. Phí, lô mua, tiền mặt và corporate actions vẫn chạy qua engine sổ tài khoản.</p><ResponsiveContainer width="100%" height={240}><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} /><XAxis dataKey="date" tickFormatter={value => value.slice(0, 7)} minTickGap={40} /><YAxis tickFormatter={value => formatVND(value)} width={70} /><Tooltip labelFormatter={value => formatDate(String(value))} formatter={(value: number, key: string) => [formatVND(value), scenarioLabel(key)]} /><Line dataKey="base" name="base" stroke="#111827" strokeWidth={2} dot={false} isAnimationActive={false} /><Line dataKey="stop15" name="stop15" stroke="#f97316" strokeDasharray="4 2" dot={false} isAnimationActive={false} /><Line dataKey="stop25" name="stop25" stroke="#dc2626" strokeDasharray="2 2" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer><ScenarioTable rows={[['Đầu tư đều đặn', baseline, 0], ['Dừng khi -15%', scenarios.stop15.result, scenarios.stop15.skippedCash], ['Dừng khi -25%', scenarios.stop25.result, scenarios.stop25.skippedCash]]} /><h4 className="dca-consist-subtitle">Ngược lại, nếu bạn tăng tiền khi thấy đỏ?</h4><div className="dca-consist-boost-control"><label>Tăng thêm mỗi lần đầu tư khi giảm sâu</label><div className="dca-amount-input"><MoneyInput value={extraAmount} onChange={setExtraAmount} min={0} /><span className="dca-currency">₫</span></div></div><ResponsiveContainer width="100%" height={240}><LineChart data={boostData}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} /><XAxis dataKey="date" tickFormatter={value => value.slice(0, 7)} minTickGap={40} /><YAxis tickFormatter={value => formatVND(value)} width={70} /><Tooltip labelFormatter={value => formatDate(String(value))} formatter={(value: number, key: string) => [formatVND(value), scenarioLabel(key)]} /><Line dataKey="base" name="base" stroke="#111827" strokeWidth={2} dot={false} isAnimationActive={false} /><Line dataKey="boost15" name="boost15" stroke="#0891b2" strokeDasharray="4 2" dot={false} isAnimationActive={false} /><Line dataKey="boost25" name="boost25" stroke="#7c3aed" strokeDasharray="2 2" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer><ScenarioTable rows={[['Đầu tư đều đặn', baseline, 0], ['Tăng thêm khi -15%', scenarios.boost15.result, 0], ['Tăng thêm khi -25%', scenarios.boost25.result, 0]]} /></DcaBlock>
})

function ScenarioTable({ rows }: { rows: [string, StockPortfolioDcaResult, number][] }) {
  const baseline = rows[0]?.[1]
  const isBoost = rows.some(([label]) => label.startsWith('Tăng'))
  return (
    <>
      <div className="dca-consist-chart-legend">
        <StockLegendItem color="#111827" label="Đầu tư đều đặn" />
        {isBoost ? <>
          <StockLegendItem color="#0891b2" dash="4 2" label="Tăng tiền khi DD &lt; -15%" />
          <StockLegendItem color="#7c3aed" dash="2 2" label="Tăng tiền khi DD &lt; -25%" />
        </> : <>
          <StockLegendItem color="#f97316" dash="4 2" label="Dừng đầu tư khi DD &lt; -15%" />
          <StockLegendItem color="#dc2626" dash="2 2" label="Dừng đầu tư khi DD &lt; -25%" />
        </>}
      </div>
      <div className="dca-stats-table-scroll">
        <table className="dca-consist-table">
          <thead>
            <tr>
              <th>Kịch bản</th><th>Đã đầu tư</th><th>Giá trị cuối</th><th>Lời ròng</th><th>% Lợi nhuận</th><th>MWRR</th>
              {!isBoost && <><th>Tiền chưa đầu tư</th><th>Chi phí cơ hội</th></>}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, result, skipped], index) => {
              const returnRate = result.totalContributed > 0 ? result.finalValue / result.totalContributed - 1 : 0
              const opportunityCost = index === 0 || !baseline ? null : baseline.finalValue - (result.finalValue + skipped)
              return (
                <tr key={label} className={index === 0 ? 'dca-consist-row--baseline' : undefined}>
                  <td><strong>{label}</strong></td>
                  <td>{formatVND(result.totalContributed)}</td>
                  <td>{formatVND(result.finalValue)}</td>
                  <td>{formatVND(result.finalValue - result.totalContributed)}</td>
                  <td>{formatPercent(returnRate)}</td>
                  <td>{formatPercent(dcaMWRR(result.cashflows) ?? 0)}</td>
                  {!isBoost && <><td>{skipped > 0 ? formatVND(skipped) : '—'}</td><td>{opportunityCost === null ? '—' : formatVND(opportunityCost)}</td></>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function StockLegendItem({ color, dash, label }: { color: string; dash?: string; label: string }) {
  return <div className="dca-consist-legend-item"><svg width="22" height="10"><line x1="0" y1="5" x2="22" y2="5" stroke={color} strokeWidth="2" strokeDasharray={dash || undefined} /></svg><span>{label}</span></div>
}

function mergeScenarioPoints(base: StockPortfolioDcaResult, first: StockPortfolioDcaResult, second: StockPortfolioDcaResult) {
  const firstMap = new Map(first.points.map(point => [point.date, point.value]))
  const secondMap = new Map(second.points.map(point => [point.date, point.value]))
  return base.points.map(point => ({ date: point.date, base: point.value, stop15: firstMap.get(point.date), stop25: secondMap.get(point.date), boost15: firstMap.get(point.date), boost25: secondMap.get(point.date) }))
}

function firstCommonStockDate(pricesByStock: ReadonlyMap<string, readonly { date: string }[]>): string | null {
  const sources = Array.from(pricesByStock.values())
  if (sources.length === 0 || sources.some(prices => prices.length === 0)) return null
  const common = new Set(sources[0]!.map(point => point.date))
  for (const prices of sources.slice(1)) {
    const dates = new Set(prices.map(point => point.date))
    for (const date of Array.from(common)) if (!dates.has(date)) common.delete(date)
  }
  return Array.from(common).sort()[0] ?? null
}

function commonStockPrices(pricesByStock: ReadonlyMap<string, StockData['prices']>): StockData['prices'] {
  const sources = Array.from(pricesByStock.values())
  const first = sources[0]
  if (!first || sources.some(prices => prices.length === 0)) return []
  const commonDates = new Set(first.map(point => point.date))
  for (const prices of sources.slice(1)) {
    const dates = new Set(prices.map(point => point.date))
    for (const date of Array.from(commonDates)) if (!dates.has(date)) commonDates.delete(date)
  }
  return first.filter(point => commonDates.has(point.date))
}

function simulateStockPortfolioVariant(
  view: StockView,
  pricesByStock: Map<string, StockData['prices']>,
  contributions: { date: string; amount: number }[],
): StockPortfolioDcaResult {
  const actionsByStock = new Map<string, CorporateAction[]>()
  for (const [stockId, prices] of pricesByStock) {
    const firstDate = prices[0]?.date
    const lastDate = prices[prices.length - 1]?.date
    if (!firstDate || !lastDate) continue
    actionsByStock.set(stockId, (view.allActionsByStock.get(stockId) ?? []).filter(action => action.exDate >= firstDate && action.exDate <= lastDate))
  }
  return simulateStockPortfolioDca({
    pricesByStock,
    slots: view.portfolio.slots.filter(slot => slot.fundId && slot.weight > 0),
    contributions,
    corporateActionsByStock: actionsByStock,
    rebalFreq: view.portfolio.rebalFreq,
    transactionCostRates: view.portfolio.transactionCostRates,
    lotSize: 1,
  })
}

function scenarioLabel(key: string): string {
  return ({ base: 'Đầu tư đều đặn', stop15: 'Dừng khi -15%', stop25: 'Dừng khi -25%', boost15: 'Tăng khi -15%', boost25: 'Tăng khi -25%' } as Record<string, string>)[key] ?? key
}

function clonePhases(phases: readonly DCAContributionPhase[]): DCAContributionPhase[] {
  return phases.map(phase => ({ ...phase }))
}

function cashflowScheduleError(phases: readonly DCAContributionPhase[]): string | null {
  for (let index = 0; index < phases.length - 1; index++) {
    const until = phases[index]!.until
    const nextUntil = phases[index + 1]!.until
    if (!until) return `Dòng tiền DCA ${index + 1} cần có ngày kết thúc`
    if (nextUntil && nextUntil <= until) return 'Các ngày kết thúc DCA phải tăng dần.'
  }
  return null
}

function subtractMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const totalMonths = year! * 12 + month! - 1 - months
  const targetYear = Math.floor(totalMonths / 12)
  const targetMonth = totalMonths - targetYear * 12
  const daysInMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day!, daysInMonth)).padStart(2, '0')}`
}

function formatDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

function formatVND(value: number): string {
  return `${Math.round(value).toLocaleString('vi-VN')} đ`
}

export function formatStockAxisVND(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`
  return value.toString()
}

function formatShares(value: number): string {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: 0 })
}

function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

function formatStockDividendRatio(value: number): string {
  return `${value.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} cổ phiếu mới / 1 cổ phiếu cũ`
}

export const StockDcaPanel = memo(StockDcaPanelImpl)
