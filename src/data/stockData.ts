import Papa from 'papaparse'
import type { PricePoint } from '../types'
import { isIsoDate } from '../utils/priceSeries'
import type { CorporateAction, RightsIssueChoice, RightsIssueFunding } from '../utils/stockAccountDca'

export type PendingCorporateAction =
  | {
      kind: 'stock_dividend'
      exDate: string
      recordDate: string
      sharesPerShare: number
      source: string
    }
  | {
      kind: 'rights_issue'
      exDate: string
      recordDate: string
      rightsPerShare: number
      subscriptionPrice: number
      source: string
    }

export interface StockData {
  prices: PricePoint[]
  corporateActions: CorporateAction[]
  pendingCorporateActions: PendingCorporateAction[]
  asOf: string
}

export async function loadStockData(stockId: string, fetchImpl: typeof fetch = fetch): Promise<StockData> {
  const symbol = stockId.trim().toUpperCase()
  const pricePath = `/data/stocks/${symbol}.csv`
  const corporateActionsPath = `/data/stocks/${symbol}_div.csv`
  const pendingActionsPath = `/data/stocks/${symbol}_pending.csv`
  const [pricesResponse, actionsResponse, pendingActionsResponse] = await Promise.all([
    fetchImpl(pricePath),
    fetchImpl(corporateActionsPath),
    fetchImpl(pendingActionsPath),
  ])
  if (!pricesResponse.ok) throw new Error(`Cannot load ${pricePath}: ${pricesResponse.status}`)
  if (!actionsResponse.ok) throw new Error(`Cannot load ${corporateActionsPath}: ${actionsResponse.status}`)
  if (!pendingActionsResponse.ok && pendingActionsResponse.status !== 404) {
    throw new Error(`Cannot load ${pendingActionsPath}: ${pendingActionsResponse.status}`)
  }

  const [pricesCsv, actionsCsv, pendingActionsResponseText] = await Promise.all([
    pricesResponse.text(),
    actionsResponse.text(),
    pendingActionsResponse.ok ? pendingActionsResponse.text() : Promise.resolve(''),
  ])
  const pendingActionsCsv = pendingActionsResponse.headers?.get('content-type')?.includes('text/html')
    ? ''
    : pendingActionsResponseText
  const prices = parseStockPriceCsv(pricesCsv, symbol)
  if (prices.length === 0) throw new Error(`Không có dữ liệu giá cho ${symbol}`)
  return {
    prices,
    corporateActions: parseStockCorporateActionsCsv(actionsCsv, symbol),
    pendingCorporateActions: parsePendingCorporateActionsCsv(pendingActionsCsv, symbol),
    asOf: prices[prices.length - 1]!.date,
  }
}

export function parseStockPriceCsv(csvText: string, stockId = 'stock'): PricePoint[] {
  const result = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
  const points = result.data.map((row, index) => {
    const rowNumber = index + 2
    const date = row.date?.trim()
    const price = parseRequiredNumber(row.unadjusted_price, 'unadjusted_price', rowNumber)
    if (!date || !isIsoDate(date)) throw new Error(`Invalid date on ${stockId} price row ${rowNumber}`)
    return { date, price }
  })

  const dates = new Set<string>()
  for (const point of points) {
    if (dates.has(point.date)) throw new Error(`Duplicate ${stockId} price date: ${point.date}`)
    dates.add(point.date)
  }
  return points.sort((a, b) => a.date.localeCompare(b.date))
}

export function parseStockCorporateActionsCsv(csvText: string, stockId = 'stock'): CorporateAction[] {
  const result = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
  return result.data
    .map((row, index) => parseCorporateActionRow(row, index + 2, stockId))
    .sort((a, b) => a.exDate.localeCompare(b.exDate))
}

export function parsePendingCorporateActionsCsv(csvText: string, stockId = 'stock'): PendingCorporateAction[] {
  if (!csvText.trim()) return []
  const result = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
  return result.data
    .map((row, index) => parsePendingCorporateActionRow(row, index + 2, stockId))
    .sort((a, b) => a.exDate.localeCompare(b.exDate))
}

