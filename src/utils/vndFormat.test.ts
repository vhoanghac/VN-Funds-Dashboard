import { describe, it, expect } from 'vitest'
import { formatVND, formatVNDAxis, formatVNDFull, vndComparison, signedVND } from './vndFormat'

describe('formatVND', () => {
  it('formats the examples the function documents', () => {
    expect(formatVND(1_500_000)).toBe('1.5 triệu')
    expect(formatVND(250_000_000)).toBe('250 triệu')
    expect(formatVND(2_500_000_000)).toBe('2.5 tỷ')
    expect(formatVND(12_300_000_000)).toBe('12.3 tỷ')
  })

  it('drops the decimal on a round number', () => {
    expect(formatVND(2_000_000_000)).toBe('2 tỷ')
    expect(formatVND(5_000_000)).toBe('5 triệu')
  })

  it('switches to one decimal at 10 tỷ and above', () => {
    // Under 10 tỷ the code keeps two decimals, at and above it keeps one.
    expect(formatVND(9_990_000_000)).toBe('9.99 tỷ')
    expect(formatVND(10_000_000_000)).toBe('10 tỷ')
    expect(formatVND(10_460_000_000)).toBe('10.5 tỷ')
  })

  it('rounds a half down when the float sits just under it', () => {
    // 10.45 is stored slightly below 10.45, so toFixed(1) gives 10.4 rather
    // than 10.5. Standard JS behaviour, recorded so a future rewrite that
    // changes rounding does not do it by accident.
    expect(formatVND(10_450_000_000)).toBe('10.4 tỷ')
  })

  it('drops the decimal on triệu at 10 and above', () => {
    expect(formatVND(9_900_000)).toBe('9.9 triệu')
    expect(formatVND(12_600_000)).toBe('13 triệu')
  })

  it('uses k below one million', () => {
    expect(formatVND(250_000)).toBe('250k')
    expect(formatVND(1_000)).toBe('1k')
  })

  it('prints small amounts as a plain rounded number', () => {
    expect(formatVND(999)).toBe('999')
    expect(formatVND(0)).toBe('0')
    expect(formatVND(499.6)).toBe('500')
  })

  it('keeps the minus sign on every scale', () => {
    expect(formatVND(-2_500_000_000)).toBe('-2.5 tỷ')
    expect(formatVND(-1_500_000)).toBe('-1.5 triệu')
    expect(formatVND(-250_000)).toBe('-250k')
    expect(formatVND(-999)).toBe('-999')
  })

  it('crosses each unit boundary cleanly', () => {
    expect(formatVND(999_999)).toBe('1000k')
    expect(formatVND(1_000_000)).toBe('1 triệu')
    expect(formatVND(999_999_999)).toBe('1000 triệu')
    expect(formatVND(1_000_000_000)).toBe('1 tỷ')
  })
})

describe('formatVNDFull', () => {
  it('writes the whole number with Vietnamese grouping', () => {
    expect(formatVNDFull(2_500_000_000)).toBe('2.500.000.000 đ')
  })

  it('rounds to the nearest đồng', () => {
    expect(formatVNDFull(1_234.6)).toBe('1.235 đ')
  })

  it('keeps negative amounts negative', () => {
    expect(formatVNDFull(-1_000_000)).toBe('-1.000.000 đ')
  })
})

describe('vndComparison', () => {
  it('says nothing when the amount is too small to compare', () => {
    expect(vndComparison(14_999_999)).toBeNull()
    expect(vndComparison(0)).toBeNull()
  })

  it('picks the anchor whose price is closest, not the last one passed', () => {
    // 500 triệu sits between the 400 triệu used car and the 550 triệu Vios.
    // On a log scale 550 is the nearer of the two.
    expect(vndComparison(500_000_000)).toContain('Vios')
    expect(vndComparison(410_000_000)).toContain('ô tô cũ')
  })

  it('matches an anchor exactly on its own price', () => {
    expect(vndComparison(20_000_000)).toContain('xe máy số')
    expect(vndComparison(1_000_000_000)).toContain('CX-5')
  })

  it('treats a loss the same as a gain of the same size', () => {
    expect(vndComparison(-550_000_000)).toBe(vndComparison(550_000_000))
  })

  it('falls back to the cheapest anchor just above the floor', () => {
    expect(vndComparison(15_000_000)).toContain('xe máy số')
  })

  it('sticks to the most expensive anchor beyond the top of the scale', () => {
    expect(vndComparison(500_000_000_000)).toContain('nghỉ hưu sớm 15-20 năm')
  })
})

describe('signedVND', () => {
  it('adds a plus sign to a gain', () => {
    expect(signedVND(250_000_000)).toBe('+250 triệu')
  })

  it('leaves the minus sign alone on a loss, without doubling it', () => {
    expect(signedVND(-30_000_000)).toBe('-30 triệu')
  })

  it('gives zero no sign at all', () => {
    expect(signedVND(0)).toBe('0')
  })
})

describe('formatVNDAxis', () => {
  it('bỏ khoảng trắng ở mốc triệu để nhãn trục không bị ngắt dòng', () => {
    expect(formatVNDAxis(250_000_000)).toBe('250tr')
    expect(formatVNDAxis(600_000_000)).toBe('600tr')
    expect(formatVNDAxis(1_500_000)).toBe('2tr')
  })

  it('giữ khoảng trắng ở mốc tỷ, dùng dấu phẩy thập phân', () => {
    expect(formatVNDAxis(2_500_000_000)).toBe('2,5 tỷ')
    expect(formatVNDAxis(3_000_000_000)).toBe('3 tỷ')
    expect(formatVNDAxis(12_300_000_000)).toBe('12 tỷ')
  })

  it('mốc nghìn và mốc nhỏ', () => {
    expect(formatVNDAxis(30_000)).toBe('30k')
    expect(formatVNDAxis(0)).toBe('0')
  })

  it('giữ dấu âm', () => {
    expect(formatVNDAxis(-250_000_000)).toBe('-250tr')
    expect(formatVNDAxis(-2_500_000_000)).toBe('-2,5 tỷ')
  })

  it('nhãn luôn ngắn hơn bản đầy đủ, không có chuỗi nào dài quá 7 ký tự', () => {
    // 7 ký tự ở cỡ chữ 11px vẫn vừa khung trục 62px, đây là điều kiện để
    // Recharts không ngắt nhãn làm hai dòng.
    for (const v of [0, 30_000, 999_000, 1_000_000, 600_000_000, 2_500_000_000, 99_000_000_000]) {
      expect(formatVNDAxis(v).length).toBeLessThanOrEqual(7)
    }
  })
})
