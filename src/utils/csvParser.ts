import Papa from 'papaparse'
import type { PricePoint, FundMeta } from '../types'

/**
 * Parse a CSV string with columns: date,price
 * Returns sorted ascending by date. Skips invalid rows.
 *
 * Cũng tự nhận diện CSV 2-giá (date,buy,sell — vd vàng miếng SJC): dùng cột
 * "buy" (giá mua vào) làm giá hiển thị chung, để mọi nơi trong dashboard
 * KHÔNG cần biết đến khái niệm 2-giá vẫn coi vàng như 1 quỹ "1 giá" bình
 * thường (nhất quán với DCA tab, vốn dùng chính giá này để định giá danh
 * mục xuyên suốt). Chỉ DCA tab mới cần phân biệt buy/sell riêng để tính đúng
 * chi phí mua vào — xem parseGoldCSV() + simulateDCA's purchasePrices option.
 */
export function parseCSV(csvText: string): PricePoint[] {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  const fields = result.meta.fields ?? []
  const isDualPrice = fields.includes('buy') && !fields.includes('price')
  const priceField = isDualPrice ? 'buy' : 'price'

  const points: PricePoint[] = []

  for (const row of result.data) {
    const date = row.date?.trim()
    const price = parseFloat(row[priceField] ?? '')

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
 * Trả về 2 chuỗi PricePoint[] riêng — dùng cho mô phỏng DCA có 2 giá
 * (mua ở giá sell, định giá/so sánh hiệu suất ở giá buy). Xem simulateDCA's
 * `purchasePrices` option trong utils/dca.ts.
 */
export function parseGoldCSV(csvText: string): { buy: PricePoint[]; sell: PricePoint[] } {
  const result = Papa.parse<{ date: string; buy: string; sell: string }>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  const buy: PricePoint[] = []
  const sell: PricePoint[] = []

  for (const row of result.data) {
    const date = row.date?.trim()
    if (!date || !isValidDate(date)) continue

    const buyPrice = parseFloat(row.buy)
    const sellPrice = parseFloat(row.sell)
    if (!isNaN(buyPrice) && buyPrice > 0) buy.push({ date, price: buyPrice })
    if (!isNaN(sellPrice) && sellPrice > 0) sell.push({ date, price: sellPrice })
  }

  buy.sort((a, b) => a.date.localeCompare(b.date))
  sell.sort((a, b) => a.date.localeCompare(b.date))
  return { buy, sell }
}

function isValidDate(str: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false
  const parsed = new Date(str)
  if (isNaN(parsed.getTime())) return false
  // Date.parse('2024-02-30') does not fail, it rolls over to Mar 1. Compare the
  // round-trip so an impossible calendar date is rejected instead of surviving
  // with its original (wrong) string.
  return parsed.toISOString().slice(0, 10) === str
}
