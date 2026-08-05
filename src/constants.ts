export const FUND_COLORS = [
  '#2563EB', // blue
  '#DC2626', // red
  '#059669', // green
  '#F59E0B', // amber
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
]

export const MAX_COMPARE_FUNDS = 8
export const DEFAULT_FUNDS = ['DCDS', 'E1VFVN30']

/**
 * Danh sách máy tính của tab "Máy tính", nguồn duy nhất.
 *
 * Kiểu `CalculatorId` trong types.ts suy ra từ chính mảng này, còn registry
 * (`CalculatorRegistry.ts`) có test canh phải phủ đủ. Thêm máy tính mới chỉ sửa
 * một chỗ ở đây, quên chỗ nào là tsc hoặc test bắt được ngay.
 */
export const CALCULATOR_IDS = ['compound', 'cagr', 'fee-erosion'] as const
