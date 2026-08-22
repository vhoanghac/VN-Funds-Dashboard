import type { PricePoint, PriceSeries } from '../types'
import { createPriceSeries, toPriceSeriesPoints } from './priceSeries'

/**
 * Tài sản giả lập "tiết kiệm ngân hàng, lãi suất cố định", dùng để trộn
 * chung với ETF/quỹ trong danh mục đa tài sản, thay vì ép người dùng
 * chọn DCBF (quỹ trái phiếu, có rủi ro NAV và phí quản lý riêng) làm đại
 * diện cho phần tiền gửi tiết kiệm.
 *
 * ID dạng "SAVINGS:<rate>" (vd "SAVINGS:6" = lãi suất 6%/năm cố định), mã
 * hoá lãi suất ngay trong id để tái dùng toàn bộ hạ tầng slot/weight/rebalance
 * hiện có mà không cần thêm field mới vào DCASlot.
 *
 * Dùng ở các tab: DCA, So Sánh, Tái Cân Bằng, Bitcoin.
 */
export const SAVINGS_ID_PREFIX = 'SAVINGS:'

/** Lãi suất mặc định khi người dùng vừa chọn "Tiết kiệm ngân hàng" trong danh sách quỹ. */
export const DEFAULT_SAVINGS_RATE = 6

/** Các mức thử lần lượt khi mức mặc định đã bị chiếm, xem pickDefaultSavingsRate. */
const SAVINGS_RATE_FALLBACKS = [6, 7, 8, 5, 9, 4, 10]

/**
 * Chọn lãi suất mặc định cho một ô chọn quỹ MỚI, tránh trùng với các mức lãi
 * suất tiết kiệm đã dùng ở NHỮNG Ô KHÁC trong cùng danh sách so sánh/danh mục.
 *
 * Không có bước này, 2 ô cùng chọn "Tiết kiệm ngân hàng" sẽ cùng ra id
 * SAVINGS:6, tức 2 phần tử trùng id trong danh sách hiển thị (KPICards,
 * MonthlyHeatmap, CompareStoryBlock...), React cảnh báo key trùng ở console.
 * Không sai số liệu (2 ô lúc đó y hệt nhau) nhưng dọn sạch từ gốc rẻ hơn.
 */
export function pickDefaultSavingsRate(usedRates: Iterable<number>): number {
  const used = new Set(usedRates)
  return SAVINGS_RATE_FALLBACKS.find(r => !used.has(r)) ?? DEFAULT_SAVINGS_RATE
}

/** Nhãn hiển thị trong danh sách chọn quỹ, dùng chung cho mọi mức lãi suất vì rate sửa bằng ô nhập riêng ngay cạnh weight. */
export const SAVINGS_OPTION_LABEL = 'Tiết kiệm ngân hàng (lãi suất cố định, tự nhập)'

export function savingsAssetId(ratePct: number): string {
  return `${SAVINGS_ID_PREFIX}${ratePct}`
}

export function isSavingsAssetId(id: string): boolean {
  return id.startsWith(SAVINGS_ID_PREFIX)
}

/** Đọc lại lãi suất (%) đã mã hoá trong id "SAVINGS:<rate>". NaN → 0. */
export function parseSavingsRate(id: string): number {
  const rate = Number(id.slice(SAVINGS_ID_PREFIX.length))
  return Number.isFinite(rate) ? rate : 0
}

/**
 * Tên hiển thị trên biểu đồ, bảng, narrative. Id thô ("SAVINGS:6") chỉ là
 * khoá nội bộ, đọc lên không ra nghĩa gì với người dùng.
 */
export function assetDisplayName(id: string): string {
  if (!isSavingsAssetId(id)) return id
  return `Tiết kiệm ${parseSavingsRate(id)}%/năm`
}

/**
 * Mốc bắt đầu chuỗi giá tiết kiệm. Chọn sớm hơn mọi quỹ thật đang có (quỹ
 * đời đầu bắt đầu 2004) để phần tiết kiệm không bao giờ là thứ cắt cụt kỳ
 * so sánh: cửa sổ chung luôn do quỹ thật quyết định.
 */
export const SAVINGS_SERIES_START = '2000-01-01'

/**
 * Chuỗi giá đầy đủ cho một id tiết kiệm, từ SAVINGS_SERIES_START tới hôm nay.
 * Đây là chỗ duy nhất các tab gọi tới, để 4 tab không ai tự chế lại mốc ngày
 * rồi lệch nhau.
 */
export function savingsSeriesForId(id: string): PricePoint[] {
  const today = new Date().toISOString().substring(0, 10)
  return generateSavingsSeries(parseSavingsRate(id), SAVINGS_SERIES_START, today)
}

export function savingsPriceSeriesForId(id: string): PriceSeries {
  return createPriceSeries({
    assetId: id,
    currency: 'VND',
    points: toPriceSeriesPoints(savingsSeriesForId(id)),
    adjustments: [],
    source: 'synthetic:savings',
  })
}

/**
 * Xoá các chuỗi giá tiết kiệm không còn ai dùng ra khỏi cache của một tab.
 *
 * Lãi suất nằm ngay trong id, nên mỗi lần người dùng đổi lãi suất là sinh ra
 * một key mới (SAVINGS:6 rồi SAVINGS:6,5 rồi SAVINGS:7). Key cũ không còn chỗ
 * nào trỏ tới nhưng vẫn nằm lại trong Map, mỗi cái giữ khoảng 9.700 điểm giá
 * (tầm 645KB). Gõ thử mươi mức lãi suất là cache phình lên vài MB rồi ở đó
 * tới lúc tải lại trang.
 *
 * Quỹ thật thì không cần dọn: danh sách của chúng cố định nên cache tự có trần.
 * Chỉ tài sản giả lập mới có không gian id mở, và đó là thứ duy nhất hàm này
 * đụng tới.
 *
 * @param cache Map giá của tab, sửa tại chỗ (gọi bên trong updater của setState).
 * @param inUse Toàn bộ id đang thực sự được chọn trên tab đó, không phải chỉ
 *              những id vừa nạp thêm.
 */
export function pruneUnusedSavings<T>(cache: Map<string, T>, inUse: Iterable<string>): void {
  const keep = new Set(inUse)
  for (const key of cache.keys()) {
    if (isSavingsAssetId(key) && !keep.has(key)) cache.delete(key)
  }
}

/**
 * Sinh chuỗi giá hàng ngày cho tài sản tiết kiệm lãi kép cố định, từ
 * `fromDate` đến `toDate` (bao gồm cả hai đầu), gốc 100 tại `fromDate`.
 *
 * Lãi kép hàng ngày theo công thức đóng (không lặp từng ngày để tính), giả
 * định 365,25 ngày/năm, khớp với cách MONTHLY_FACTOR trong dca.ts quy đổi lịch.
 */
export function generateSavingsSeries(ratePct: number, fromDate: string, toDate: string): PricePoint[] {
  const from = new Date(fromDate + 'T00:00:00Z')
  const to = new Date(toDate + 'T00:00:00Z')
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return []

  const annualRate = ratePct / 100
  const points: PricePoint[] = []
  const msPerDay = 24 * 60 * 60 * 1000

  for (let t = from.getTime(); t <= to.getTime(); t += msPerDay) {
    const daysElapsed = (t - from.getTime()) / msPerDay
    const price = 100 * Math.pow(1 + annualRate, daysElapsed / 365.25)
    points.push({ date: new Date(t).toISOString().substring(0, 10), price })
  }
  return points
}
