import { describe, expect, it } from 'vitest'
import { parsePendingCorporateActionsCsv, parseStockCorporateActionsCsv, parseStockPriceCsv } from './stockData'

describe('stock data parsers', () => {
  it('uses unadjusted_price and sorts raw sessions', () => {
    expect(parseStockPriceCsv(`date,adjusted_price,unadjusted_price
2026-01-06,90,100
2026-01-05,80,95
`)).toEqual([
      { date: '2026-01-05', price: 95 },
      { date: '2026-01-06', price: 100 },
    ])
  })

  it('uses the stock id in duplicate price errors', () => {
    expect(() => parseStockPriceCsv(`date,adjusted_price,unadjusted_price
2026-01-05,90,100
2026-01-05,91,101
`, 'VNM')).toThrow('Duplicate VNM price date')
  })

  it('maps cash, stock and rights rows to engine actions', () => {
    const actions = parseStockCorporateActionsCsv(`kind,ex_date,record_date,pay_date,last_date,settlement_date,amount_per_share,tax_rate,shares_per_share,rights_per_share,subscription_price,choice,funding,source
cash_dividend,2026-01-01,2026-01-02,2026-01-10,,,700,0.05,,,,,VCI
stock_dividend,2026-02-01,2026-02-02,2026-02-10,,,,0.05,0.13,,,,VCI
rights_issue,2026-03-01,2026-03-02,,2026-03-10,2026-03-10,,,,0.2,10000,exercise,external,VCI
`)

    expect(actions).toEqual([
      {
        kind: 'cash_dividend',
        exDate: '2026-01-01',
        payDate: '2026-01-10',
        amountPerShare: 700,
        taxRate: 0.05,
      },
      {
        kind: 'stock_dividend',
        exDate: '2026-02-01',
        payDate: '2026-02-10',
        sharesPerShare: 0.13,
      },
      {
        kind: 'rights_issue',
        exDate: '2026-03-01',
        recordDate: '2026-03-02',
        rightsPerShare: 0.2,
        subscriptionPrice: 10000,
        lastDate: '2026-03-10',
        settlementDate: '2026-03-10',
        choice: 'exercise',
        funding: 'external',
      },
    ])
  })

  it('maps split rows to engine actions', () => {
    expect(parseStockCorporateActionsCsv(`kind,ex_date,numerator,denominator
split,2026-04-01,3,2
`)).toEqual([
      {
        kind: 'split',
        exDate: '2026-04-01',
        numerator: 3,
        denominator: 2,
      },
    ])
  })

  it('rejects missing rights issue pricing instead of guessing', () => {
    expect(() => parseStockCorporateActionsCsv(`kind,ex_date,record_date,pay_date,last_date,settlement_date,amount_per_share,tax_rate,shares_per_share,rights_per_share,subscription_price,choice,funding,source
rights_issue,2026-03-01,2026-03-02,,2026-03-10,2026-03-10,,,,.2,,exercise,external,VCI
    `)).toThrow('subscription_price')
  })

  it('parses pending actions without letting them enter the account engine', () => {
    expect(parsePendingCorporateActionsCsv(`kind,ex_date,record_date,ratio,subscription_price,source
stock_dividend,2026-08-11,2026-08-12,0.15,,VCI event stock-1
rights_issue,2026-08-11,2026-08-12,0.1,10000,VCI event rights-1
`)).toEqual([
      {
        kind: 'stock_dividend',
        exDate: '2026-08-11',
        recordDate: '2026-08-12',
        sharesPerShare: 0.15,
        source: 'VCI event stock-1',
      },
      {
        kind: 'rights_issue',
        exDate: '2026-08-11',
        recordDate: '2026-08-12',
        rightsPerShare: 0.1,
        subscriptionPrice: 10000,
        source: 'VCI event rights-1',
      },
    ])
  })
})
