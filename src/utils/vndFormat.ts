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

/** Full VND, ví dụ 2.500.000.000 đ, dùng cho tooltip chi tiết */
export function formatVNDFull(value: number): string {
  return Math.round(value).toLocaleString('vi-VN') + ' đ'
}

/**
 * Trả về câu so sánh đời thực cho một khoản tiền (thường là delta).
 * Null nếu số tiền quá nhỏ để có câu phù hợp.
 *
 * Mỗi mốc gắn với giá thực tế VN 2026 của món đồ đó (retail-friendly):
 * xe máy → ô tô → nghỉ hưu. Chọn mốc có giá gần nhất theo tỷ lệ (log-scale)
 * thay vì "vượt ngưỡng nào thì lấy ngưỡng đó", để tránh trường hợp một số tiền
 * gần gấp đôi giá thực của món đồ vẫn bị gán nhãn món đồ đó.
 */
export function vndComparison(value: number): string | null {
  const v = Math.abs(value)
  if (v < 15_000_000) return null

  // Giá thực tế ước tính của từng món đồ (không phải ngưỡng tối thiểu)
  const anchors: { price: number; label: string }[] = [
    { price: 20_000_000,     label: 'một chiếc xe máy số phổ thông (Honda Wave, Wave Alpha)' },
    { price: 30_000_000,     label: 'một chiếc iPhone mới' },
    { price: 45_000_000,     label: 'một chiếc xe tay ga phổ thông (Honda Vision, Air Blade)' },
    { price: 100_000_000,    label: 'một chiếc xe SH hoặc Vespa xịn' },
    { price: 250_000_000,    label: 'một chiếc mô tô phân khối lớn (Royal Enfield, Kawasaki Z-series)' },
    { price: 400_000_000,    label: 'một chiếc ô tô cũ cho gia đình' },
    { price: 550_000_000,    label: 'một chiếc Toyota Vios hoặc Honda City mới' },
    { price: 1_000_000_000,  label: 'một chiếc Mazda CX-5 hoặc Honda CR-V' },
    { price: 2_000_000_000,  label: 'một chiếc Mercedes C-Class hoặc BMW 3-Series' },
    { price: 5_000_000_000,  label: 'vốn để mở một quán cà phê hoặc cửa hàng nhỏ' },
    { price: 10_000_000_000, label: 'nghỉ hưu sớm với lãi gửi ngân hàng ~400 triệu/năm' },
    { price: 25_000_000_000, label: 'nghỉ hưu sớm 15-20 năm' },
  ]

  // Chọn mốc có tỷ lệ giá/value gần 1 nhất (so sánh trên thang log để công bằng
  // giữa các bậc độ lớn khác nhau)
  let chosen = anchors[0]!
  let bestDist = Infinity
  for (const a of anchors) {
    const dist = Math.abs(Math.log(v / a.price))
    if (dist < bestDist) {
      bestDist = dist
      chosen = a
    }
  }
  return chosen.label
}

/**
 * Bản rút gọn của formatVND, dùng cho nhãn trục biểu đồ.
 *   250_000_000    → "250tr"
 *   2_500_000_000  → "2,5 tỷ"
 *
 * Khác formatVND ở chỗ bỏ khoảng trắng trước "tr". Nhãn trục Y có khung hẹp,
 * chuỗi "250 triệu" bị Recharts ngắt làm hai dòng, còn "250tr" thì vừa.
 * Mốc tỷ vẫn giữ khoảng trắng vì "2,5tỷ" đọc dính chữ, mà chuỗi cũng đã ngắn.
 */
export function formatVNDAxis(value: number): string {
  const v = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (v >= 1_000_000_000) {
    const ty = v / 1_000_000_000
    const fmt = ty >= 10 ? ty.toFixed(0) : ty.toFixed(1).replace(/\.0$/, '')
    return `${sign}${fmt.replace('.', ',')} tỷ`
  }
  if (v >= 1_000_000) {
    return `${sign}${Math.round(v / 1_000_000)}tr`
  }
  if (v >= 1_000) {
    return `${sign}${Math.round(v / 1_000)}k`
  }
  return `${sign}${Math.round(v)}`
}

/** Xác định dấu cho delta, ví dụ +250 triệu / -30 triệu */
export function signedVND(value: number): string {
  if (value > 0) return '+' + formatVND(value)
  if (value < 0) return formatVND(value) // formatVND đã xử lý dấu âm
  return formatVND(0)
}
