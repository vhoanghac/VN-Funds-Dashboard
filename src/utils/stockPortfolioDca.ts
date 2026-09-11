import type { PortfolioSlot, PricePoint, RebalanceFrequency, ReturnPoint, TransactionCostRates } from '../types'
import { dcaCagr, normalizeTransactionCostRates } from './dca'
import type { CorporateAction, StockContribution } from './stockAccountDca'

export interface StockPortfolioPositionPoint {
  date: string
  price: number
  shares: number
  purchasedShares: number
  stockDividendHoldings: number
  pendingShares: number
  pendingSubscriptionPayable: number
  /** Tiền cổ tức/quyền mua đã chốt quyền nhưng chưa về tài khoản của mã này. */
  cashReceivables: number
  cashDividends: number
  stockDividendShares: number
  /** Tiền mặt ròng đã bỏ vào mã: cộng tiền mua và quyền mua, trừ tiền thu về khi bán. */
  investedCash: number
  /** Tiền đã chia cho mã theo tỷ trọng nhưng chưa mua được lô nào, còn để dành cho mã. */
  reservedCash: number
  /**
   * Giá trị sleeve đầy đủ của mã: giá thị trường + cổ phiếu chờ về − khoản phải trả
   * cho quyền mua + khoản phải thu + tiền để dành. Cộng mọi mã lại bằng giá trị danh mục.
   */
  value: number
}

export interface StockPortfolioPositionResult {
  stockId: string
  points: StockPortfolioPositionPoint[]
  totalCashDividends: number
  totalStockDividendShares: number
}

export interface StockPortfolioValuePoint {
  date: string
  cash: number
  cashReceivables: number
  contributed: number
  buyFees: number
  sellFees: number
  sellTaxes: number
  cashDividends: number
  value: number
}

export interface StockPortfolioDcaResult {
  points: StockPortfolioValuePoint[]
  positions: StockPortfolioPositionResult[]
  cashflows: { date: string; amount: number }[]
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
  finalCash: number
  finalValue: number
}

export interface StockPortfolioDcaInput {
  pricesByStock: Map<string, readonly PricePoint[]>
  slots: readonly PortfolioSlot[]
  contributions: readonly StockContribution[]
  corporateActionsByStock?: Map<string, readonly CorporateAction[]>
  rebalFreq: RebalanceFrequency
  transactionCostRates?: Partial<TransactionCostRates>
  lotSize?: number
}

interface Position {
  stockId: string
  shares: number
  purchasedShares: number
  stockDividendHoldings: number
  pendingShares: number
  pendingSubscriptionPayable: number
  cashReceivables: number
  cashDividends: number
  stockDividendShares: number
  investedCash: number
  reserved: number
  actions: ActionState[]
  points: StockPortfolioPositionPoint[]
}

interface ActionState {
  action: CorporateAction
  captured: boolean
  settled: boolean
  cashReceivable: number
  pendingShares: number
  pendingSubscriptionPayable: number
}

interface Settlement {
  cash: number
  cashDividend: number
  stockDividendShares: number
  externalRightsPayable: number
}

/**
 * Account DCA for a stock portfolio. New cash is split across stocks by target
 * weight into per-stock reserves. Each stock buys lots from its own reserve and
 * keeps the unspent part; only a rebalance pulls weights back to target.
 */
