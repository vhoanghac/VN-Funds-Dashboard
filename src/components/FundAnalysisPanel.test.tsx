import { describe, expect, it } from 'vitest'
import { industryAllocationForPeriod, top10StocksForPeriod } from './FundAnalysisPanel'
import type { FundPeriodSummary } from '../utils/fundReport'

function period(periodEnd: string, tickers: string[]): FundPeriodSummary {
  return {
    periodEnd,
    stocks: tickers.map((ticker, index) => ({
      ticker,
      quantity: 1,
      marketPrice: 1,
      value: 1,
      weightPct: tickers.length - index,
    })),
    allocation: {
      stockValue: tickers.length,
      bondValue: 0,
      cashValue: 0,
      otherValue: 0,
      totalValue: tickers.length,
    },
  }
}

describe('top10StocksForPeriod', () => {
  it('reads Top 10 from the requested snapshot period', () => {
    const portfolio = new Map([
      ['2026-07-31', period('2026-07-31', ['JULY_TOP', 'JULY_SECOND'])],
      ['2026-06-30', period('2026-06-30', ['JUNE_TOP', 'JUNE_SECOND'])],
    ])

    expect(top10StocksForPeriod(portfolio, '2026-06-30').map(stock => stock.ticker))
      .toEqual(['JUNE_TOP', 'JUNE_SECOND'])
    expect(top10StocksForPeriod(portfolio, '2026-07-31').map(stock => stock.ticker))
      .toEqual(['JULY_TOP', 'JULY_SECOND'])
  })

  it('returns an empty list when no snapshot period is resolved', () => {
    expect(top10StocksForPeriod(null, null)).toEqual([])
  })
})

describe('industryAllocationForPeriod', () => {
  it('reads industry weights from the requested snapshot period', () => {
    const portfolio = new Map([
      ['2026-07-31', period('2026-07-31', ['JULY_TOP'])],
      ['2026-06-30', period('2026-06-30', ['JUNE_TOP'])],
    ])

    expect(industryAllocationForPeriod(
      portfolio,
      '2026-06-30',
      { JUNE_TOP: 'Ngân hàng', JULY_TOP: 'Bất động sản' },
    )).toEqual([{ name: 'Ngân hàng', value: 1 }])
  })
})
