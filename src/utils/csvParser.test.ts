import { describe, it, expect } from 'vitest'
import { formatCsvPriceWarning, parseCSV, parseFundMetadata, parseGoldCSV } from './csvParser'

function parsedPoints(csv: string) {
  return parseCSV(csv).points
}

describe('parseCSV', () => {
  it('parses a date,price CSV into points', () => {
    const csv = 'date,price\n2024-01-05,10000\n2024-01-12,10500'
    expect(parsedPoints(csv)).toEqual([
      { date: '2024-01-05', price: 10000 },
      { date: '2024-01-12', price: 10500 },
    ])
  })

  it('sorts ascending by date regardless of file order', () => {
    const csv = 'date,price\n2024-03-01,3\n2024-01-01,1\n2024-02-01,2'
    expect(parsedPoints(csv).map((p) => p.date)).toEqual([
      '2024-01-01',
      '2024-02-01',
      '2024-03-01',
    ])
  })

  it('skips rows with a malformed date', () => {
    const csv = 'date,price\n05/01/2024,10000\n2024-01-12,10500'
    expect(parsedPoints(csv)).toEqual([{ date: '2024-01-12', price: 10500 }])
  })

  it('skips calendar dates that do not exist', () => {
    // The shape is valid, but the calendar date rolls over to Mar 1 unless the
    // date validator compares its UTC round-trip components.
    const csv = 'date,price\n2024-02-30,10000\n2024-01-12,10500'
    expect(parsedPoints(csv)).toEqual([{ date: '2024-01-12', price: 10500 }])
  })

  it('keeps Feb 29 in a leap year', () => {
    const csv = 'date,price\n2024-02-29,10000'
    expect(parsedPoints(csv)).toEqual([{ date: '2024-02-29', price: 10000 }])
  })

  it('skips Feb 29 in a non-leap year', () => {
    expect(parsedPoints('date,price\n2023-02-29,10000')).toEqual([])
  })

  it('skips a month past December', () => {
    expect(parsedPoints('date,price\n2024-13-01,10000')).toEqual([])
  })

  it('skips rows with a non-numeric, partial-numeric, zero, or negative price', () => {
    const csv = 'date,price\n2024-01-05,abc\n2024-01-12,100abc\n2024-01-19,0\n2024-01-22,-5\n2024-01-26,100'
    expect(parsedPoints(csv)).toEqual([{ date: '2024-01-26', price: 100 }])
  })

  it('reads the buy column when the file is dual-price (gold, no price column)', () => {
    const csv = 'date,buy,sell\n2024-01-05,7500000,7700000'
    expect(parsedPoints(csv)).toEqual([{ date: '2024-01-05', price: 7500000 }])
  })

  it('prefers the price column when a file has both price and buy', () => {
    const csv = 'date,price,buy\n2024-01-05,100,999'
    expect(parsedPoints(csv)).toEqual([{ date: '2024-01-05', price: 100 }])
  })

  it('returns an empty array for a header-only file', () => {
    expect(parsedPoints('date,price')).toEqual([])
  })

  it('keeps the last source row for a duplicate date and warns about the replaced row', () => {
    const parsed = parseCSV('date,price\n2024-01-05,100\n2024-01-12,200\n2024-01-05,110')

    expect(parsed.points).toEqual([
      { date: '2024-01-05', price: 110 },
      { date: '2024-01-12', price: 200 },
    ])
    expect(parsed.warnings).toEqual([{ row: 2, code: 'duplicate-date' }])
  })

  it('keeps usable rows and records malformed rows for the data boundary', () => {
    const parsed = parseCSV('date,price\n2024-01-05,100\nnot-a-date,200\n2024-01-19,0')

    expect(parsed.points).toEqual([{ date: '2024-01-05', price: 100 }])
    expect(parsed.warnings).toEqual([
      { row: 3, code: 'invalid-date' },
      { row: 4, code: 'invalid-price' },
    ])
    expect(parsed.warnings.map(formatCsvPriceWarning)).toEqual([
      'row 3: invalid-date',
      'row 4: invalid-price',
    ])
  })

  it('drops a parser-error row instead of accepting its truncated price', () => {
    const parsed = parseCSV('date,price\n2024-01-05,100,000\n2024-01-12,200')

    expect(parsed.points).toEqual([{ date: '2024-01-12', price: 200 }])
    expect(parsed.warnings).toEqual([{ row: 2, code: 'malformed-csv' }])
  })

  it('drops an unterminated quoted price on its physical source row', () => {
    const parsed = parseCSV('date,price\n2024-01-05,100\n2024-01-12,"200')

    expect(parsed.points).toEqual([{ date: '2024-01-05', price: 100 }])
    expect(parsed.warnings).toEqual([{ row: 3, code: 'malformed-csv' }])
  })

  it('rejects non-decimal price tokens', () => {
    const parsed = parseCSV('date,price\n2024-01-05,0x10\n2024-01-12,200')

    expect(parsed.points).toEqual([{ date: '2024-01-12', price: 200 }])
    expect(parsed.warnings).toEqual([{ row: 2, code: 'invalid-price' }])
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
    const parsed = parseGoldCSV(csv)
    expect({ buy: parsed.buy, sell: parsed.sell }).toEqual({
      buy: [
        { date: '2024-01-05', price: 7500000 },
        { date: '2024-01-12', price: 7600000 },
      ],
      sell: [
        { date: '2024-01-05', price: 7700000 },
        { date: '2024-01-12', price: 7800000 },
      ],
    })
    expect(parsed.warnings).toEqual([])
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

  it('keeps the last quote for duplicate gold dates', () => {
    const parsed = parseGoldCSV('date,buy,sell\n2024-01-05,100,110\n2024-01-05,120,130')

    expect(parsed.buy).toEqual([{ date: '2024-01-05', price: 120 }])
    expect(parsed.sell).toEqual([{ date: '2024-01-05', price: 130 }])
    expect(parsed.warnings).toEqual([
      { row: 2, code: 'duplicate-date' },
      { row: 2, code: 'duplicate-date' },
    ])
  })

  it('records which gold price was missing without dropping the other price', () => {
    const parsed = parseGoldCSV('date,buy,sell\n2024-01-05,7500000,0')

    expect(parsed.buy).toEqual([{ date: '2024-01-05', price: 7500000 }])
    expect(parsed.sell).toEqual([])
    expect(parsed.warnings).toEqual([{ row: 2, code: 'invalid-sell' }])
  })

  it('drops a malformed gold row before keeping either truncated price', () => {
    const parsed = parseGoldCSV('date,buy,sell\n2024-01-05,100,000,110\n2024-01-12,200,220')

    expect(parsed.buy).toEqual([{ date: '2024-01-12', price: 200 }])
    expect(parsed.sell).toEqual([{ date: '2024-01-12', price: 220 }])
    expect(parsed.warnings).toEqual([{ row: 2, code: 'malformed-csv' }])
  })

  it('drops an unterminated quoted gold row on its physical source row', () => {
    const parsed = parseGoldCSV('date,buy,sell\n2024-01-05,100,110\n2024-01-12,200,"220')

    expect(parsed.buy).toEqual([{ date: '2024-01-05', price: 100 }])
    expect(parsed.sell).toEqual([{ date: '2024-01-05', price: 110 }])
    expect(parsed.warnings).toEqual([{ row: 3, code: 'malformed-csv' }])
  })
})
