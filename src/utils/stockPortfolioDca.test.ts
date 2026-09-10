import { describe, expect, it } from 'vitest'
import { simulateStockPortfolioDca } from './stockPortfolioDca'

const pricesByStock = new Map([
  ['AAA', [
    { date: '2026-01-05', price: 10 },
    { date: '2026-01-06', price: 10 },
    { date: '2026-02-05', price: 20 },
  ]],
  ['BBB', [
    { date: '2026-01-05', price: 10 },
    { date: '2026-01-06', price: 10 },
    { date: '2026-02-05', price: 10 },
  ]],
])

describe('stock portfolio DCA', () => {
  it('uses one contribution and allocates it across whole-lot stock positions', () => {
    const result = simulateStockPortfolioDca({
      pricesByStock,
      slots: [{ fundId: 'AAA', weight: 60 }, { fundId: 'BBB', weight: 40 }],
      contributions: [{ date: '2026-01-05', amount: 2_000 }],
      rebalFreq: 'yearly',
      lotSize: 10,
    })

    expect(result.totalContributed).toBe(2_000)
    expect(result.positions.map(position => [position.stockId, position.points[0]?.shares])).toEqual([
      ['AAA', 120], ['BBB', 80],
    ])
    expect(result.finalValue).toBe(3_200)
    expect(result.cashflows).toEqual([
      { date: '2026-01-05', amount: -2_000 },
      { date: '2026-02-05', amount: 3_200 },
    ])
  })

  it('records the buy fee in portfolio value and TWRR on the first purchase date', () => {
    const result = simulateStockPortfolioDca({
      pricesByStock: new Map([['AAA', [{ date: '2026-01-05', price: 100 }]]]),
      slots: [{ fundId: 'AAA', weight: 100 }],
      contributions: [{ date: '2026-01-05', amount: 1_000 }],
      rebalFreq: 'yearly',
      transactionCostRates: { buyFeeRate: 0.01 },
      lotSize: 1,
    })

    expect(result.positions[0]!.points[0]!.shares).toBe(9)
    expect(result.totalBuyFees).toBe(9)
    expect(result.finalValue).toBe(991)
    expect(result.twrrCumulative[0]).toMatchObject({ date: '2026-01-05' })
    expect(result.twrrCumulative[0]!.value).toBeCloseTo(-0.009, 12)
  })

  it('reinvests settled cash dividends through the shared cash ledger', () => {
    const result = simulateStockPortfolioDca({
      pricesByStock,
      slots: [{ fundId: 'AAA', weight: 50 }, { fundId: 'BBB', weight: 50 }],
      contributions: [{ date: '2026-01-05', amount: 2_000 }],
      corporateActionsByStock: new Map([['AAA', [{
        kind: 'cash_dividend' as const,
        exDate: '2026-01-06',
        payDate: '2026-02-05',
        amountPerShare: 1,
      }]]]),
      rebalFreq: 'yearly',
      lotSize: 10,
    })

    expect(result.totalCashDividends).toBe(100)
    expect(result.positions[1]!.points[2]!.shares).toBe(110)
    expect(result.finalCash).toBe(0)
    expect(result.finalValue).toBe(3_100)
  })

  it('sells and buys whole lots on the selected rebalance frequency', () => {
    const result = simulateStockPortfolioDca({
      pricesByStock,
      slots: [{ fundId: 'AAA', weight: 50 }, { fundId: 'BBB', weight: 50 }],
      contributions: [{ date: '2026-01-05', amount: 2_000 }],
      rebalFreq: 'monthly',
      lotSize: 10,
      transactionCostRates: { buyFeeRate: 0, sellFeeRate: 0.01, sellTaxRate: 0.001 },
    })

    expect(result.positions[0]!.points[2]!.shares).toBe(80)
    expect(result.positions[1]!.points[2]!.shares).toBe(130)
    expect(result.totalSellFees).toBe(4)
    expect(result.totalSellTaxes).toBeCloseTo(0.4, 10)
    expect(result.finalCash).toBeCloseTo(95.6, 10)
  })

  it('rejects duplicate stock slots before applying corporate actions twice', () => {
    expect(() => simulateStockPortfolioDca({
      pricesByStock,
      slots: [{ fundId: 'AAA', weight: 50 }, { fundId: 'AAA', weight: 50 }],
      contributions: [{ date: '2026-01-05', amount: 2_000 }],
      rebalFreq: 'yearly',
    })).toThrow('Duplicate stock in portfolio: AAA')
  })

  it('uses external funding only for the rights payment not covered by shared cash', () => {
    const result = simulateStockPortfolioDca({
      pricesByStock,
      slots: [{ fundId: 'AAA', weight: 50 }, { fundId: 'BBB', weight: 50 }],
      contributions: [{ date: '2026-01-05', amount: 2_500 }],
      corporateActionsByStock: new Map([['AAA', [{
        kind: 'rights_issue' as const,
        exDate: '2026-01-06',
        recordDate: '2026-01-06',
        rightsPerShare: 0.2,
        subscriptionPrice: 8,
        lastDate: '2026-01-06',
        settlementDate: '2026-02-05',
        choice: 'exercise' as const,
        funding: 'external' as const,
      }]]]),
      rebalFreq: 'yearly',
      lotSize: 10,
    })

    expect(result.positions[0]!.points[2]!.shares).toBe(144)
    expect(result.totalContributed).toBe(2_592)
    expect(result.finalCash).toBe(0)
    expect(result.cashflows).toContainEqual({ date: '2026-02-05', amount: -92 })
  })

  it('keeps a stock dividend in the issuing stock position', () => {
    const result = simulateStockPortfolioDca({
      pricesByStock,
      slots: [{ fundId: 'AAA', weight: 50 }, { fundId: 'BBB', weight: 50 }],
      contributions: [{ date: '2026-01-05', amount: 2_000 }],
      corporateActionsByStock: new Map([['AAA', [{
        kind: 'stock_dividend' as const,
        exDate: '2026-01-06',
        payDate: '2026-02-05',
        sharesPerShare: 0.1,
      }]]]),
      rebalFreq: 'yearly',
      lotSize: 10,
    })

    expect(result.positions[0]!.points[2]!.shares).toBe(110)
    expect(result.positions[1]!.points[2]!.shares).toBe(100)
  })

  it('settles same-day dividends before checking account-funded rights', () => {
    const result = simulateStockPortfolioDca({
      pricesByStock,
      slots: [{ fundId: 'AAA', weight: 50 }, { fundId: 'BBB', weight: 50 }],
      contributions: [{ date: '2026-01-05', amount: 2_000 }],
      corporateActionsByStock: new Map([
        ['AAA', [{
          kind: 'rights_issue' as const,
          exDate: '2026-01-06', recordDate: '2026-01-06', rightsPerShare: 0.2,
          subscriptionPrice: 8, lastDate: '2026-01-06', settlementDate: '2026-02-05', choice: 'exercise' as const,
        }]],
        ['BBB', [{
          kind: 'cash_dividend' as const,
          exDate: '2026-01-06', payDate: '2026-02-05', amountPerShare: 1.6,
        }]],
      ]),
      rebalFreq: 'yearly',
      lotSize: 10,
    })

    expect(result.positions[0]!.points[2]!.shares).toBe(120)
    expect(result.finalCash).toBe(0)
  })

  it('rejects a contribution date outside the common portfolio quote dates', () => {
    expect(() => simulateStockPortfolioDca({
      pricesByStock: new Map([
        ['AAA', [{ date: '2026-01-05', price: 10 }, { date: '2026-01-06', price: 10 }]],
        ['BBB', [{ date: '2026-01-06', price: 10 }]],
      ]),
      slots: [{ fundId: 'AAA', weight: 50 }, { fundId: 'BBB', weight: 50 }],
      contributions: [{ date: '2026-01-05', amount: 2_000 }],
      rebalFreq: 'yearly',
    })).toThrow('Contribution date has no portfolio quote: 2026-01-05')
  })
})
