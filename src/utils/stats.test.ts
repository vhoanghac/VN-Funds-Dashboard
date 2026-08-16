import { describe, expect, it } from 'vitest'
import { percentileSorted } from './stats'

describe('percentileSorted', () => {
  it('mảng rỗng trả 0 (hành vi lịch sử)', () => {
    expect(percentileSorted([], 0.5)).toBe(0)
  })

  it('một phần tử trả chính nó ở mọi p', () => {
    expect(percentileSorted([42], 0)).toBe(42)
    expect(percentileSorted([42], 0.5)).toBe(42)
    expect(percentileSorted([42], 1)).toBe(42)
  })

  it('p=0 lấy phần tử đầu, p=1 lấy phần tử cuối', () => {
    expect(percentileSorted([1, 2, 3, 4], 0)).toBe(1)
    expect(percentileSorted([1, 2, 3, 4], 1)).toBe(4)
  })

  it('p=0.5 với n chẵn nội suy giữa hai giá trị giữa', () => {
    expect(percentileSorted([1, 2, 3, 4], 0.5)).toBe(2.5)
  })

  it('p=0.5 với n lẻ rơi đúng phần tử giữa', () => {
    expect(percentileSorted([1, 2, 3, 4, 5], 0.5)).toBe(3)
  })

  it('nội suy tuyến tính ở index phân số', () => {
    expect(percentileSorted([0, 10], 0.25)).toBe(2.5)
    expect(percentileSorted([0, 10, 20, 30], 0.25)).toBe(7.5)
  })

  it('p ngoài [0,1] trả undefined, p=NaN trả NaN (hợp đồng gọi đúng p)', () => {
    expect(percentileSorted([1, 2, 3], 1.5)).toBeUndefined()
    expect(percentileSorted([1, 2, 3], -0.5)).toBeUndefined()
    expect(percentileSorted([1, 2, 3], NaN)).toBeNaN()
  })
})
