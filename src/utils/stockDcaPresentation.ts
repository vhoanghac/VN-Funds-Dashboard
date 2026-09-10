import type { PricePoint, ReturnPoint } from '../types'
import {
  dcaProfitFactor,
  dcaStormStats,
  type DCAStormStats,
} from './dca'
import { type StockAccountDcaResult, type StockAccountValuePoint } from './stockAccountDca'
import type { StockPortfolioDcaResult, StockPortfolioPositionPoint } from './stockPortfolioDca'

export interface StockDcaPresentation {
  cumulative: ReturnPoint[]
  drawdown: ReturnPoint[]
  returns: ReturnPoint[]
  valueSeries: { date: string; value: number }[]
  investedSeries: { date: string; value: number }[]
  assetValueSeries: { date: string; value: number }[]
  cashSeries: { date: string; value: number }[]
  receivableSeries: { date: string; value: number }[]
  pendingSharesSeries: { date: string; value: number }[]
  pendingPayableSeries: { date: string; value: number }[]
  storm: DCAStormStats
  profitFactor: number | null
}

export interface StockAnnualDividendPoint {
  year: number
  cashVnd: number
  stockShares: number
  stockValueVnd: number
}

export interface StockShareHoldingPoint {
  date: string
  purchasedShares: number
  dividendShares: number
}

/** Convert the stock ledger into the view-model shapes used by the DCA charts. */
export function presentStockDcaResult(result: StockAccountDcaResult): StockDcaPresentation {
  const cumulative = result.twrrCumulative
  const drawdown = buildDrawdownSeries(cumulative)
  const returns = buildReturnSeries(cumulative)

  return {
    cumulative,
    drawdown,
    returns,
    valueSeries: result.points.map(point => ({ date: point.date, value: point.value })),
    investedSeries: result.points.map(point => ({ date: point.date, value: point.contributed })),
    assetValueSeries: result.points.map(point => ({ date: point.date, value: point.shares * point.price })),
    cashSeries: result.points.map(point => ({ date: point.date, value: point.cash })),
    receivableSeries: result.points.map(point => ({ date: point.date, value: point.cashReceivables })),
    pendingSharesSeries: result.points.map(point => ({ date: point.date, value: point.pendingShares * point.price })),
    pendingPayableSeries: result.points.map(point => ({ date: point.date, value: point.pendingSubscriptionPayable })),
    storm: dcaStormStats(drawdown, cumulative),
    profitFactor: dcaProfitFactor(returns),
  }
}

/** Convert a shared-cash stock portfolio ledger into the chart view models. */
export function presentStockPortfolioDcaResult(result: StockPortfolioDcaResult): StockDcaPresentation {
  const cumulative = result.twrrCumulative
  const drawdown = buildDrawdownSeries(cumulative)
  const returns = buildReturnSeries(cumulative)
  return {
    cumulative,
    drawdown,
    returns,
    valueSeries: result.points.map(point => ({ date: point.date, value: point.value })),
    investedSeries: result.points.map(point => ({ date: point.date, value: point.contributed })),
    assetValueSeries: result.points.map(point => ({ date: point.date, value: point.value - point.cash })),
    cashSeries: result.points.map(point => ({ date: point.date, value: point.cash })),
    receivableSeries: result.points.map(point => ({ date: point.date, value: point.cashReceivables })),
    pendingSharesSeries: result.points.map(point => ({ date: point.date, value: point.value - point.cash - point.cashReceivables })),
    pendingPayableSeries: result.points.map(point => ({ date: point.date, value: 0 })),
    storm: dcaStormStats(drawdown, cumulative),
    profitFactor: dcaProfitFactor(returns),
  }
}

/** Group settled dividends by the ledger year in which the account received them. */
export function annualStockDividends(points: readonly (StockAccountValuePoint | StockPortfolioPositionPoint)[]): StockAnnualDividendPoint[] {
  if (points.length === 0) return []

  const firstYear = Number(points[0]!.date.slice(0, 4))
  const lastYear = Number(points[points.length - 1]!.date.slice(0, 4))
  const rows = new Map<number, StockAnnualDividendPoint>()
  for (let year = firstYear; year <= lastYear; year++) {
    rows.set(year, { year, cashVnd: 0, stockShares: 0, stockValueVnd: 0 })
  }

  let previousCashVnd = 0
  let previousStockShares = 0
  for (const point of points) {
    const row = rows.get(Number(point.date.slice(0, 4)))
    if (!row) continue
    const cashVnd = point.cashDividends - previousCashVnd
    const stockShares = point.stockDividendShares - previousStockShares
    row.cashVnd += cashVnd
    row.stockShares += stockShares
    row.stockValueVnd += stockShares * point.price
    previousCashVnd = point.cashDividends
    previousStockShares = point.stockDividendShares
  }

  return [...rows.values()]
}

/** Split account holdings by purchase source for the time-series chart. */
export function stockShareHoldings(points: readonly (StockAccountValuePoint | StockPortfolioPositionPoint)[]): StockShareHoldingPoint[] {
  return points.map(point => ({
    date: point.date,
    purchasedShares: point.purchasedShares,
    dividendShares: point.stockDividendHoldings,
  }))
}

/** Keep the last observed trading session in each calendar month for the ledger table. */
export function compactStockLedgerToMonthly(points: readonly StockAccountValuePoint[]): StockAccountValuePoint[] {
  const lastPointByMonth = new Map<string, StockAccountValuePoint>()
  for (const point of points) {
    lastPointByMonth.set(point.date.slice(0, 7), point)
  }
  return [...lastPointByMonth.values()]
}

function buildDrawdownSeries(cumulative: ReturnPoint[]): ReturnPoint[] {
  let peak = 0
  return cumulative.map(point => {
    const growth = 1 + point.value
    peak = Math.max(peak, growth)
    return { date: point.date, value: peak > 0 ? growth / peak - 1 : 0 }
  })
}

function buildReturnSeries(cumulative: ReturnPoint[]): ReturnPoint[] {
  const returns: ReturnPoint[] = []
  for (let index = 1; index < cumulative.length; index++) {
    const previous = cumulative[index - 1]!
    const current = cumulative[index]!
    const previousGrowth = 1 + previous.value
    if (previousGrowth <= 0) continue
    returns.push({ date: current.date, value: (1 + current.value) / previousGrowth - 1 })
  }
  return returns
}

export function filterStockPrices(prices: readonly PricePoint[], from: string, to: string): PricePoint[] {
  return prices.filter(point => (!from || point.date >= from) && (!to || point.date <= to))
}
