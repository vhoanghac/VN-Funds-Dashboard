import { describe, expect, it } from 'vitest'
import { annualStockDividends, buildStockAllocatedValueSeries, compactStockLedgerToMonthly, stockShareHoldings } from './stockDcaPresentation'
import type { StockAccountValuePoint } from './stockAccountDca'
import type { StockPortfolioPositionPoint } from './stockPortfolioDca'

function point(date: string, value: number): StockAccountValuePoint {
  return {
    date,
    price: value,
    shares: 1,
    purchasedShares: 1,
    stockDividendHoldings: 0,
    cash: 0,
    cashReceivables: 0,
    pendingShares: 0,
    pendingSubscriptionPayable: 0,
    contributed: value,
    buyFees: 0,
    cashDividends: 0,
    stockDividendShares: 0,
    value,
  }
}

describe('compactStockLedgerToMonthly', () => {
  it('keeps the last trading session in each calendar month', () => {
    const januaryLast = point('2026-01-30', 130)
    const februaryLast = point('2026-02-27', 227)

    expect(compactStockLedgerToMonthly([
      point('2026-01-05', 100),
      januaryLast,
      point('2026-02-02', 200),
      februaryLast,
    ])).toEqual([januaryLast, februaryLast])
  })

  it('returns an empty list for an empty ledger', () => {
    expect(compactStockLedgerToMonthly([])).toEqual([])
  })
})

describe('annualStockDividends', () => {
  it('groups settled cash and stock dividends by receipt year', () => {
    const points = [
      { ...point('2025-12-31', 100), cashDividends: 0, stockDividendShares: 0 },
      { ...point('2026-01-15', 110), cashDividends: 700, stockDividendShares: 0 },
      { ...point('2026-07-15', 120), cashDividends: 700, stockDividendShares: 13 },
      { ...point('2027-02-15', 130), cashDividends: 1_000, stockDividendShares: 13 },
    ]

    expect(annualStockDividends(points)).toEqual([
      { year: 2025, cashVnd: 0, stockShares: 0, stockValueVnd: 0 },
      { year: 2026, cashVnd: 700, stockShares: 13, stockValueVnd: 1560 },
      { year: 2027, cashVnd: 300, stockShares: 0, stockValueVnd: 0 },
    ])
  })

  it('keeps years without dividends in the selected range', () => {
    const points = [
      { ...point('2026-01-02', 100), cashDividends: 0, stockDividendShares: 0 },
      { ...point('2028-01-02', 100), cashDividends: 0, stockDividendShares: 0 },
    ]

    expect(annualStockDividends(points).map(row => row.year)).toEqual([2026, 2027, 2028])
  })
})

describe('stockShareHoldings', () => {
  it('keeps purchased and dividend shares as separate cumulative series', () => {
    const points = [
      { ...point('2026-01-05', 100), purchasedShares: 100, stockDividendHoldings: 0 },
      { ...point('2026-07-21', 120), purchasedShares: 200, stockDividendHoldings: 13 },
    ]

    expect(stockShareHoldings(points)).toEqual([
      { date: '2026-01-05', purchasedShares: 100, dividendShares: 0 },
      { date: '2026-07-21', purchasedShares: 200, dividendShares: 13 },
    ])
  })
})

describe('buildStockAllocatedValueSeries', () => {
  it('maps each position point to its allocated sleeve value', () => {
    const points = [positionPoint('2026-01-05', 100), positionPoint('2026-02-05', 130)]

    expect(buildStockAllocatedValueSeries(points)).toEqual([
      { date: '2026-01-05', value: 100 },
      { date: '2026-02-05', value: 130 },
    ])
  })
})

function positionPoint(date: string, value: number): StockPortfolioPositionPoint {
  return {
    date,
    price: value,
    shares: 1,
    purchasedShares: 1,
    stockDividendHoldings: 0,
    pendingShares: 0,
    pendingSubscriptionPayable: 0,
    cashReceivables: 0,
    cashDividends: 0,
    stockDividendShares: 0,
    investedCash: value,
    reservedCash: 0,
    value,
  }
}
