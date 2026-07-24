import { describe, it, expect } from 'vitest'
import {
  drawdownEpisodes,
  avgDrawdown,
  longestDrawdownDays,
  annualizedStdevFromCumulative,
} from './drawdownStats'
import type { ReturnPoint } from '../types'

function dd(points: [string, number][]): ReturnPoint[] {
  return points.map(([date, value]) => ({ date, value }))
}

describe('drawdownEpisodes', () => {
  it('returns empty for empty series', () => {
    expect(drawdownEpisodes([])).toEqual([])
  })

  it('returns empty when always at peak', () => {
    const series = dd([['2020-01-01', 0], ['2020-01-02', 0], ['2020-01-03', 0]])
    expect(drawdownEpisodes(series, 0)).toEqual([])
  })

  it('detects a single completed episode with correct peak/trough/recovery', () => {
    const series = dd([
      ['2020-01-01', 0],
      ['2020-01-10', 0],       // đỉnh cuối trước khi rơi
      ['2020-02-01', -0.10],
      ['2020-03-01', -0.30],   // đáy
      ['2020-04-01', -0.05],
      ['2020-05-01', 0],       // hồi phục
      ['2020-06-01', 0],
    ])
    const eps = drawdownEpisodes(series, 0)
    expect(eps).toHaveLength(1)
    expect(eps[0]).toMatchObject({
      peakDate: '2020-01-10',
      troughDate: '2020-03-01',
      recoveryDate: '2020-05-01',
      depth: -0.30,
    })
    // 10/01 → 01/05 = 112 ngày
    expect(eps[0]!.totalDays).toBe(112)
  })

  it('marks ongoing episode with recoveryDate null and length to series end', () => {
    const series = dd([
      ['2020-01-01', 0],
      ['2020-02-01', -0.20],
      ['2020-03-01', -0.15],
    ])
    const eps = drawdownEpisodes(series, 0)
    expect(eps).toHaveLength(1)
    expect(eps[0]!.recoveryDate).toBeNull()
    expect(eps[0]!.troughDate).toBe('2020-02-01')
    expect(eps[0]!.totalDays).toBe(60) // 01/01 → 01/03
  })

  it('separates multiple episodes and sorts deepest first', () => {
    const series = dd([
      ['2020-01-01', 0],
      ['2020-02-01', -0.10],
      ['2020-03-01', 0],
      ['2020-04-01', 0],
      ['2020-05-01', -0.40],
      ['2020-06-01', 0],
      ['2020-07-01', -0.25],
      ['2020-08-01', 0],
    ])
    const eps = drawdownEpisodes(series, 0)
    expect(eps.map(e => e.depth)).toEqual([-0.40, -0.25, -0.10])
    expect(eps[0]!.peakDate).toBe('2020-04-01')
  })

  it('filters out episodes shallower than minDepth', () => {
    const series = dd([
      ['2020-01-01', 0],
      ['2020-02-01', -0.02],  // rung lắc nhỏ
      ['2020-03-01', 0],
      ['2020-04-01', -0.30],
      ['2020-05-01', 0],
    ])
    const eps = drawdownEpisodes(series) // mặc định -5%
    expect(eps).toHaveLength(1)
    expect(eps[0]!.depth).toBe(-0.30)
  })
})

describe('avgDrawdown', () => {
  it('returns null for empty series', () => {
    expect(avgDrawdown([])).toBeNull()
  })

  it('averages over ALL observations, peak days count as 0', () => {
    const series = dd([
      ['2020-01-01', 0],
      ['2020-01-02', -0.10],
      ['2020-01-03', -0.30],
      ['2020-01-04', 0],
    ])
    expect(avgDrawdown(series)).toBeCloseTo(-0.10, 10)
  })
})

describe('longestDrawdownDays', () => {
  it('returns null when never underwater', () => {
    expect(longestDrawdownDays(dd([['2020-01-01', 0], ['2020-01-02', 0]]))).toBeNull()
  })

  it('picks the LONGEST episode even if it is not the deepest', () => {
    const series = dd([
      ['2020-01-01', 0],
      ['2020-01-15', -0.50],   // sâu nhưng ngắn (14 ngày rồi hồi)
      ['2020-01-31', 0],
      ['2020-02-01', 0],
      ['2020-03-01', -0.08],   // nông nhưng kéo dài
      ['2020-12-01', -0.03],
      ['2021-02-01', 0],
    ])
    // Đợt 2: 01/02/2020 → 01/02/2021 = 366 ngày (2020 nhuận)
    expect(longestDrawdownDays(series)).toBe(366)
  })

  it('counts ongoing episode to end of series', () => {
    const series = dd([
      ['2020-01-01', 0],
      ['2020-06-01', -0.10],
      ['2021-01-01', -0.05],
    ])
    expect(longestDrawdownDays(series)).toBe(366)
  })
})

describe('annualizedStdevFromCumulative', () => {
  function cumulativeFromReturns(startDate: string, dailyReturns: number[]): ReturnPoint[] {
    const points: ReturnPoint[] = [{ date: startDate, value: 0 }]
    let growth = 1
    const d = new Date(startDate)
    for (const r of dailyReturns) {
      growth *= 1 + r
      d.setDate(d.getDate() + 1)
      points.push({ date: d.toISOString().slice(0, 10), value: growth - 1 })
    }
    return points
  }

  it('returns null for short series', () => {
    expect(annualizedStdevFromCumulative(cumulativeFromReturns('2020-01-01', Array(10).fill(0.01)))).toBeNull()
  })

  it('returns ~0 for perfectly constant returns', () => {
    const series = cumulativeFromReturns('2020-01-01', Array(100).fill(0.001))
    expect(annualizedStdevFromCumulative(series)!).toBeCloseTo(0, 6)
  })

  it('annualizes using observed density: alternating ±1% daily', () => {
    const returns = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01))
    const series = cumulativeFromReturns('2020-01-01', returns)
    const result = annualizedStdevFromCumulative(series)!
    // stdev kỳ ≈ 1%, mật độ ≈ 365 điểm/năm (chuỗi liền ngày) → ~0.01 × √365 ≈ 0.191
    expect(result).toBeGreaterThan(0.15)
    expect(result).toBeLessThan(0.25)
  })
})
