import type { PricePoint, ReturnPoint, TransactionCostRates } from '../types'
import {
  dcaContributionAmountAtDate,
  dcaContributionPhaseIndexAtDate,
  type DCAContributionPhase,
  type DCAFrequency,
} from './dca'

export interface StockContribution {
  date: string
  amount: number
}

export interface CashDividendAction {
  kind: 'cash_dividend'
  exDate: string
  payDate: string
  amountPerShare: number
  taxRate?: number
}

export interface StockDividendAction {
  kind: 'stock_dividend'
  exDate: string
  payDate: string
  sharesPerShare: number
}

export interface StockSplitAction {
  kind: 'split'
  exDate: string
  numerator: number
  denominator: number
}

export type RightsIssueChoice = 'ignore' | 'exercise' | 'sell'
export type RightsIssueFunding = 'account' | 'external'

export interface RightsIssueAction {
  kind: 'rights_issue'
  exDate: string
  recordDate: string
  rightsPerShare: number
  subscriptionPrice: number
  lastDate: string
  settlementDate: string
  choice: RightsIssueChoice
  funding?: RightsIssueFunding
  salePricePerRight?: number
}

export type CorporateAction =
  | CashDividendAction
  | StockDividendAction
  | StockSplitAction
  | RightsIssueAction

export interface StockAccountDcaInput {
  prices: readonly PricePoint[]
  contributions: readonly StockContribution[]
  corporateActions?: readonly CorporateAction[]
  initialCash?: number
  buyFeeRate?: number
  sellFeeRate?: number
  sellTaxRate?: number
  transactionCostRates?: Partial<TransactionCostRates>
  lotSize?: number
}

export interface StockAccountCashflow {
  date: string
  amount: number
}

export interface StockAccountValuePoint {
  date: string
  price: number
  shares: number
  purchasedShares: number
  stockDividendHoldings: number
  cash: number
  cashReceivables: number
  pendingShares: number
  pendingSubscriptionPayable: number
  contributed: number
  buyFees: number
  cashDividends: number
  stockDividendShares: number
  value: number
}

export interface StockAccountDcaResult {
  points: StockAccountValuePoint[]
  cashflows: StockAccountCashflow[]
  twrrCumulative: ReturnPoint[]
  cumulativeTWRR: number
  annualizedTWRR: number | null
  totalContributed: number
  totalBuyFees: number
  totalSellFees: number
  totalSellTaxes: number
  totalTransactionCosts: number
  totalCashDividends: number
  totalStockDividendShares: number
  finalShares: number
  finalCash: number
  finalCashReceivables: number
  finalPendingShares: number
  finalPendingSubscriptionPayable: number
  finalValue: number
}

interface CorporateActionState {
  action: CorporateAction
  eligibleShares: number | null
  captured: boolean
  settled: boolean
  cashReceivable: number
  pendingShares: number
  pendingSubscriptionPayable: number
}

/** Generate one contribution for the first observed trading date of each month. */
export function generateMonthlyStockContributions(
  prices: readonly PricePoint[],
  amount: number,
): StockContribution[] {
  normalizeNonNegative(amount, 'contribution amount')

  const result: StockContribution[] = []
  let previousMonth = ''
  for (const point of normalizePrices(prices)) {
    const month = point.date.slice(0, 7)
    if (month !== previousMonth) {
      result.push({ date: point.date, amount })
      previousMonth = month
    }
  }
  return result
}

export interface StockContributionSchedule {
  initialAmount: number
  phases: readonly DCAContributionPhase[]
  annualContributionIncreaseAmount?: number
}

/**
 * Generate stock-account contributions with the same cadence rules as the fund DCA tab.
 * The first price receives the initial amount; recurring contributions start on the next
 * eligible trading date so the account has the same two-part cashflow model as DCA.
 */
export function generateStockContributions(
  prices: readonly PricePoint[],
  schedule: StockContributionSchedule,
): StockContribution[] {
  const normalizedPrices = normalizePrices(prices)
  if (normalizedPrices.length === 0) return []
  normalizeNonNegative(schedule.initialAmount, 'initial amount')

  const phases = schedule.phases.length > 0
    ? schedule.phases
    : [{ amount: 0, freq: 'monthly' as DCAFrequency, until: null }]
  const mutablePhases = phases.map(phase => ({ ...phase }))
  const params = {
    initialAmount: schedule.initialAmount,
    cashflowAmount: phases[0]!.amount,
    cashflowFreq: phases[0]!.freq,
    annualContributionIncreaseAmount: schedule.annualContributionIncreaseAmount,
    cashflowSchedule: mutablePhases,
  }

  const contributions: StockContribution[] = []
  const firstDate = normalizedPrices[0]!.date
  if (schedule.initialAmount > 0) contributions.push({ date: firstDate, amount: schedule.initialAmount })

  let activePhase = dcaContributionPhaseIndexAtDate(mutablePhases, firstDate)
  let phaseJustStarted = false
  let lastContributionDate = firstDate
  let firstRecurringDate = ''

  for (let index = 1; index < normalizedPrices.length; index++) {
    const date = normalizedPrices[index]!.date
    const nextPhase = dcaContributionPhaseIndexAtDate(mutablePhases, date)
    if (nextPhase !== activePhase) {
      activePhase = nextPhase
      phaseJustStarted = true
    }

    const phase = mutablePhases[activePhase]
    if (!phase || phase.amount <= 0) {
      phaseJustStarted = false
      continue
    }

    if (phaseJustStarted || shouldInvestStock(lastContributionDate, date, phase.freq)) {
      firstRecurringDate ||= date
      const amount = dcaContributionAmountAtDate(params, date, firstRecurringDate)
      if (amount > 0) contributions.push({ date, amount })
      lastContributionDate = date
      phaseJustStarted = false
    }
  }

  return contributions
}

