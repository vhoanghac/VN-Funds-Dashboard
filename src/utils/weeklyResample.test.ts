import { describe, it, expect } from 'vitest'
import { alignFundsToCommonGrid, alignFundsToCommonGridDaily, getISOWeekKey } from './weeklyResample'

describe('getISOWeekKey', () => {
  it('places Monday-Sunday in the same ISO week, with the boundary on Monday', () => {
    // Tuần ISO 2024-W01: Thứ Hai 01/01 -> Chủ nhật 07/01. Thứ Hai 08/01 sang tuần mới.
    expect(getISOWeekKey('2024-01-04')).toBe('2024-W01') // Thứ Năm
    expect(getISOWeekKey('2024-01-05')).toBe('2024-W01') // Thứ Sáu
    expect(getISOWeekKey('2024-01-07')).toBe('2024-W01') // Chủ nhật
    expect(getISOWeekKey('2024-01-08')).toBe('2024-W02') // Thứ Hai kế tiếp
  })

  it('assigns the ISO year of the Thursday when a week straddles new year', () => {
    // 30-31/12/2024 là Thứ Hai/Ba nhưng thuộc tuần 1 của 2025 (Thứ Năm 02/01/2025).
    expect(getISOWeekKey('2024-12-30')).toBe('2025-W01')
    expect(getISOWeekKey('2024-12-31')).toBe('2025-W01')
    // 01/01/2023 là Chủ nhật, thuộc tuần cuối của 2022 (Thứ Năm 29/12/2022).
    expect(getISOWeekKey('2023-01-01')).toBe('2022-W52')
    expect(getISOWeekKey('2023-01-02')).toBe('2023-W01')
  })
})

describe('alignFundsToCommonGrid', () => {
  it('returns input unchanged when 1 or fewer funds', () => {
    const prices = new Map([['A', [{ date: '2024-01-05', price: 100 }]]])
    expect(alignFundsToCommonGrid(prices)).toBe(prices)
  })

  it('aligns funds that both have data every week (no gaps)', () => {
    const a = [
      { date: '2024-01-05', price: 100 },
      { date: '2024-01-12', price: 110 },
      { date: '2024-01-19', price: 120 },
    ]
    const b = [
      { date: '2024-01-05', price: 10 },
      { date: '2024-01-12', price: 11 },
      { date: '2024-01-19', price: 12 },
    ]
    const result = alignFundsToCommonGrid(new Map([['A', a], ['B', b]]))
    expect(result.get('A')).toEqual(a)
    expect(result.get('B')).toEqual(b)
  })

  it('forward-fills a fund missing a week once it has already started', () => {
    const a = [
      { date: '2024-01-05', price: 100 },
      { date: '2024-01-12', price: 110 },
      { date: '2024-01-19', price: 120 },
    ]
    // B thiếu giá tuần 01-12 (khoảng trống dữ liệu, vd quỹ trái phiếu)
    const b = [
      { date: '2024-01-05', price: 10 },
      { date: '2024-01-19', price: 12 },
    ]
    const result = alignFundsToCommonGrid(new Map([['A', a], ['B', b]]))
    expect(result.get('B')).toEqual([
      { date: '2024-01-05', price: 10 },
      { date: '2024-01-12', price: 10 }, // forward-filled từ tuần trước
      { date: '2024-01-19', price: 12 },
    ])
    // Fund A không bị ảnh hưởng
    expect(result.get('A')).toEqual(a)
  })

  it('does not fabricate a price before a fund actually starts', () => {
    const a = [
      { date: '2024-01-05', price: 100 },
      { date: '2024-01-12', price: 110 },
      { date: '2024-01-19', price: 120 },
    ]
    // B chỉ mới ra đời từ tuần 01-12
    const b = [
      { date: '2024-01-12', price: 11 },
      { date: '2024-01-19', price: 12 },
    ]
    const result = alignFundsToCommonGrid(new Map([['A', a], ['B', b]]))
    expect(result.get('B')).toEqual([
      { date: '2024-01-12', price: 11 },
      { date: '2024-01-19', price: 12 },
    ])
  })

  it('forward-fills across multiple consecutive missing weeks', () => {
    const a = [
      { date: '2024-01-05', price: 100 },
      { date: '2024-01-12', price: 110 },
      { date: '2024-01-19', price: 120 },
      { date: '2024-01-26', price: 130 },
    ]
    // B thiếu 2 tuần liên tiếp
    const b = [
      { date: '2024-01-05', price: 10 },
      { date: '2024-01-26', price: 13 },
    ]
    const result = alignFundsToCommonGrid(new Map([['A', a], ['B', b]]))
    expect(result.get('B')).toEqual([
      { date: '2024-01-05', price: 10 },
      { date: '2024-01-12', price: 10 },
      { date: '2024-01-19', price: 10 },
      { date: '2024-01-26', price: 13 },
    ])
  })
})

