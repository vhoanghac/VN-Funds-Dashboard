import { describe, it, expect } from 'vitest'
import { CALCULATORS, DEFAULT_CALCULATOR_ID, findCalculator } from './CalculatorRegistry'

/**
 * Canh chặn registry. Thêm máy tính mới rất dễ copy nhầm id hoặc slug của cái cũ,
 * mà lỗi đó không làm build đỏ, chỉ làm deep-link dẫn sai chỗ.
 */
describe('CalculatorRegistry', () => {
  it('id không trùng nhau', () => {
    const ids = CALCULATORS.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('urlSlug không trùng nhau', () => {
    const slugs = CALCULATORS.map(c => c.urlSlug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('urlSlug viết thường, chỉ có chữ không dấu và dấu gạch ngang', () => {
    // Slug này sẽ thành đường dẫn thật khi tách route riêng, dính dấu tiếng Việt
    // hoặc chữ hoa là hỏng URL.
    for (const calc of CALCULATORS) {
      expect(calc.urlSlug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('máy tính nào cũng có nhãn và mô tả', () => {
    for (const calc of CALCULATORS) {
      expect(calc.label.trim().length).toBeGreaterThan(0)
      expect(calc.description.trim().length).toBeGreaterThan(0)
    }
  })

  it('DEFAULT_CALCULATOR_ID có thật trong registry', () => {
    expect(CALCULATORS.some(c => c.id === DEFAULT_CALCULATOR_ID)).toBe(true)
  })

  it('findCalculator trả đúng máy tính khi id hợp lệ', () => {
    for (const calc of CALCULATORS) {
      expect(findCalculator(calc.id).id).toBe(calc.id)
    }
  })

  it('findCalculator quay về máy tính đầu tiên khi id sai, null hoặc undefined', () => {
    const dauTien = CALCULATORS[0]!.id
    for (const bay of ['khong-ton-tai', '', null, undefined]) {
      expect(findCalculator(bay).id).toBe(dauTien)
    }
  })
})
