import Papa from 'papaparse'
import type { PricePoint, FundMeta } from '../types'

/**
 * Parse a CSV string with columns: date,price
 * Returns sorted ascending by date. Skips invalid rows.
 */
export function parseCSV(csvText: string): PricePoint[] {
  const result = Papa.parse<{ date: string; price: string }>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  const points: PricePoint[] = []

  for (const row of result.data) {
    const date = row.date?.trim()
    const price = parseFloat(row.price)

    if (!date || !isValidDate(date) || isNaN(price) || price <= 0) {
      continue
    }

    points.push({ date, price })
  }

  points.sort((a, b) => a.date.localeCompare(b.date))
  return points
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
    type: (['etf', 'bond', 'balanced', 'crypto'] as const).includes(item.type as never)
      ? item.type as 'etf' | 'bond' | 'balanced' | 'crypto'
      : 'mutual_fund' as const,
    start_date: String(item.start_date),
    csv_file: String(item.csv_file),
  }))
}

function isValidDate(str: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str))
}