function parseCorporateActionRow(row: Record<string, string>, rowNumber: number, stockId: string): CorporateAction {
  const kind = row.kind?.trim()
  const exDate = requiredDate(row.ex_date, 'ex_date', rowNumber)

  if (kind === 'cash_dividend') {
    return {
      kind,
      exDate,
      payDate: requiredDate(row.pay_date, 'pay_date', rowNumber),
      amountPerShare: parseRequiredNumber(row.amount_per_share, 'amount_per_share', rowNumber),
      taxRate: parseRequiredNumber(row.tax_rate, 'tax_rate', rowNumber),
    }
  }

  if (kind === 'stock_dividend') {
    return {
      kind,
      exDate,
      payDate: requiredDate(row.pay_date, 'pay_date', rowNumber),
      sharesPerShare: parseRequiredNumber(row.shares_per_share, 'shares_per_share', rowNumber),
    }
  }

  if (kind === 'split') {
    return {
      kind,
      exDate,
      numerator: parseRequiredNumber(row.numerator, 'numerator', rowNumber),
      denominator: parseRequiredNumber(row.denominator, 'denominator', rowNumber),
    }
  }

  if (kind === 'rights_issue') {
    const choice = row.choice?.trim() as RightsIssueChoice
    const funding = (row.funding?.trim() || 'account') as RightsIssueFunding
    if (!['ignore', 'exercise', 'sell'].includes(choice)) {
      throw new Error(`Invalid rights issue choice on row ${rowNumber}`)
    }
    return {
      kind,
      exDate,
      recordDate: requiredDate(row.record_date, 'record_date', rowNumber),
      rightsPerShare: parseRequiredNumber(row.rights_per_share, 'rights_per_share', rowNumber),
      subscriptionPrice: parseRequiredNumber(row.subscription_price, 'subscription_price', rowNumber),
      lastDate: requiredDate(row.last_date, 'last_date', rowNumber),
      settlementDate: requiredDate(row.settlement_date, 'settlement_date', rowNumber),
      choice,
      funding,
    }
  }

  throw new Error(`Unsupported ${stockId} corporate action on row ${rowNumber}: ${kind}`)
}

function parsePendingCorporateActionRow(row: Record<string, string>, rowNumber: number, stockId: string): PendingCorporateAction {
  const kind = row.kind?.trim()
  const exDate = requiredDate(row.ex_date, 'ex_date', rowNumber)
  const recordDate = requiredDate(row.record_date, 'record_date', rowNumber)
  const source = row.source?.trim()
  if (!source) throw new Error(`Invalid source on pending stock action row ${rowNumber}`)

  if (kind === 'stock_dividend') {
    return {
      kind,
      exDate,
      recordDate,
      sharesPerShare: parseRequiredNumber(row.ratio, 'ratio', rowNumber),
      source,
    }
  }

  if (kind === 'rights_issue') {
    return {
      kind,
      exDate,
      recordDate,
      rightsPerShare: parseRequiredNumber(row.ratio, 'ratio', rowNumber),
      subscriptionPrice: parseRequiredNumber(row.subscription_price, 'subscription_price', rowNumber),
      source,
    }
  }

  throw new Error(`Unsupported ${stockId} pending corporate action on row ${rowNumber}: ${kind}`)
}

function requiredDate(value: string | undefined, field: string, rowNumber: number): string {
  const date = value?.trim()
  if (!date || !isIsoDate(date)) throw new Error(`Invalid ${field} on stock action row ${rowNumber}`)
  return date
}

function parseRequiredNumber(value: string | undefined, field: string, rowNumber: number): number {
  const text = value?.trim()
  const number = Number(text)
  if (!text || !Number.isFinite(number) || number < 0) throw new Error(`Invalid ${field} on stock row ${rowNumber}`)
  return number
}
