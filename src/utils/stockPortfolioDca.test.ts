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

  it('reinvests a cash dividend into the stock that paid it', () => {
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
      lotSize: 1,
    })

    expect(result.totalCashDividends).toBe(100)
    // Cổ tức 100 của AAA ở lại AAA: giá 20 mua 5 cổ phiếu. BBB không nhận gì.
    expect(result.positions[0]!.points[2]!.shares).toBe(105)
    expect(result.positions[1]!.points[2]!.shares).toBe(100)
    expect(result.finalCash).toBe(0)
    expect(result.finalValue).toBe(3_100)
  })

  it('splits new cash by weight and keeps the unspent part with each stock', () => {
    const result = simulateStockPortfolioDca({
      pricesByStock: new Map([
        ['AAA', [{ date: '2026-01-05', price: 10 }]],
        ['BBB', [{ date: '2026-01-05', price: 30 }]],
      ]),
      slots: [{ fundId: 'AAA', weight: 50 }, { fundId: 'BBB', weight: 50 }],
      contributions: [{ date: '2026-01-05', amount: 4_000 }],
      rebalFreq: 'yearly',
      lotSize: 1,
    })

    // 4.000 chia đôi: AAA 2.000 mua 200 cổ phiếu (hết tiền), BBB 2.000 mua 66 cổ phiếu (1.980), dư 20.
    expect(result.positions[0]!.points[0]!.shares).toBe(200)
    expect(result.positions[0]!.points[0]!.reservedCash).toBe(0)
    expect(result.positions[1]!.points[0]!.shares).toBe(66)
    expect(result.positions[1]!.points[0]!.reservedCash).toBe(20)
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

  it('records the full rights subscription as external capital, without touching the shared pool', () => {
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

    // 120 cổ phiếu AAA × 0,2 = 24 quyền × 8 = 192, trả hẳn từ ngoài.
    expect(result.positions[0]!.points[2]!.shares).toBe(144)
    expect(result.totalContributed).toBe(2_692)
    // Tiền dư không bị rút để trả quyền nữa, nên còn nguyên.
    expect(result.finalCash).toBe(100)
    expect(result.cashflows).toContainEqual({ date: '2026-02-05', amount: -192 })
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

  it('keeps one stock dividend with its stock while another exercises rights externally', () => {
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

    // AAA trả 160 tiền quyền từ ngoài; BBB giữ 160 cổ tức, mua 10 cổ phiếu, dư 60.
    expect(result.positions[0]!.points[2]!.shares).toBe(120)
    expect(result.positions[1]!.points[2]!.shares).toBe(110)
    expect(result.totalContributed).toBe(2_160)
    expect(result.finalCash).toBe(60)
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

  it('tracks net cash invested per stock, including the buy fee', () => {
    const result = simulateStockPortfolioDca({
      pricesByStock,
      slots: [{ fundId: 'AAA', weight: 60 }, { fundId: 'BBB', weight: 40 }],
      contributions: [{ date: '2026-01-05', amount: 2_000 }],
      rebalFreq: 'yearly',
      lotSize: 10,
      transactionCostRates: { buyFeeRate: 0.01, sellFeeRate: 0, sellTaxRate: 0 },
    })

    const aaa = result.positions[0]!.points[0]!
    const bbb = result.positions[1]!.points[0]!
    expect(aaa.investedCash).toBeCloseTo(aaa.shares * 10 * 1.01, 6)
    expect(bbb.investedCash).toBeCloseTo(bbb.shares * 10 * 1.01, 6)
  })

  it('reduces invested cash by net sale proceeds on rebalance', () => {
    const result = simulateStockPortfolioDca({
      pricesByStock,
      slots: [{ fundId: 'AAA', weight: 50 }, { fundId: 'BBB', weight: 50 }],
      contributions: [{ date: '2026-01-05', amount: 2_000 }],
      rebalFreq: 'monthly',
      lotSize: 10,
      transactionCostRates: { buyFeeRate: 0, sellFeeRate: 0.01, sellTaxRate: 0.001 },
    })

    const aaaLast = result.positions[0]!.points[2]!
    const bbbLast = result.positions[1]!.points[2]!
    expect(aaaLast.shares).toBe(80)
    expect(bbbLast.shares).toBe(130)
    // AAA bán 20 cổ phiếu ở giá 20, trừ phí bán 1% và thuế 0,1%.
    expect(aaaLast.investedCash).toBeCloseTo(1_000 - (400 - 4 - 0.4), 6)
    // BBB mua thêm 30 cổ phiếu ở giá 10, không phí mua.
    expect(bbbLast.investedCash).toBeCloseTo(1_300, 6)
  })

  it('counts external rights subscription cash as invested in the stock', () => {
    const result = simulateStockPortfolioDca({
      pricesByStock: new Map([['AAA', [
        { date: '2026-01-05', price: 10 },
        { date: '2026-02-05', price: 10 },
      ]]]),
      slots: [{ fundId: 'AAA', weight: 100 }],
      contributions: [{ date: '2026-01-05', amount: 1_000 }],
      corporateActionsByStock: new Map([['AAA', [{
        kind: 'rights_issue' as const,
        exDate: '2026-01-06', recordDate: '2026-01-06', rightsPerShare: 0.2,
        subscriptionPrice: 5, lastDate: '2026-01-06', settlementDate: '2026-02-05',
        choice: 'exercise' as const, funding: 'external' as const,
      }]]]),
      rebalFreq: 'yearly',
      lotSize: 10,
    })

    const points = result.positions[0]!.points
    expect(points[0]!.investedCash).toBeCloseTo(1_000, 6)
    // 100 cổ phiếu × 0,2 = 20 quyền × 5 = 100 tiền thực hiện quyền, lấy từ ngoài sổ.
    expect(points[points.length - 1]!.investedCash).toBeCloseTo(1_100, 6)
    // Tiền quyền là vốn ngoài thật: cộng vào contributed và ghi thành external cashflow cho MWRR.
    expect(result.totalContributed).toBeCloseTo(1_100, 6)
    expect(result.cashflows).toContainEqual({ date: '2026-02-05', amount: -100 })
  })

  it('does not create performance when rights are exercised at the market price', () => {
    const result = simulateStockPortfolioDca({
      pricesByStock: new Map([['AAA', [
        { date: '2026-01-05', price: 100 },
        { date: '2026-01-06', price: 100 },
        { date: '2026-02-05', price: 100 },
      ]]]),
      slots: [{ fundId: 'AAA', weight: 100 }],
      contributions: [{ date: '2026-01-05', amount: 1_000 }],
      corporateActionsByStock: new Map([['AAA', [{
        kind: 'rights_issue' as const,
        exDate: '2026-01-06', recordDate: '2026-01-06', rightsPerShare: 0.5,
        subscriptionPrice: 100, lastDate: '2026-01-06', settlementDate: '2026-02-05',
        choice: 'exercise' as const, funding: 'external' as const,
      }]]]),
      rebalFreq: 'yearly',
      lotSize: 1,
    })

    // Giá thị trường = giá thực hiện nên quyền không tạo lãi. External flow bị neutralize khỏi TWRR.
    expect(result.totalContributed).toBe(1_500)
    expect(result.cashflows).toContainEqual({ date: '2026-02-05', amount: -500 })
    expect(result.finalValue).toBe(1_500)
    expect(result.twrrCumulative[result.twrrCumulative.length - 1]!.value).toBeCloseTo(0, 10)
  })

  it('credits rights value at the ex-date when the subscription price is below market', () => {
    const result = simulateStockPortfolioDca({
      pricesByStock: new Map([['AAA', [
        { date: '2026-01-05', price: 100 },
        { date: '2026-01-06', price: 100 },
        { date: '2026-02-05', price: 100 },
      ]]]),
      slots: [{ fundId: 'AAA', weight: 100 }],
      contributions: [{ date: '2026-01-05', amount: 1_000 }],
      corporateActionsByStock: new Map([['AAA', [{
        kind: 'rights_issue' as const,
        exDate: '2026-01-06', recordDate: '2026-01-06', rightsPerShare: 0.5,
        subscriptionPrice: 50, lastDate: '2026-01-06', settlementDate: '2026-02-05',
        choice: 'exercise' as const, funding: 'external' as const,
      }]]]),
      rebalFreq: 'yearly',
      lotSize: 1,
    })

    // Engine hiện ghi nhận giá trị quyền ngay ở ex-date (không model điều chỉnh giá ex-right),
    // nên TWRR dương: 5 quyền × (100 − 50) = 250 trên vốn 1.000 = 25%.
    expect(result.twrrCumulative[result.twrrCumulative.length - 1]!.value).toBeCloseTo(0.25, 10)
  })

  it('does not reduce another position reserve when a stock exercises rights externally', () => {
    const flat = [
      { date: '2026-01-05', price: 3 },
      { date: '2026-01-06', price: 3 },
      { date: '2026-02-05', price: 3 },
    ]
    const result = simulateStockPortfolioDca({
      pricesByStock: new Map([['AAA', flat], ['BBB', flat]]),
      slots: [{ fundId: 'AAA', weight: 50 }, { fundId: 'BBB', weight: 50 }],
      contributions: [{ date: '2026-01-05', amount: 1_000 }],
      corporateActionsByStock: new Map([['BBB', [{
        kind: 'rights_issue' as const,
        exDate: '2026-01-06', recordDate: '2026-01-06', rightsPerShare: 0.2,
        subscriptionPrice: 1, lastDate: '2026-01-06', settlementDate: '2026-02-05',
        choice: 'exercise' as const, funding: 'external' as const,
      }]]]),
      rebalFreq: 'yearly',
      lotSize: 100,
    })

    const aaa = result.positions[0]!.points
    // AAA để dành 200 trước và sau khi BBB thực hiện quyền bằng tiền ngoài.
    expect(aaa[1]!.reservedCash).toBeCloseTo(200, 6)
    expect(aaa[2]!.reservedCash).toBeCloseTo(200, 6)
    expect(result.totalContributed).toBe(1_020)
  })
})
