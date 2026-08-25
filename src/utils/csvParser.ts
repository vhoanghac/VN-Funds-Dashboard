import Papa from 'papaparse'
import type { PricePoint, FundMeta } from '../types'
import { isIsoDate } from './priceSeries'

export type CsvPriceWarningCode =
  | 'duplicate-date'
  | 'invalid-date'
  | 'invalid-price'
  | 'invalid-buy'
  | 'invalid-sell'
  | 'malformed-csv'

export interface CsvPriceWarning {
  row: number
  code: CsvPriceWarningCode
}

export interface ParsedPricePoints {
  points: PricePoint[]
  warnings: CsvPriceWarning[]
}

/**
 * Parse a CSV string with columns: date,price
 * Returns sorted ascending by date. Skips invalid rows.
 *
 * Cũng tự nhận diện CSV 2-giá (date,buy,sell — vd vàng miếng SJC): dùng cột
 * "buy" (giá mua vào) làm chuỗi giá hiển thị và định giá. So Sánh thay điểm
 * đầu bằng giá "sell" khi tính lợi nhuận của một khoảng bắt đầu bằng giao dịch
 * mua; DCA cũng dùng chuỗi "sell" riêng để tính đúng chi phí mua vào.
 */
export function parseCSV(csvText: string): ParsedPricePoints {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  const fields = result.meta.fields ?? []
  const isDualPrice = fields.includes('buy') && !fields.includes('price')
  const priceField = isDualPrice ? 'buy' : 'price'

  const parsedPoints: Array<{ point: PricePoint; row: number }> = []
  const warnings = parserWarnings(result.errors)
  const malformedRows = parserErrorRows(result.errors)

  for (let index = 0; index < result.data.length; index++) {
    const row = result.data[index]!
    const rowNumber = index + 2
    if (malformedRows.has(rowNumber)) continue

    const date = row.date?.trim()
    const price = parsePrice(row[priceField])

    if (!date || !isIsoDate(date)) {
      warnings.push({ row: rowNumber, code: 'invalid-date' })
      continue
    }
    if (price === null) {
      warnings.push({ row: rowNumber, code: 'invalid-price' })
      continue
    }

    parsedPoints.push({ point: { date, price }, row: rowNumber })
  }

  return { points: deduplicateDates(parsedPoints, warnings), warnings }
}

/**
 * Parse fund_metadata.json
 */
export function parseFundMetadata(jsonText: string): FundMeta[] {
  const data: unknown = JSON.parse(jsonText)

  if (!Array.isArray(data)) {
    throw new Error('fund_metadata.json must be an array')
  }

  return data.map((item: Record<string, unknown>) => ({
    id: String(item.id),
    name_vi: String(item.name_vi),
    type: (['etf', 'bond', 'balanced', 'crypto', 'gold'] as const).includes(item.type as never)
      ? item.type as 'etf' | 'bond' | 'balanced' | 'crypto' | 'gold'
      : 'mutual_fund' as const,
    start_date: String(item.start_date),
    csv_file: String(item.csv_file),
  }))
}

/**
 * Parse a gold CSV with columns: date,buy,sell (VND/lượng).
 *
 * "buy" = giá tiệm vàng mua vào (nhà đầu tư nhận được nếu bán ra).
 * "sell" = giá tiệm vàng bán ra (nhà đầu tư phải trả nếu mua vào).
 *
 * Trả về 2 chuỗi PricePoint[] riêng — DCA mua ở giá sell, còn So Sánh dùng giá
 * sell tại điểm bắt đầu rồi định giá các điểm sau ở giá buy. Xem
 * simulateDCA's `purchasePrices` option trong utils/dca.ts.
 */
export function parseGoldCSV(csvText: string): {
  buy: PricePoint[]
  sell: PricePoint[]
  warnings: CsvPriceWarning[]
} {
  const result = Papa.parse<{ date: string; buy: string; sell: string }>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  const buy: Array<{ point: PricePoint; row: number }> = []
  const sell: Array<{ point: PricePoint; row: number }> = []
  const warnings = parserWarnings(result.errors)
  const malformedRows = parserErrorRows(result.errors)

  for (let index = 0; index < result.data.length; index++) {
    const row = result.data[index]!
    const rowNumber = index + 2
    if (malformedRows.has(rowNumber)) continue

    const date = row.date?.trim()
    if (!date || !isIsoDate(date)) {
      warnings.push({ row: rowNumber, code: 'invalid-date' })
      continue
    }

    const buyPrice = parsePrice(row.buy)
    const sellPrice = parsePrice(row.sell)
    if (buyPrice !== null) buy.push({ point: { date, price: buyPrice }, row: rowNumber })
    else warnings.push({ row: rowNumber, code: 'invalid-buy' })
    if (sellPrice !== null) sell.push({ point: { date, price: sellPrice }, row: rowNumber })
    else warnings.push({ row: rowNumber, code: 'invalid-sell' })
  }

  return {
    buy: deduplicateDates(buy, warnings),
    sell: deduplicateDates(sell, warnings),
    warnings,
  }
}

export function formatCsvPriceWarning(warning: CsvPriceWarning): string {
  return `row ${warning.row}: ${warning.code}`
}

function parserWarnings(errors: Array<{ row?: number; code?: string }>): CsvPriceWarning[] {
  return errors.map(error => ({
    row: parserErrorRow(error) ?? 1,
    code: 'malformed-csv',
  }))
}

function parserErrorRows(errors: Array<{ row?: number; code?: string }>): Set<number> {
  const rows = new Set<number>()
  for (const error of errors) {
    const row = parserErrorRow(error)
    if (row !== null) rows.add(row)
  }
  return rows
}

function parserErrorRow(error: { row?: number; code?: string }): number | null {
  if (typeof error.row !== 'number') return null
  // Papa Parse uses a physical source-line index for unterminated quotes, but
  // a zero-based data-row index for field-count errors.
  return error.code === 'MissingQuotes' ? error.row + 1 : error.row + 2
}

function deduplicateDates(
  entries: Array<{ point: PricePoint; row: number }>,
  warnings: CsvPriceWarning[],
): PricePoint[] {
  const byDate = new Map<string, { point: PricePoint; row: number }>()
  for (const entry of entries) {
    const previous = byDate.get(entry.point.date)
    if (previous) warnings.push({ row: previous.row, code: 'duplicate-date' })
    // A later source row may be a corrected NAV for the same day.
    byDate.set(entry.point.date, entry)
  }

  return Array.from(byDate.values())
    .map(entry => entry.point)
    .sort((a, b) => a.date.localeCompare(b.date))
}

function parsePrice(value: string | undefined): number | null {
  const token = value?.trim() ?? ''
  if (!/^\d+(?:\.\d+)?$/.test(token)) return null

  const price = Number(token)
  return Number.isFinite(price) && price > 0 ? price : null
}