/**
 * Simulate an account ledger from raw stock prices. Contributions and settled cash
 * are reinvested into whole lots; pending shares and subscribed rights remain visible
 * until settlement.
 */
export function simulateStockAccountDca(input: StockAccountDcaInput): StockAccountDcaResult {
  const prices = normalizePrices(input.prices)
  const contributionsByDate = groupContributions(input.contributions)
  validateContributions(input.contributions, new Set(prices.map(point => point.date)))
  const actions = (input.corporateActions ?? []).map(action => createActionState(action))
  const buyFeeRate = normalizeRate(input.transactionCostRates?.buyFeeRate ?? input.buyFeeRate, 'buyFeeRate')
  const sellFeeRate = normalizeRate(input.transactionCostRates?.sellFeeRate ?? input.sellFeeRate, 'sellFeeRate')
  const sellTaxRate = normalizeRate(input.transactionCostRates?.sellTaxRate ?? input.sellTaxRate, 'sellTaxRate')
  // The single-stock ledger has no rebalance sale yet. Keep these rates in the
  // input contract so the portfolio runner can apply them when it sells lots.
  void sellFeeRate
  void sellTaxRate
  const lotSize = normalizeLotSize(input.lotSize)

  let shares = 0
  let purchasedShares = 0
  let stockDividendHoldings = 0
  let cash = normalizeNonNegative(input.initialCash ?? 0, 'initialCash')
  let cashReceivables = 0
  let pendingShares = 0
  let pendingSubscriptionPayable = 0
  let contributed = 0
  let buyFees = 0
  let sellFees = 0
  let sellTaxes = 0
  let cashDividends = 0
  let stockDividendShares = 0
  let previousValue = 0
  let twrrGrowth = 1

  const cashflows: StockAccountCashflow[] = []
  const twrrCumulative: ReturnPoint[] = []
  const points: StockAccountValuePoint[] = []

  for (let index = 0; index < prices.length; index++) {
    const { date, price } = prices[index]!

    // Every entitlement is fixed before any contribution on its ex-date.
    for (const state of actions) {
      if (state.captured || state.action.kind === 'split' || state.action.exDate > date) continue
      state.captured = true
      state.eligibleShares = shares

      if (state.action.kind === 'cash_dividend') {
        const amount = shares * state.action.amountPerShare * (1 - normalizeRate(state.action.taxRate, 'cash dividend taxRate'))
        state.cashReceivable = amount
        cashReceivables += amount
      } else if (state.action.kind === 'stock_dividend') {
        const amount = shares * state.action.sharesPerShare
        state.pendingShares = amount
        pendingShares += amount
      } else if (state.action.choice === 'exercise') {
        const rights = shares * state.action.rightsPerShare
        state.pendingShares = rights
        state.pendingSubscriptionPayable = rights * state.action.subscriptionPrice
        pendingShares += rights
        pendingSubscriptionPayable += state.pendingSubscriptionPayable
      } else if (state.action.choice === 'sell') {
        const amount = shares * state.action.rightsPerShare * state.action.salePricePerRight!
        state.cashReceivable = amount
        cashReceivables += amount
      }
    }

    let externalFunding = 0
    for (const state of actions) {
      if (state.settled) continue
      const action = state.action
      if (action.kind === 'split' && action.exDate <= date) {
        const splitFactor = action.numerator / action.denominator
        shares *= splitFactor
        purchasedShares *= splitFactor
        stockDividendHoldings *= splitFactor
        state.settled = true
      } else if (action.kind === 'cash_dividend' && state.captured && action.payDate <= date) {
        cash += state.cashReceivable
        cashReceivables -= state.cashReceivable
        cashDividends += state.cashReceivable
        state.settled = true
      } else if (action.kind === 'stock_dividend' && state.captured && action.payDate <= date) {
        shares += state.pendingShares
        pendingShares -= state.pendingShares
        stockDividendShares += state.pendingShares
        stockDividendHoldings += state.pendingShares
        state.settled = true
      } else if (action.kind === 'rights_issue' && state.captured && action.settlementDate <= date) {
        if (action.choice === 'exercise') {
          if (cash < state.pendingSubscriptionPayable) {
            if (action.funding !== 'external') {
              throw new Error(`Insufficient cash to exercise rights issue settling on ${action.settlementDate}`)
            }
            const topUp = state.pendingSubscriptionPayable - cash
            cash += topUp
            externalFunding += topUp
          }
          cash -= state.pendingSubscriptionPayable
          pendingSubscriptionPayable -= state.pendingSubscriptionPayable
          shares += state.pendingShares
          purchasedShares += state.pendingShares
          pendingShares -= state.pendingShares
        } else if (action.choice === 'sell') {
          cash += state.cashReceivable
          cashReceivables -= state.cashReceivable
        }
        state.settled = true
      }
    }

    let externalFlow = 0
    if (externalFunding > 0) {
      contributed += externalFunding
      externalFlow += externalFunding
      cashflows.push({ date, amount: -externalFunding })
    }
    if (index === 0 && cash > 0) {
      externalFlow += cash
      contributed += cash
      cashflows.push({ date, amount: -cash })
    }
    for (const contribution of contributionsByDate.get(date) ?? []) {
      if (contribution.amount === 0) continue
      cash += contribution.amount
      contributed += contribution.amount
      externalFlow += contribution.amount
      cashflows.push({ date, amount: -contribution.amount })
    }

    const purchasableLots = Math.floor(cash / (lotSize * price * (1 + buyFeeRate)))
    if (purchasableLots > 0) {
      const sharesBought = purchasableLots * lotSize
      const tradeValue = sharesBought * price
      const fee = tradeValue * buyFeeRate
      shares += sharesBought
      purchasedShares += sharesBought
      cash -= tradeValue + fee
      buyFees += fee
    }

    const value = accountValue(shares, cash, cashReceivables, pendingShares, pendingSubscriptionPayable, price)
    if (previousValue > 0) {
      twrrGrowth *= (value - externalFlow) / previousValue
    } else if (externalFlow > 0) {
      twrrGrowth *= value / externalFlow
    }
    twrrCumulative.push({ date, value: twrrGrowth - 1 })
    previousValue = value

    points.push({
      date,
      price,
      shares,
      purchasedShares,
      stockDividendHoldings,
      cash,
      cashReceivables,
      pendingShares,
      pendingSubscriptionPayable,
      contributed,
      buyFees,
      cashDividends,
      stockDividendShares,
      value,
    })
  }

  const last = points[points.length - 1]
  const finalValue = last?.value ?? cash
  if (last) cashflows.push({ date: last.date, amount: finalValue })

  return {
    points,
    cashflows,
    twrrCumulative,
    cumulativeTWRR: twrrGrowth - 1,
    annualizedTWRR: annualizeTWRR(twrrCumulative),
    totalContributed: contributed,
    totalBuyFees: buyFees,
    totalSellFees: sellFees,
    totalSellTaxes: sellTaxes,
    totalTransactionCosts: buyFees + sellFees + sellTaxes,
    totalCashDividends: cashDividends,
    totalStockDividendShares: stockDividendShares,
    finalShares: last?.shares ?? 0,
    finalCash: last?.cash ?? cash,
    finalCashReceivables: last?.cashReceivables ?? cashReceivables,
    finalPendingShares: last?.pendingShares ?? pendingShares,
    finalPendingSubscriptionPayable: last?.pendingSubscriptionPayable ?? pendingSubscriptionPayable,
    finalValue,
  }
}