export function simulateStockPortfolioDca(input: StockPortfolioDcaInput): StockPortfolioDcaResult {
  const slots = normalizeSlots(input.slots)
  const rates = normalizeTransactionCostRates(input.transactionCostRates, { buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0 })
  // Thị trường VN cho mua lô lẻ nên mặc định mua từng cổ phiếu, đầu tư hết tiền.
  const lotSize = input.lotSize ?? 1
  if (!Number.isInteger(lotSize) || lotSize <= 0) throw new Error(`Invalid lotSize: ${lotSize}`)
  if (slots.length === 0) return emptyResult()

  const priceMaps = new Map<string, Map<string, number>>()
  const dates = commonDates(slots, input.pricesByStock, priceMaps)
  if (dates.length === 0) return emptyResult()
  const contributionByDate = new Map<string, number>()
  for (const contribution of input.contributions) {
    if (!dates.includes(contribution.date)) {
      throw new Error(`Contribution date has no portfolio quote: ${contribution.date}`)
    }
    contributionByDate.set(contribution.date, (contributionByDate.get(contribution.date) ?? 0) + contribution.amount)
  }

  const positions = slots.map(slot => makePosition(slot.fundId, input.corporateActionsByStock?.get(slot.fundId) ?? []))
  const weights = slots.map(slot => slot.weight)
  let cash = 0
  let contributed = 0
  let buyFees = 0
  let sellFees = 0
  let sellTaxes = 0
  let cashDividends = 0
  let stockDividendShares = 0
  let previousValue = 0
  let twrrGrowth = 1
  let twrrStarted = false
  let previousRebalanceDate = dates[0]!
  const points: StockPortfolioValuePoint[] = []
  const cashflows: { date: string; amount: number }[] = []
  const twrrCumulative: ReturnPoint[] = []

  for (const date of dates) {
    const prices = positions.map(position => priceMaps.get(position.stockId)!.get(date)!)
    let externalFlow = 0

    // Entitlements are fixed before new DCA money reaches the account on ex-date.
    for (const position of positions) captureActions(position, date)
    const settlements = positions.map(position => settleActions(position, date))
    let settledCash = 0
    for (const [index, settlement] of settlements.entries()) {
      settledCash += settlement.cash
      cashDividends += settlement.cashDividend
      stockDividendShares += settlement.stockDividendShares
      // Cổ tức tiền và tiền bán quyền ở lại mã phát sinh, tái đầu tư vào chính mã đó.
      positions[index]!.reserved += settlement.cash
    }
    cash += settledCash

    // Quyền mua luôn tài trợ bằng tiền ngoài; giả định nhà đầu tư luôn có sẵn tiền mặt.
    // Khoản tiền này là vốn ngoài thật: tính vào contributed, vào external flow và MWRR.
    const externalRightsPayable = settlements.reduce((sum, settlement) => sum + settlement.externalRightsPayable, 0)
    if (externalRightsPayable > 0) {
      contributed += externalRightsPayable
      externalFlow += externalRightsPayable
      cashflows.push({ date, amount: -externalRightsPayable })
    }

    const contribution = contributionByDate.get(date) ?? 0
    if (contribution > 0) {
      cash += contribution
      contributed += contribution
      externalFlow += contribution
      cashflows.push({ date, amount: -contribution })
      allocateReserves(positions, contribution, weights)
    }

    // Mỗi mã chỉ mua trong phần tiền để dành của chính nó. Chưa đủ một lô thì để dành tiếp,
    // không dồn sang mã khác. Chỉ kỳ tái cân bằng mới kéo về tỷ trọng mục tiêu.
    if (cash > 0) {
      const spent = buyFromReserves(positions, prices, rates.buyFeeRate, lotSize)
      cash -= spent.cashSpent
      buyFees += spent.fee
    }

    if (contributed > 0 && shouldRebalance(previousRebalanceDate, date, input.rebalFreq)) {
      const sold = sellTowardWeights(positions, prices, weights, cash, rates, lotSize)
      cash += sold.cashReceived
      sellFees += sold.fee
      sellTaxes += sold.tax
      const bought = buyTowardWeights(positions, prices, weights, cash, rates.buyFeeRate, lotSize)
      cash -= bought.cashSpent
      buyFees += bought.fee
      // Tái cân bằng xong thì chia lại phần tiền còn lại theo tỷ trọng.
      retagReserves(positions, cash, weights)
      previousRebalanceDate = date
    }

    const value = portfolioValue(positions, prices, cash)
    if (twrrStarted && previousValue > 0) {
      twrrGrowth *= (value - externalFlow) / previousValue
    } else if (externalFlow > 0) {
      twrrStarted = true
      twrrGrowth = value / externalFlow
    }
    if (twrrStarted) twrrCumulative.push({ date, value: twrrGrowth - 1 })
    previousValue = value

    let totalReceivables = 0
    for (const [index, position] of positions.entries()) {
      const price = prices[index]!
      totalReceivables += position.cashReceivables
      position.points.push({
        date, price, shares: position.shares, purchasedShares: position.purchasedShares,
        stockDividendHoldings: position.stockDividendHoldings, pendingShares: position.pendingShares,
        pendingSubscriptionPayable: position.pendingSubscriptionPayable,
        cashReceivables: position.cashReceivables,
        cashDividends: position.cashDividends,
        stockDividendShares: position.stockDividendShares,
        investedCash: position.investedCash,
        reservedCash: position.reserved,
        value: position.shares * price + position.pendingShares * price
          - position.pendingSubscriptionPayable + position.cashReceivables + position.reserved,
      })
    }
    points.push({ date, cash, cashReceivables: totalReceivables, contributed, buyFees, sellFees, sellTaxes, cashDividends, value })
  }

  const lastPoint = points[points.length - 1]
  const finalValue = lastPoint?.value ?? 0
  if (lastPoint) cashflows.push({ date: lastPoint.date, amount: finalValue })
  return {
    points,
    positions: positions.map(position => ({ stockId: position.stockId, points: position.points, totalCashDividends: position.cashDividends, totalStockDividendShares: position.stockDividendShares })),
    cashflows,
    twrrCumulative,
    cumulativeTWRR: twrrGrowth - 1,
    annualizedTWRR: dcaCagr(twrrCumulative),
    totalContributed: contributed,
    totalBuyFees: buyFees,
    totalSellFees: sellFees,
    totalSellTaxes: sellTaxes,
    totalTransactionCosts: buyFees + sellFees + sellTaxes,
    totalCashDividends: cashDividends,
    totalStockDividendShares: stockDividendShares,
    finalCash: cash,
    finalValue,
  }
}

