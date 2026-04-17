/**
 * Định dạng số tiền VND thành chuỗi ngắn, dễ đọc cho retail VN.
 *   1_500_000       → "1.5 triệu"
 *   250_000_000     → "250 triệu"
 *   2_500_000_000   → "2.5 tỷ"
 *   12_300_000_000  → "12.3 tỷ"
 */
export function formatVND(value: number): string {
  const v = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (v >= 1_000_000_000) {
    const ty = v / 1_000_000_000
    // 1.5 tỷ, nhưng 10 tỷ không cần decimal
    const fmt = ty >= 10 ? ty.toFixed(1).replace(/\.0$/, '') : ty.toFixed(2).replace(/\.?0+$/, '')
    return `${sign}${fmt} tỷ`
  }
  if (v >= 1_000_000) {
    const tr = v / 1_000_000
    const fmt = tr >= 10 ? tr.toFixed(0) : tr.toFixed(1).replace(/\.0$/, '')
    return `${sign}${fmt} triệu`
  }
  if (v >= 1_000) {
    return `${sign}${(v / 1_000).toFixed(0)}k`
  }
  return `${sign}${Math.round(v)}`
}

/** Full VND, ví dụ 2.500.000.000 đ — dùng cho tooltip chi tiết */
export function formatVNDFull(value: number): string {
  return Math.round(value).toLocaleString('vi-VN') + ' đ'
}

/**
 * Trả về câu so sánh đời thực cho một khoản tiền (thường là delta).
 * Null nếu số tiền quá nhỏ hoặc quá lớn để có câu phù hợp.
 *
 * Pool đã được hiệu chỉnh theo giá thực tế VN 2026 (retail-friendly):
 * tập trung vào xe máy → ô tô → nghỉ hưu.
 */
export function vndComparison(value: number): string | null {
  const v = Math.abs(value)
  if (v < 15_000_000) return null

  // Mốc so sánh — lấy mốc gần nhất với giá trị
  const anchors: { min: number; label: string }[] = [
    { min: 15_000_000,     label: 'một chiếc iPhone mới' },
    { min: 35_000_000,     label: 'một chiếc xe SH hoặc Vespa xịn' },
    { min: 80_000_000,     label: 'một chiếc xe mô tô phân khối lớn' },
    { min: 200_000_000,    label: 'một chiếc ô tô cũ cho gia đình' },
    { min: 400_000_000,    label: 'một chiếc Toyota Vios hoặc Honda City mới' },
    { min: 800_000_000,    label: 'một chiếc Mazda CX-5 hoặc Honda CR-V' },
    { min: 1_800_000_000,  label: 'một chiếc Mercedes C-Class hoặc BMW 3-Series' },
    { min: 4_000_000_000,  label: 'vốn để mở một quán cà phê hoặc cửa hàng nhỏ' },
    { min: 8_000_000_000,  label: 'nghỉ hưu sớm với lãi gửi ngân hàng ~400 triệu/năm' },
    { min: 20_000_000_000, label: 'nghỉ hưu sớm 15-20 năm' },
  ]

  // Chọn mốc cao nhất mà value vẫn vượt qua
  let chosen: string | null = null
  for (const a of anchors) {
    if (v >= a.min) chosen = a.label
    else break
  }
  return chosen
}

/** Xác định dấu cho delta, ví dụ +250 triệu / -30 triệu */
export function signedVND(value: number): string {
  if (value > 0) return '+' + formatVND(value)
  if (value < 0) return formatVND(value) // formatVND đã xử lý dấu âm
  return formatVND(0)
}