function createActionState(action: CorporateAction): CorporateActionState {
  validateCorporateAction(action)
  return {
    action,
    eligibleShares: null,
    captured: false,
    settled: false,
    cashReceivable: 0,
    pendingShares: 0,
    pendingSubscriptionPayable: 0,
  }
}

function accountValue(
  shares: number,
  cash: number,
  cashReceivables: number,
  pendingShares: number,
  pendingSubscriptionPayable: number,
  price: number,
): number {
  return shares * price + cash + cashReceivables + pendingShares * price - pendingSubscriptionPayable
}

function annualizeTWRR(cumulative: ReturnPoint[]): number | null {
  if (cumulative.length < 2) return null
  const start = Date.parse(`${cumulative[0]!.date}T00:00:00Z`)
  const end = Date.parse(`${cumulative[cumulative.length - 1]!.date}T00:00:00Z`)
  const years = (end - start) / (365.25 * 24 * 60 * 60 * 1000)
  const growth = 1 + cumulative[cumulative.length - 1]!.value
  if (years <= 0 || growth < 0) return null
  return Math.pow(growth, 1 / years) - 1
}

function normalizePrices(prices: readonly PricePoint[]): PricePoint[] {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date))
  const dates = new Set<string>()
  for (const point of sorted) {
    assertDate(point.date, 'price date')
    if (!Number.isFinite(point.price) || point.price <= 0) throw new Error(`Invalid price on ${point.date}`)
    if (dates.has(point.date)) throw new Error(`Duplicate price date: ${point.date}`)
    dates.add(point.date)
  }
  return sorted
}