function normalizeSlots(slots: readonly PortfolioSlot[]): PortfolioSlot[] {
  const ids = new Set<string>()
  const active = slots.filter(slot => slot.fundId && slot.weight > 0)
  for (const slot of active) {
    if (ids.has(slot.fundId)) throw new Error(`Duplicate stock in portfolio: ${slot.fundId}`)
    ids.add(slot.fundId)
  }
  const total = active.reduce((sum, slot) => sum + slot.weight, 0)
  if (active.length === 0 || Math.abs(total - 100) > 0.01) throw new Error('Stock portfolio weights must total 100%')
  return active.map(slot => ({ ...slot, weight: slot.weight / total }))
}

function commonDates(slots: readonly PortfolioSlot[], pricesByStock: Map<string, readonly PricePoint[]>, priceMaps: Map<string, Map<string, number>>): string[] {
  let dates: string[] | null = null
  for (const slot of slots) {
    const source = pricesByStock.get(slot.fundId) ?? []
    const lookup = new Map<string, number>()
    for (const point of source) {
      if (!Number.isFinite(point.price) || point.price <= 0) throw new Error(`Invalid price for ${slot.fundId} on ${point.date}`)
      lookup.set(point.date, point.price)
    }
    priceMaps.set(slot.fundId, lookup)
    const sourceDates = new Set<string>(Array.from(lookup.keys()))
    dates = dates === null ? Array.from(sourceDates) : dates.filter(date => sourceDates.has(date))
  }
  return (dates ?? []).sort()
}

function makePosition(stockId: string, actions: readonly CorporateAction[]): Position {
  return {
    stockId, shares: 0, purchasedShares: 0, stockDividendHoldings: 0, pendingShares: 0,
    pendingSubscriptionPayable: 0, cashReceivables: 0, cashDividends: 0, stockDividendShares: 0,
    investedCash: 0, reserved: 0,
    actions: actions.map(action => ({ action, captured: false, settled: false, cashReceivable: 0, pendingShares: 0, pendingSubscriptionPayable: 0 })),
    points: [],
  }
}

