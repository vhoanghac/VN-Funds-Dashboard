import { describe, expect, it } from 'vitest'
import { generateMonthlyStockContributions, generateStockContributions, simulateStockAccountDca } from './stockAccountDca'

const PRICES = [
  { date: '2026-01-05', price: 100 },
  { date: '2026-01-06', price: 100 },
  { date: '2026-01-07', price: 100 },
  { date: '2026-01-08', price: 100 },
]

describe('stock account DCA', () => {
  it('buys only whole lots and leaves insufficient cash in the ledger', () => {
    const result = simulateStockAccountDca({
      prices: PRICES,
      contributions: [
        { date: '2026-01-05', amount: 1_050 },
        { date: '2026-01-06', amount: 1_000 },
      ],
      lotSize: 10,
      buyFeeRate: 0.01,
    })

    expect(result.points[0]).toMatchObject({ shares: 10, purchasedShares: 10, stockDividendHoldings: 0, cash: 40, buyFees: 10 })
    expect(result.points[1]).toMatchObject({ shares: 20, purchasedShares: 20, stockDividendHoldings: 0, cash: 30, buyFees: 20 })
    expect(result.totalContributed).toBe(2_050)
    expect(result.totalBuyFees).toBe(20)
  })

  it('generates monthly contributions from the first observed trading date', () => {
    expect(generateMonthlyStockContributions([
      { date: '2026-01-12', price: 100 },
      { date: '2026-01-28', price: 101 },
      { date: '2026-02-03', price: 102 },
      { date: '2026-02-25', price: 103 },
      { date: '2026-03-02', price: 104 },
    ], 500)).toEqual([
      { date: '2026-01-12', amount: 500 },
      { date: '2026-02-03', amount: 500 },
      { date: '2026-03-02', amount: 500 },
    ])
  })

  it('matches DCA cadence, phase changes, and annual contribution increases', () => {
    expect(generateStockContributions([
      { date: '2026-01-05', price: 100 },
      { date: '2026-01-31', price: 100 },
      { date: '2026-02-02', price: 100 },
      { date: '2027-02-02', price: 100 },
    ], {
      initialAmount: 1_000,
      phases: [{ amount: 500, freq: 'monthly', until: null }],
      annualContributionIncreaseAmount: 100,
    })).toEqual([
      { date: '2026-01-05', amount: 1_000 },
      { date: '2026-02-02', amount: 500 },
      { date: '2027-02-02', amount: 600 },
    ])
  })

  it('carries dividend receivables and pending shares across raw-price corporate action drops', () => {
    const result = simulateStockAccountDca({
      prices: [
        { date: '2026-01-05', price: 100 },
        { date: '2026-01-06', price: 81 },
        { date: '2026-01-07', price: 81 },
        { date: '2026-01-08', price: 81 },
      ],
      contributions: [{ date: '2026-01-05', amount: 1_000 }],
      corporateActions: [
        {
          kind: 'cash_dividend',
          exDate: '2026-01-06',
          payDate: '2026-01-08',
          amountPerShare: 10,
        },
        {
          kind: 'stock_dividend',
          exDate: '2026-01-06',
          payDate: '2026-01-08',
          sharesPerShare: 1 / 9,
        },
      ],
    })

    expect(result.points[1]).toMatchObject({ cashReceivables: 100, pendingShares: 10 / 9, value: 1_000 })
    expect(result.points[2]!.value).toBeCloseTo(1_000, 10)
    expect(result.points[3]).toMatchObject({ cash: 19, cashReceivables: 0, pendingShares: 0, shares: 100 / 9 + 1, purchasedShares: 11, stockDividendHoldings: 10 / 9, value: 1_000 })
  })

  it('reinvests settled cash dividends on the next available whole lot', () => {
    const result = simulateStockAccountDca({
      prices: [
        { date: '2026-01-05', price: 10 },
        { date: '2026-01-06', price: 10 },
        { date: '2026-01-07', price: 10 },
      ],
      contributions: [{ date: '2026-01-05', amount: 100 }],
      lotSize: 10,
      corporateActions: [{
        kind: 'cash_dividend',
        exDate: '2026-01-06',
        payDate: '2026-01-07',
        amountPerShare: 10,
      }],
    })

    expect(result.totalCashDividends).toBe(100)
    expect(result.finalShares).toBe(20)
    expect(result.finalCash).toBe(0)
  })

  it('keeps a rights issue ignored when that explicit choice is selected', () => {
    const result = simulateStockAccountDca({
      prices: PRICES,
      contributions: [{ date: '2026-01-05', amount: 1_000 }],
      corporateActions: [{
        kind: 'rights_issue',
        exDate: '2026-01-06',
        recordDate: '2026-01-06',
        rightsPerShare: 0.2,
        subscriptionPrice: 80,
        lastDate: '2026-01-07',
        settlementDate: '2026-01-08',
        choice: 'ignore',
      }],
    })

    expect(result.finalShares).toBe(10)
    expect(result.finalCash).toBe(0)
  })

  it('values exercised rights as pending and settles them on the provided date', () => {
    const result = simulateStockAccountDca({
      prices: PRICES,
      initialCash: 160,
      contributions: [{ date: '2026-01-05', amount: 1_000 }],
      lotSize: 10,
      corporateActions: [{
        kind: 'rights_issue',
        exDate: '2026-01-06',
        recordDate: '2026-01-06',
        rightsPerShare: 0.2,
        subscriptionPrice: 80,
        lastDate: '2026-01-07',
        settlementDate: '2026-01-08',
        choice: 'exercise',
      }],
    })

    expect(result.points[1]).toMatchObject({ pendingShares: 2, pendingSubscriptionPayable: 160, value: 1_200 })
    expect(result.points[3]).toMatchObject({ shares: 12, pendingShares: 0, pendingSubscriptionPayable: 0, cash: 0 })
  })

  it('uses explicitly provided external cash when rights funding exceeds account cash', () => {
    const result = simulateStockAccountDca({
      prices: PRICES,
      contributions: [{ date: '2026-01-05', amount: 1_000 }],
      corporateActions: [{
        kind: 'rights_issue',
        exDate: '2026-01-06',
        recordDate: '2026-01-06',
        rightsPerShare: 0.2,
        subscriptionPrice: 80,
        lastDate: '2026-01-07',
        settlementDate: '2026-01-08',
        choice: 'exercise',
        funding: 'external',
      }],
    })

    expect(result.points[3]).toMatchObject({ shares: 12, pendingShares: 0, pendingSubscriptionPayable: 0, cash: 0 })
    expect(result.totalContributed).toBe(1_160)
    expect(result.cashflows).toContainEqual({ date: '2026-01-08', amount: -160 })
  })

  it('settles sold rights as a cash receivable', () => {
    const result = simulateStockAccountDca({
      prices: PRICES,
      contributions: [{ date: '2026-01-05', amount: 1_000 }],
      corporateActions: [{
        kind: 'rights_issue',
        exDate: '2026-01-06',
        recordDate: '2026-01-06',
        rightsPerShare: 0.2,
        subscriptionPrice: 80,
        lastDate: '2026-01-07',
        settlementDate: '2026-01-08',
        choice: 'sell',
        salePricePerRight: 25,
      }],
    })

    expect(result.points[1]!.cashReceivables).toBe(50)
    expect(result.points[3]).toMatchObject({ cash: 50, cashReceivables: 0 })
    expect(result.finalValue).toBe(1_050)
  })

  it('fails an exercised rights issue when settlement cash is insufficient', () => {
    expect(() => simulateStockAccountDca({
      prices: PRICES,
      contributions: [{ date: '2026-01-05', amount: 1_000 }],
      corporateActions: [{
        kind: 'rights_issue',
        exDate: '2026-01-06',
        recordDate: '2026-01-06',
        rightsPerShare: 0.2,
        subscriptionPrice: 80,
        lastDate: '2026-01-07',
        settlementDate: '2026-01-08',
        choice: 'exercise',
      }],
    })).toThrow('Insufficient cash to exercise rights issue')
  })

  it('calculates TWRR without treating a later contribution as investment return', () => {
    const result = simulateStockAccountDca({
      prices: [
        { date: '2026-01-05', price: 100 },
        { date: '2026-01-06', price: 200 },
      ],
      contributions: [
        { date: '2026-01-05', amount: 1_000 },
        { date: '2026-01-06', amount: 1_000 },
      ],
    })

    expect(result.twrrCumulative).toEqual([
      { date: '2026-01-05', value: 0 },
      { date: '2026-01-06', value: 1 },
    ])
    expect(result.cumulativeTWRR).toBe(1)
    expect(result.cashflows).toEqual([
      { date: '2026-01-05', amount: -1_000 },
      { date: '2026-01-06', amount: -1_000 },
      { date: '2026-01-06', amount: 3_000 },
    ])
  })
})
