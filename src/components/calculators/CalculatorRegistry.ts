import type { ComponentType } from 'react'
import type { CalculatorId } from '../../types'
import { CompoundInterestCalc } from './CompoundInterestCalc'
import { CagrCalc } from './CagrCalc'
import { FundFeeErosionCalc } from './FundFeeErosionCalc'

/**
 * Danh bạ các máy tính trong tab "Máy tính".
 *
 * `urlSlug` chưa dùng tới. Hiện tại điều hướng bằng query param
 * `?tab=calculator&calcId=<id>`. Khai sẵn slug ngay từ bây giờ để sau này tách
 * route riêng (`/may-tinh-lai-kep`) thì chỉ cần đọc field có sẵn, khỏi bới lại
 * từng component đặt tên.
 *
 * Thêm máy tính mới: viết component self-contained, thêm một dòng vào mảng dưới
 * đây, thêm id vào union `CalculatorId` trong `types.ts`. Không đụng gì khác.
 */
export interface CalculatorEntry {
  id: CalculatorId
  label: string
  /** Mô tả ngắn hiện dưới nút điều hướng */
  description: string
  /** Đường dẫn dự kiến khi tách route riêng, chưa dùng */
  urlSlug: string
  component: ComponentType
}

export const CALCULATORS: CalculatorEntry[] = [
  {
    id: 'compound',
    label: 'Lãi kép',
    description: 'Vốn ban đầu và tiền góp thêm mỗi tháng sinh ra bao nhiêu sau N năm',
    urlSlug: 'may-tinh-lai-kep',
    component: CompoundInterestCalc,
  },
  {
    id: 'cagr',
    label: 'Quy đổi CAGR',
    description: 'Từ hai mốc giá trị ra lợi nhuận kép mỗi năm',
    urlSlug: 'may-tinh-cagr',
    component: CagrCalc,
  },
  {
    id: 'fee-erosion',
    label: 'Phí quỹ ăn mòn',
    description: 'Phí thu mỗi năm lấy mất bao nhiêu tài sản sau N năm',
    urlSlug: 'may-tinh-phi-quy',
    component: FundFeeErosionCalc,
  },
]

/** Máy tính mở ra đầu tiên khi vào tab, cũng là chỗ quay về khi calcId không hợp lệ */
export const DEFAULT_CALCULATOR_ID: CalculatorId = 'compound'

export function findCalculator(id: string | null | undefined): CalculatorEntry {
  return CALCULATORS.find(c => c.id === id) ?? CALCULATORS[0]!
}