function captureActions(position: Position, date: string): void {
  for (const state of position.actions) {
    if (state.captured || state.action.kind === 'split' || state.action.exDate > date) continue
    state.captured = true
    const action = state.action
    if (action.kind === 'cash_dividend') {
      state.cashReceivable = position.shares * action.amountPerShare * (1 - (action.taxRate ?? 0))
      position.cashReceivables += state.cashReceivable
    } else if (action.kind === 'stock_dividend') {
      state.pendingShares = position.shares * action.sharesPerShare
      position.pendingShares += state.pendingShares
    } else if (action.choice === 'exercise') {
      state.pendingShares = position.shares * action.rightsPerShare
      state.pendingSubscriptionPayable = state.pendingShares * action.subscriptionPrice
      position.pendingShares += state.pendingShares
      position.pendingSubscriptionPayable += state.pendingSubscriptionPayable
    } else if (action.choice === 'sell') {
      state.cashReceivable = position.shares * action.rightsPerShare * (action.salePricePerRight ?? 0)
      position.cashReceivables += state.cashReceivable
    }
  }
}

function settleActions(position: Position, date: string): Settlement {
  let cash = 0
  let cashDividend = 0
  let stockDividendShares = 0
  let externalRightsPayable = 0
  for (const state of position.actions) {
    if (state.settled) continue
    const action = state.action
    if (action.kind === 'split' && action.exDate <= date) {
      const factor = action.numerator / action.denominator
      position.shares *= factor
      position.purchasedShares *= factor
      position.stockDividendHoldings *= factor
      state.settled = true
    } else if (action.kind === 'cash_dividend' && state.captured && action.payDate <= date) {
      cash += state.cashReceivable
      cashDividend += state.cashReceivable
      position.cashDividends += state.cashReceivable
      position.cashReceivables -= state.cashReceivable
      state.settled = true
    } else if (action.kind === 'stock_dividend' && state.captured && action.payDate <= date) {
      position.shares += state.pendingShares
      position.stockDividendHoldings += state.pendingShares
      position.stockDividendShares += state.pendingShares
      position.pendingShares -= state.pendingShares
      stockDividendShares += state.pendingShares
      state.settled = true
    } else if (action.kind === 'rights_issue' && state.captured && action.settlementDate <= date) {
      if (action.choice === 'exercise') {
        position.shares += state.pendingShares
        position.purchasedShares += state.pendingShares
        position.pendingShares -= state.pendingShares
        position.pendingSubscriptionPayable -= state.pendingSubscriptionPayable
        // Tiền thực hiện quyền mua luôn lấy từ ngoài sổ; field `funding` bị bỏ qua.
        position.investedCash += state.pendingSubscriptionPayable
        externalRightsPayable += state.pendingSubscriptionPayable
      } else if (action.choice === 'sell') {
        cash += state.cashReceivable
        position.cashReceivables -= state.cashReceivable
      }
      state.settled = true
    }
  }
  return { cash, cashDividend, stockDividendShares, externalRightsPayable }
}

function portfolioValue(positions: readonly Position[], prices: readonly number[], cash: number): number {
  return cash + positions.reduce((sum, position, index) => sum + position.shares * prices[index]! + position.pendingShares * prices[index]! - position.pendingSubscriptionPayable + position.cashReceivables, 0)
}

/** Chia một khoản tiền mặt cho từng mã theo tỷ trọng mục tiêu. */
function allocateReserves(positions: readonly Position[], amount: number, weights: readonly number[]): void {
  if (amount === 0) return
  for (const [index, position] of positions.entries()) position.reserved += amount * weights[index]!
}

/** Chia lại tiền còn lại theo tỷ trọng, dùng sau tái cân bằng. */
function retagReserves(positions: readonly Position[], cash: number, weights: readonly number[]): void {
  for (const [index, position] of positions.entries()) position.reserved = cash * weights[index]!
}