function shouldInvestStock(previousDate: string, currentDate: string, frequency: DCAFrequency): boolean {
  const previous = new Date(previousDate)
  const current = new Date(currentDate)
  const days = (current.getTime() - previous.getTime()) / (24 * 60 * 60 * 1000)

  switch (frequency) {
    case 'daily': return true
    case 'weekly': return days >= 5
    case 'biweekly': return days >= 12
    case 'monthly': return previous.getMonth() !== current.getMonth() || previous.getFullYear() !== current.getFullYear()
    case 'quarterly': return Math.floor(previous.getMonth() / 3) !== Math.floor(current.getMonth() / 3) || previous.getFullYear() !== current.getFullYear()
    case 'semiannual': return Math.floor(previous.getMonth() / 6) !== Math.floor(current.getMonth() / 6) || previous.getFullYear() !== current.getFullYear()
    case 'yearly': return previous.getFullYear() !== current.getFullYear()
  }
}

function validateContributions(contributions: readonly StockContribution[], priceDates: ReadonlySet<string>) {
  for (const contribution of contributions) {
    assertDate(contribution.date, 'contribution date')
    normalizeNonNegative(contribution.amount, 'contribution amount')
    if (!priceDates.has(contribution.date)) throw new Error(`Contribution date has no price: ${contribution.date}`)
  }
}

function validateCorporateAction(action: CorporateAction) {
  assertDate(action.exDate, `${action.kind} exDate`)
  if (action.kind === 'cash_dividend') {
    assertDate(action.payDate, 'cash_dividend payDate')
    normalizeNonNegative(action.amountPerShare, 'cash dividend amountPerShare')
    normalizeRate(action.taxRate, 'cash dividend taxRate')
    if (action.payDate < action.exDate) throw new Error('cash_dividend payDate precedes exDate')
  } else if (action.kind === 'stock_dividend') {
    assertDate(action.payDate, 'stock_dividend payDate')
    normalizeNonNegative(action.sharesPerShare, 'stock dividend sharesPerShare')
    if (action.payDate < action.exDate) throw new Error('stock_dividend payDate precedes exDate')
  } else if (action.kind === 'split') {
    normalizePositive(action.numerator, 'split numerator')
    normalizePositive(action.denominator, 'split denominator')
  } else {
    assertDate(action.recordDate, 'rights_issue recordDate')
    assertDate(action.lastDate, 'rights_issue lastDate')
    assertDate(action.settlementDate, 'rights_issue settlementDate')
    normalizeNonNegative(action.rightsPerShare, 'rights issue rightsPerShare')
    normalizeNonNegative(action.subscriptionPrice, 'rights issue subscriptionPrice')
    if (action.recordDate < action.exDate) throw new Error('rights_issue recordDate precedes exDate')
    if (action.lastDate < action.recordDate) throw new Error('rights_issue lastDate precedes recordDate')
    if (action.settlementDate < action.exDate) throw new Error('rights_issue settlementDate precedes exDate')
     if (action.choice !== 'ignore' && action.choice !== 'exercise' && action.choice !== 'sell') {
       throw new Error('rights_issue requires an explicit account choice')
     }
     if (action.funding !== undefined && action.funding !== 'account' && action.funding !== 'external') {
       throw new Error('rights_issue requires a valid funding source')
     }
    if (action.choice === 'sell') normalizePositive(action.salePricePerRight ?? 0, 'rights issue salePricePerRight')
  }
}

function assertDate(value: string, label: string) {
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
}

function normalizeRate(value: number | undefined, label: string): number {
  const rate = value ?? 0
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error(`Invalid ${label}: ${rate}`)
  return rate
}

function normalizeNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}: ${value}`)
  return value
}

function normalizePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${label}: ${value}`)
  return value
}

function normalizeLotSize(value: number | undefined): number {
  const lotSize = value ?? 1
  if (!Number.isInteger(lotSize) || lotSize <= 0) throw new Error(`Invalid lotSize: ${lotSize}`)
  return lotSize
}

function groupContributions(contributions: readonly StockContribution[]): Map<string, StockContribution[]> {
  const grouped = new Map<string, StockContribution[]>()
  for (const contribution of contributions) {
    const bucket = grouped.get(contribution.date) ?? []
    bucket.push(contribution)
    grouped.set(contribution.date, bucket)
  }
  return grouped
}
