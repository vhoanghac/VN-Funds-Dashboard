import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePendingCorporateActionsCsv, parseStockCorporateActionsCsv, parseStockPriceCsv } from './stockData'

const STOCK_DATA_DIR = join(process.cwd(), 'public', 'data', 'stocks')
const PRICE_HEADER = 'date,adjusted_price,unadjusted_price'
const CORPORATE_ACTIONS_HEADER = 'kind,ex_date,record_date,pay_date,last_date,settlement_date,amount_per_share,tax_rate,shares_per_share,rights_per_share,subscription_price,choice,funding,source'
const PENDING_CORPORATE_ACTIONS_HEADER = 'kind,ex_date,record_date,ratio,subscription_price,source'

const stockFiles = readdirSync(STOCK_DATA_DIR)
const symbols = stockFiles
  .filter(file => /^[A-Z0-9]+\.csv$/.test(file))
  .map(file => file.slice(0, -4))
  .sort()
const corporateActionSymbols = stockFiles
  .filter(file => /^[A-Z0-9]+_div\.csv$/.test(file))
  .map(file => file.slice(0, -8))
  .sort()

function readCsv(fileName: string): string {
  return readFileSync(join(STOCK_DATA_DIR, fileName), 'utf8').replace(/^\uFEFF/, '')
}

describe('stock dataset files', () => {
  it('has at least one registered price dataset', () => {
    expect(symbols.length).toBeGreaterThan(0)
  })

  it('has exactly one corporate-actions file for every price dataset', () => {
    expect(corporateActionSymbols).toEqual(symbols)
  })

  for (const symbol of symbols) {
    it(`${symbol} has a parseable price and corporate-action pair`, () => {
      const priceCsv = readCsv(`${symbol}.csv`)
      const corporateActionsPath = join(STOCK_DATA_DIR, `${symbol}_div.csv`)
      expect(priceCsv.split(/\r?\n/, 1)[0]).toBe(PRICE_HEADER)
      expect(existsSync(corporateActionsPath)).toBe(true)

      const corporateActionsCsv = readCsv(`${symbol}_div.csv`)
      expect(corporateActionsCsv.split(/\r?\n/, 1)[0]).toBe(CORPORATE_ACTIONS_HEADER)

      const prices = parseStockPriceCsv(priceCsv, symbol)
      parseStockCorporateActionsCsv(corporateActionsCsv, symbol)
      const pendingPath = join(STOCK_DATA_DIR, `${symbol}_pending.csv`)
      if (existsSync(pendingPath)) {
        const pendingCsv = readCsv(`${symbol}_pending.csv`)
        expect(pendingCsv.split(/\r?\n/, 1)[0]).toBe(PENDING_CORPORATE_ACTIONS_HEADER)
        parsePendingCorporateActionsCsv(pendingCsv, symbol)
      }
      expect(prices.length).toBeGreaterThan(0)
      expect(prices[0]!.date <= prices[prices.length - 1]!.date).toBe(true)
    })
  }
})