/** Mỗi mã mua trong phần tiền để dành của chính nó; chưa đủ một lô thì để lại. */
function buyFromReserves(positions: readonly Position[], prices: readonly number[], feeRate: number, lotSize: number): { cashSpent: number; fee: number } {
  let cashSpent = 0
  let fee = 0
  for (const [index, position] of positions.entries()) {
    const lotCost = lotSize * prices[index]! * (1 + feeRate)
    const lots = Math.floor(position.reserved / lotCost)
    if (lots <= 0) continue
    const shares = lots * lotSize
    const tradeValue = shares * prices[index]!
    const tradeFee = tradeValue * feeRate
    position.shares += shares
    position.purchasedShares += shares
    position.investedCash += tradeValue + tradeFee
    position.reserved -= tradeValue + tradeFee
    cashSpent += tradeValue + tradeFee
    fee += tradeFee
  }
  return { cashSpent, fee }
}

function buyTowardWeights(positions: readonly Position[], prices: readonly number[], weights: readonly number[], cash: number, feeRate: number, lotSize: number): { cashSpent: number; fee: number } {
  const assets = positions.reduce((sum, position, index) => sum + position.shares * prices[index]!, 0)
  const total = assets + cash
  let cashSpent = 0
  let fee = 0
  for (const [index, position] of positions.entries()) {
    const target = total * weights[index]!
    const shortfall = Math.max(0, target - position.shares * prices[index]!)
    const budget = Math.min(shortfall, cash - cashSpent)
    const lotCost = lotSize * prices[index]! * (1 + feeRate)
    const lots = Math.floor(budget / lotCost)
    if (lots <= 0) continue
    const shares = lots * lotSize
    const tradeValue = shares * prices[index]!
    const tradeFee = tradeValue * feeRate
    position.shares += shares
    position.purchasedShares += shares
    position.investedCash += tradeValue + tradeFee
    cashSpent += tradeValue + tradeFee
    fee += tradeFee
  }
  return { cashSpent, fee }
}

function sellTowardWeights(positions: readonly Position[], prices: readonly number[], weights: readonly number[], cash: number, rates: TransactionCostRates, lotSize: number): { cashReceived: number; fee: number; tax: number } {
  const total = portfolioValue(positions, prices, cash)
  let cashReceived = 0
  let fee = 0
  let tax = 0
  for (const [index, position] of positions.entries()) {
    const excess = Math.max(0, position.shares * prices[index]! - total * weights[index]!)
    const lots = Math.floor(excess / (lotSize * prices[index]!))
    if (lots <= 0) continue
    const shares = Math.min(position.shares, lots * lotSize)
    const tradeValue = shares * prices[index]!
    const tradeFee = tradeValue * rates.sellFeeRate
    const tradeTax = tradeValue * rates.sellTaxRate
    position.shares -= shares
    position.purchasedShares = Math.max(0, position.purchasedShares - shares)
    position.investedCash -= tradeValue - tradeFee - tradeTax
    cashReceived += tradeValue - tradeFee - tradeTax
    fee += tradeFee
    tax += tradeTax
  }
  return { cashReceived, fee, tax }
}

function shouldRebalance(previousDate: string, date: string, frequency: RebalanceFrequency): boolean {
  const previous = new Date(`${previousDate}T00:00:00Z`)
  const current = new Date(`${date}T00:00:00Z`)
  if (frequency === 'weekly') return current.getTime() - previous.getTime() >= 7 * 24 * 60 * 60 * 1000
  if (frequency === 'monthly') return previous.getUTCMonth() !== current.getUTCMonth() || previous.getUTCFullYear() !== current.getUTCFullYear()
  if (frequency === 'quarterly') return Math.floor(previous.getUTCMonth() / 3) !== Math.floor(current.getUTCMonth() / 3) || previous.getUTCFullYear() !== current.getUTCFullYear()
  return previous.getUTCFullYear() !== current.getUTCFullYear()
}

function emptyResult(): StockPortfolioDcaResult {
  return { points: [], positions: [], cashflows: [], twrrCumulative: [], cumulativeTWRR: 0, annualizedTWRR: null, totalContributed: 0, totalBuyFees: 0, totalSellFees: 0, totalSellTaxes: 0, totalTransactionCosts: 0, totalCashDividends: 0, totalStockDividendShares: 0, finalCash: 0, finalValue: 0 }
}
