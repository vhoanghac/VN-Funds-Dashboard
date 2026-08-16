import { describe, it, expect } from 'vitest'
import { detectGaps, buildFundQualityReport } from './dataQuality'
import type { PricePoint } from '../types'

function weekly(...dates: string[]): PricePoint[] {
  return dates.map((date, i) => ({ date, price: 100 + i }))
}

describe('detectGaps', () => {
  it('returns nothing for an empty or single-point series', () => {
    expect(detectGaps([])).toEqual([])
    expect(detectGaps(weekly('2024-01-05'))).toEqual([])
  })

  it('returns nothing when points are a normal week apart', () => {
    expect(detectGaps(weekly('2024-01-05', '2024-01-12', '2024-01-19'))).toEqual([])
  })

  it('treats exactly the threshold as still acceptable', () => {
    // 14 days apart, and the check is `> thresholdDays`. Two weeks of Tet
    // holiday should not be reported as a hole in the data.
    expect(detectGaps(weekly('2024-01-05', '2024-01-19'))).toEqual([])
  })

  it('reports a gap once the gap passes the threshold', () => {
    expect(detectGaps(weekly('2024-01-05', '2024-01-20'))).toEqual([
      { fromDate: '2024-01-05', toDate: '2024-01-20', weeksMissing: 1 },
    ])
  })

  it('counts the missing weeks between the two known points', () => {
    // Jan 5 -> Feb 4 is 30 days: round(30/7) = 4 steps, so 3 weeks absent.
    expect(detectGaps(weekly('2024-01-05', '2024-02-04'))[0]!.weeksMissing).toBe(3)
  })

  it('reports every gap in a series, not just the first', () => {
    const gaps = detectGaps(
      weekly('2024-01-05', '2024-02-04', '2024-02-11', '2024-04-01'),
    )
    expect(gaps.map((g) => g.fromDate)).toEqual(['2024-01-05', '2024-02-11'])
  })

  it('honours a custom threshold', () => {
    const series = weekly('2024-01-05', '2024-01-16')
    expect(detectGaps(series)).toEqual([])
    expect(detectGaps(series, 5)).toHaveLength(1)
  })
})

describe('buildFundQualityReport', () => {
  const series = weekly('2024-01-05', '2024-01-12', '2024-01-19')

  it('returns null when the fund has no prices at all', () => {
    expect(buildFundQualityReport('DCDS', [], null, null)).toBeNull()
  })

  it('reports the real span of the series', () => {
    const report = buildFundQualityReport('DCDS', series, null, null, new Date('2024-01-19'))!
    expect(report.id).toBe('DCDS')
    expect(report.startDate).toBe('2024-01-05')
    expect(report.endDate).toBe('2024-01-19')
    expect(report.gaps).toEqual([])
  })

  it('flags a fund that starts after the window the user asked for', () => {
    const report = buildFundQualityReport('DCDS', series, '2023-01-01', null)!
    expect(report.startsAfterRequested).toBe(true)
    expect(report.endsBeforeRequested).toBe(false)
  })

  it('flags a fund that stops before the window the user asked for', () => {
    const report = buildFundQualityReport('DCDS', series, null, '2024-06-01')!
    expect(report.endsBeforeRequested).toBe(true)
    expect(report.startsAfterRequested).toBe(false)
  })

  it('flags neither side when the fund covers the whole window', () => {
    const report = buildFundQualityReport('DCDS', series, '2024-01-05', '2024-01-19')!
    expect(report.startsAfterRequested).toBe(false)
    expect(report.endsBeforeRequested).toBe(false)
  })

  it('measures staleness against the injected today', () => {
    const report = buildFundQualityReport('DCDS', series, null, null, new Date('2024-02-01'))!
    expect(report.daysStale).toBe(13)
  })

  it('reports zero staleness when the last price is today', () => {
    const report = buildFundQualityReport('DCDS', series, null, null, new Date('2024-01-19'))!
    expect(report.daysStale).toBe(0)
  })

  it('carries gaps found inside the series into the report', () => {
    const gappy = weekly('2024-01-05', '2024-02-04', '2024-02-11')
    const report = buildFundQualityReport('DCDS', gappy, null, null, new Date('2024-02-11'))!
    expect(report.gaps).toHaveLength(1)
    expect(report.gaps[0]!.weeksMissing).toBe(3)
  })

  // Regression: ISSUE-003 — banner gắn "N ngày trước" của quỹ này vào "Cập nhật
  // tới" của quỹ kia. Mỗi quỹ phải tự mang con số daysStale của chính nó.
  // Found by /qa on 2026-08-14
  it('daysStale luôn tính từ endDate của chính quỹ đó', () => {
    const today = new Date('2024-02-05')
    // Quỹ A cập nhật hôm nay, quỹ B trễ 3 ngày.
    const a = buildFundQualityReport('A', weekly('2024-01-05', '2024-02-05'), null, null, today)!
    const b = buildFundQualityReport('B', weekly('2024-01-05', '2024-02-02'), null, null, today)!
    expect(a.endDate).toBe('2024-02-05')
    expect(a.daysStale).toBe(0)
    expect(b.endDate).toBe('2024-02-02')
    expect(b.daysStale).toBe(3)
  })
})