describe('alignFundsToCommonGridDaily', () => {
  it('returns input unchanged when 1 or fewer funds', () => {
    const prices = new Map([['A', [{ date: '2024-01-05', price: 100 }]]])
    expect(alignFundsToCommonGridDaily(prices)).toBe(prices)
  })

  it('aligns funds trading on the same days (no gaps)', () => {
    const a = [
      { date: '2024-01-02', price: 100 },
      { date: '2024-01-03', price: 101 },
      { date: '2024-01-04', price: 102 },
    ]
    const b = [
      { date: '2024-01-02', price: 10 },
      { date: '2024-01-03', price: 10.1 },
      { date: '2024-01-04', price: 10.2 },
    ]
    const result = alignFundsToCommonGridDaily(new Map([['A', a], ['B', b]]))
    expect(result.get('A')).toEqual(a)
    expect(result.get('B')).toEqual(b)
  })

  it('forward-fills a fund missing a specific day once it has started', () => {
    const a = [
      { date: '2024-01-02', price: 100 },
      { date: '2024-01-03', price: 101 },
      { date: '2024-01-04', price: 102 },
    ]
    // B (quỹ trái phiếu) không có giá ngày 01-03
    const b = [
      { date: '2024-01-02', price: 10 },
      { date: '2024-01-04', price: 10.2 },
    ]
    const result = alignFundsToCommonGridDaily(new Map([['A', a], ['B', b]]))
    expect(result.get('B')).toEqual([
      { date: '2024-01-02', price: 10 },
      { date: '2024-01-03', price: 10 }, // forward-filled từ ngày trước
      { date: '2024-01-04', price: 10.2 },
    ])
  })

  it('does not fabricate a price before a fund actually starts', () => {
    const a = [
      { date: '2024-01-02', price: 100 },
      { date: '2024-01-03', price: 101 },
      { date: '2024-01-04', price: 102 },
    ]
    // B chỉ mới ra đời từ ngày 01-03
    const b = [
      { date: '2024-01-03', price: 10.1 },
      { date: '2024-01-04', price: 10.2 },
    ]
    const result = alignFundsToCommonGridDaily(new Map([['A', a], ['B', b]]))
    expect(result.get('B')).toEqual([
      { date: '2024-01-03', price: 10.1 },
      { date: '2024-01-04', price: 10.2 },
    ])
  })

  it('produces the exact same aligned date grid for a single-fund vs multi-fund portfolio', () => {
    // Mô phỏng đúng bug đã tìm ra: 2 danh mục (1 quỹ vs nhiều quỹ) phải đầu
    // tư trên CÙNG một lưới ngày sau khi align, dù 1 quỹ (DCBF) thiếu giá
    // một vài ngày mà quỹ kia (DCDS) vẫn có.
    const dcds = [
      { date: '2024-01-02', price: 100 },
      { date: '2024-01-03', price: 101 },
      { date: '2024-01-04', price: 102 },
      { date: '2024-01-05', price: 103 },
    ]
    const dcbf = [
      { date: '2024-01-02', price: 10 },
      // thiếu 01-03 và 01-04
      { date: '2024-01-05', price: 10.3 },
    ]
    const result = alignFundsToCommonGridDaily(new Map([['DCDS', dcds], ['DCBF', dcbf]]))
    const dcdsDates = result.get('DCDS')!.map(p => p.date)
    const dcbfDates = result.get('DCBF')!.map(p => p.date)
    expect(dcdsDates).toEqual(dcbfDates)
    expect(dcdsDates).toEqual(['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'])
  })
})
