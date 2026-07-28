import { describe, it, expect } from 'vitest'
import { parseCSV, parseFundMetadata, parseGoldCSV } from './csvParser'

describe('parseCSV', () => {
  it('parses a date,price CSV into points', () => {
    const csv = 'date,price\n2024-01-05,10000\n2024-01-12,10500'
    expect(parseCSV(csv)).toEqual([
      { date: '2024-01-05', price: 10000 },
      { date: '2024-01-12', price: 10500 },
    ])
  })

  it('sorts ascending by date regardless of file order', () => {
    const csv = 'date,price\n2024-03-01,3\n2024-01-01,1\n2024-02-01,2'
    expect(parseCSV(csv).map((p) => p.date)).toEqual([
      '2024-01-01',
      '2024-02-01',
      '2024-03-01',
    ])
  })

  it('skips rows with a malformed date', () => {
    const csv = 'date,price\n05/01/2024,10000\n2024-01-12,10500'
    expect(parseCSV(csv)).toEqual([{ date: '2024-01-12', price: 10500 }])
  })

  it('skips calendar dates that do not exist', () => {
    // Shape matches /^\d{4}-\d{2}-\d{2}$/ and Date.parse accepts it (it rolls
    // Feb 30 over to Mar 1), so only the round-trip check catches this row.
    const csv = 'date,price\n2024-02-30,10000\n2024-01-12,10500'
    expect(parseCSV(csv)).toEqual([{ date: '2024-01-12', price: 10500 }])
  })

  it('keeps Feb 29 in a leap year', () => {
    const csv = 'date,price\n2024-02-29,10000'
    expect(parseCSV(csv)).toEqual([{ date: '2024-02-29', price: 10000 }])
  })

  it('skips Feb 29 in a non-leap year', () => {
    expect(parseCSV('date,price\n2023-02-29,10000')).toEqual([])
  })

  it('skips a month past December', () => {
    expect(parseCSV('date,price\n2024-13-01,10000')).toEqual([])
  })

  it('skips rows with a non-numeric, zero, or negative price', () => {
    const csv = 'date,price\n2024-01-05,abc\n2024-01-12,0\n2024-01-19,-5\n2024-01-26,100'
    expect(parseCSV(csv)).toEqual([{ date: '2024-01-26', price: 100 }])
  })

  it('reads the buy column when the file is dual-price (gold, no price column)', () => {
    const csv = 'date,buy,sell\n2024-01-05,7500000,7700000'
    expect(parseCSV(csv)).toEqual([{ date: '2024-01-05', price: 7500000 }])
  })

  it('prefers the price column when a file has both price and buy', () => {
    const csv = 'date,price,buy\n2024-01-05,100,999'
    expect(parseCSV(csv)).toEqual([{ date: '2024-01-05', price: 100 }])
  })

  it('returns an empty array for a header-only file', () => {
    expect(parseCSV('date,price')).toEqual([])
  })
})

describe('parseFundMetadata', () => {
  const entry = {
    id: 'DCDS',
    name_vi: 'Quỹ DCDS',
    type: 'etf',
    start_date: '2014-01-01',
    csv_file: 'dcds.csv',
  }

  it('maps a known fund type through unchanged', () => {
    expect(parseFundMetadata(JSON.stringify([entry]))).toEqual([entry])
  })

  it('falls back to mutual_fund for an unrecognised type', () => {
    const raw = JSON.stringify([{ ...entry, type: 'something_new' }])
    expect(parseFundMetadata(raw)[0]!.type).toBe('mutual_fund')
  })

  it('accepts every declared fund type', () => {
    const types = ['etf', 'bond', 'balanced', 'crypto', 'gold']
    const raw = JSON.stringify(types.map((type) => ({ ...entry, type })))
    expect(parseFundMetadata(raw).map((f) => f.type)).toEqual(types)
  })

  it('throws when the JSON is not an array', () => {
    expect(() => parseFundMetadata('{"id":"DCDS"}')).toThrow(
      'fund_metadata.json must be an array',
    )
  })

  it('returns an empty array for an empty list', () => {
    expect(parseFundMetadata('[]')).toEqual([])
  })
})

describe('parseGoldCSV', () => {
  it('splits buy and sell into two series', () => {
    const csv = 'date,buy,sell\n2024-01-05,7500000,7700000\n2024-01-12,7600000,7800000'
    expect(parseGoldCSV(csv)).toEqual({
      buy: [
        { date: '2024-01-05', price: 7500000 },
        { date: '2024-01-12', price: 7600000 },
      ],
      sell: [
        { date: '2024-01-05', price: 7700000 },
        { date: '2024-01-12', price: 7800000 },
      ],
    })
  })

  it('sorts both series ascending by date', () => {
    const csv = 'date,buy,sell\n2024-02-01,2,20\n2024-01-01,1,10'
    const { buy, sell } = parseGoldCSV(csv)
    expect(buy.map((p) => p.date)).toEqual(['2024-01-01', '2024-02-01'])
    expect(sell.map((p) => p.date)).toEqual(['2024-01-01', '2024-02-01'])
  })

  it('drops the whole row when the date is unusable', () => {
    const csv = 'date,buy,sell\n,7500000,7700000\n2024-01-12,7600000,7800000'
    const { buy, sell } = parseGoldCSV(csv)
    expect(buy).toHaveLength(1)
    expect(sell).toHaveLength(1)
  })

  it('keeps the good half of a row when only one side is unusable', () => {
    // The two series are filtered independently, so they can end up different
    // lengths. Anything pairing them by index must not assume they line up.
    const csv = 'date,buy,sell\n2024-01-05,7500000,0\n2024-01-12,7600000,7800000'
    const { buy, sell } = parseGoldCSV(csv)
    expect(buy).toHaveLength(2)
    expect(sell).toEqual([{ date: '2024-01-12', price: 7800000 }])
  })
})
