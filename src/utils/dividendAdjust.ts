/**
 * Dividend adjustment for raw NAV price series.
 *
 * Nguồn dữ liệu trả về raw NAV. Vào ex-date, NAV rớt theo khoản cổ tức chi trả.
 * Nếu không adjust, biểu đồ hiệu suất sẽ thiếu phần lợi nhuận từ cổ tức.
 *
 * Xác nhận chính thức từ DCDE (13/07/2026): từ 14/07/2026, giá NAV công bố
 * trên app KHÔNG bao gồm cổ tức (ex-dividend) — đúng như giả định code này
 * vẫn dùng từ trước. Không cần thay đổi gì, chỉ ghi lại làm căn cứ audit.
 *
 * Cách làm: Yahoo Finance style tax-adjusted factor.
 *   factor = (closePreEx − dividend × (1 − tax)) / closePreEx
 *   Nhân tất cả giá TỪ ex-date TRỞ VỀ TRƯỚC với factor.
 *
 * Tax-adjusted theo taxRate của từng DividendEvent để con số cuối cùng phản ánh
 * đúng những gì nhà đầu tư thực sự nhận được sau khi trừ thuế tại nguồn.
 *
 * Nếu có nhiều đợt cổ tức, áp dụng theo thứ tự thời gian — mỗi factor
 * đã được tính dựa trên closePreEx HIỆN TẠI (sau khi các factor trước
 * đã áp dụng), nên kết quả đúng tự động.
 *
 * File .csv trên disk KHÔNG thay đổi. Đây là transform in-memory khi
 * browser load dữ liệu.
 */
import type { PricePoint } from '../types'

export interface DividendEvent {
  /** Ngày chốt danh sách (NAV rớt ngày này) YYYY-MM-DD */
  exDate: string
  /** Ngày thực tế nhận tiền + tái đầu tư YYYY-MM-DD */
  payDate: string
  /** Số tiền cổ tức trên mỗi ccq (VND, gross, trước thuế) */
  amountPerCert: number
  /** Thuế TNCN ở nguồn (vd 0.05 = 5%) */
  taxRate: number
}

export interface DividendAdjustmentResult {
  points: PricePoint[]
  appliedEvents: DividendEvent[]
}

/**
 * Áp dụng dividend adjustment cho một chuỗi giá raw NAV.
 *
 * @param daily Giá gốc từ CSV (sorted ascending by date)
 * @param events Các đợt cổ tức của quỹ này (có thể rỗng)
 * @returns Chuỗi giá mới, đã adjust. Giá mới nhất giữ nguyên, giá cũ
 *          được scale xuống theo từng đợt cổ tức. Số lượng điểm không đổi.
 */
export function applyDividendAdjustment(
  daily: PricePoint[],
  events: DividendEvent[],
): PricePoint[] {
  return applyDividendAdjustments(daily, events).points
}

export function applyDividendAdjustments(
  daily: PricePoint[],
  events: DividendEvent[],
): DividendAdjustmentResult {
  if (events.length === 0 || daily.length === 0) {
    return { points: daily, appliedEvents: [] }
  }

  // Sắp xếp events theo ex-date (thứ tự xử lý: cũ → mới)
  const sorted = [...events].sort((a, b) => a.exDate.localeCompare(b.exDate))

  // Clone để không mutate input
  const out: PricePoint[] = daily.map(p => ({ date: p.date, price: p.price }))
  const appliedEvents: DividendEvent[] = []

  for (const ev of sorted) {
    // Tìm giá đóng cửa ngay TRƯỚC ex-date (closePreEx)
    // Iterate ngược từ cuối, tìm điểm có date < exDate
    let closePreExIdx = -1
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i]!.date < ev.exDate) { closePreExIdx = i; break }
    }
    // Không có điểm nào trước ex-date → event xảy ra trước series bắt đầu
    // → không ảnh hưởng giá nào trong series, skip
    if (closePreExIdx === -1) continue

    const closePreEx = out[closePreExIdx]!.price
    const netDiv = ev.amountPerCert * (1 - ev.taxRate)
    // Factor bảo vệ: không để < 0 (trường hợp cổ tức > NAV, không xảy ra thực tế)
    const factor = Math.max(0, (closePreEx - netDiv) / closePreEx)
    if (factor >= 1 || factor <= 0) continue // nothing to adjust

    // Nhân factor vào TẤT CẢ giá từ đầu đến closePreExIdx (inclusive)
    for (let i = 0; i <= closePreExIdx; i++) {
      out[i]!.price = out[i]!.price * factor
    }
    appliedEvents.push(ev)
  }

  return { points: out, appliedEvents }
}

/**
 * Shared cache cho dividends.json. Load 1 lần / session.
 */
let _dividendsCache: Map<string, DividendEvent[]> | null = null
let _dividendsPromise: Promise<Map<string, DividendEvent[]>> | null = null

export async function loadDividends(): Promise<Map<string, DividendEvent[]>> {
  if (_dividendsCache) return _dividendsCache
  if (_dividendsPromise) return _dividendsPromise

  _dividendsPromise = (async () => {
    try {
      const resp = await fetch('/data/dividends.json')
      if (!resp.ok) {
        _dividendsCache = new Map()
        return _dividendsCache
      }
      const raw = (await resp.json()) as Record<string, DividendEvent[]>
      const map = new Map<string, DividendEvent[]>()
      for (const [fundId, events] of Object.entries(raw)) {
        if (Array.isArray(events) && events.length > 0) {
          map.set(fundId, events)
        }
      }
      _dividendsCache = map
      return map
    } catch {
      _dividendsCache = new Map()
      return _dividendsCache
    }
  })()

  return _dividendsPromise
}

/** Load dividend metadata and return both adjusted points and applied events. */
export async function loadAdjustedPriceData(
  fundId: string,
  rawDaily: PricePoint[],
): Promise<DividendAdjustmentResult> {
  const dividends = await loadDividends()
  return applyDividendAdjustments(rawDaily, dividends.get(fundId) ?? [])
}

/**
 * Thống kê cổ tức cho narrative — tính trên RAW NAV để có "số ccq thật" và
 * "tiền thật" nhà đầu tư nhận được. Khác với hiệu suất TWRR/MWRR (đã tính
 * trên adjusted NAV), phần này phản ánh dòng tiền và số ccq như trên sao
 * kê tài khoản thực tế.
 */
export interface DividendEventStats {
  exDate: string
  payDate: string
  /** Số ccq nhà đầu tư đang nắm tại ex-date (được hưởng cổ tức) */
  unitsAtEx: number
  /** Tiền cổ tức gross cho toàn bộ số ccq (= unitsAtEx × amountPerCert) */
  gross: number
  /** Thuế TNCN bị khấu trừ tại nguồn */
  tax: number
  /** Tiền ròng nhận được sau thuế */
  net: number
  /** Số ccq mua thêm từ net cash tái đầu tư tại raw NAV pay-date */
  sharesAdded: number
}

export interface DividendNarrativeStats {
  fundId: string
  eventCount: number
  /** Chi tiết từng đợt, sorted theo exDate */
  events: DividendEventStats[]
  /** Tổng cổ tức gross (trước thuế) VND */
  totalGross: number
  /** Tổng thuế theo taxRate của từng DividendEvent đã trừ tại nguồn VND */
  totalTax: number
  /** Tổng tiền ròng nhà đầu tư nhận được VND */
  totalNet: number
  /** Tổng ccq mua thêm từ cash ròng tái đầu tư */
  totalSharesAdded: number
}
