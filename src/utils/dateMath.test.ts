import { describe, expect, it } from 'vitest'
import { daysBetween } from './dateMath'

describe('daysBetween', () => {
  it('cùng ngày trả về 0', () => {
    expect(daysBetween('2024-01-01', '2024-01-01')).toBe(0)
  })

  it('cách đúng số ngày trong cùng năm', () => {
    expect(daysBetween('2024-01-01', '2024-01-08')).toBe(7)
  })

  it('trả âm khi đảo thứ tự tham số', () => {
    expect(daysBetween('2024-01-08', '2024-01-01')).toBe(-7)
  })

  it('qua năm nhuận (29/02/2024 tồn tại)', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2)
  })

  it('năm thường không có 29/02 — 28/02 đến 01/03 chỉ 1 ngày lịch', () => {
    expect(daysBetween('2023-02-28', '2023-03-01')).toBe(1)
  })

  it('lệch qua ranh giới năm', () => {
    expect(daysBetween('2023-12-31', '2024-01-01')).toBe(1)
  })

  it('lệch dài nhiều năm', () => {
    expect(daysBetween('2014-01-01', '2024-01-01')).toBe(3652)
  })

  it('chuỗi không phải ngày hợp lệ trả NaN, không văng lỗi', () => {
    expect(daysBetween('', '2024-01-01')).toBeNaN()
    expect(daysBetween('không-phải-ngày', '2024-01-01')).toBeNaN()
  })
})
