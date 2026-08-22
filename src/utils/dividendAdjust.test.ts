/**
 * Tests for applyDividendAdjustment — Yahoo-style tax-adjusted factor.
 */
import { describe, it, expect } from 'vitest'
import {
  applyDividendAdjustment,
  applyDividendAdjustments,
  type DividendEvent,
} from './dividendAdjust'
import type { PricePoint } from '../types'

function mkPrices(pairs: Array<[string, number]>): PricePoint[] {
  return pairs.map(([date, price]) => ({ date, price }))
}

describe('applyDividendAdjustment', () => {
  it('returns input unchanged when no events', () => {
    const prices = mkPrices([
      ['2024-01-05', 29000],
      ['2024-01-12', 29100],
    ])
    const out = applyDividendAdjustment(prices, [])
    expect(out).toEqual(prices)
  })

  it('returns input unchanged when empty prices', () => {
    expect(applyDividendAdjustment([], [{ exDate: '2024-06-10', payDate: '2024-06-26', amountPerCert: 1300, taxRate: 0.05 }])).toEqual([])
  })

  it('scales prices BEFORE ex-date by tax-adjusted factor', () => {
    // closePreEx = 29000, div = 1300, tax 5% → netDiv = 1235
    // factor = (29000 − 1235) / 29000 = 27765/29000 ≈ 0.957414
    const prices = mkPrices([
      ['2024-06-03', 28800],  // before ex
      ['2024-06-10', 29000],  // this is the last date BEFORE ex-date 2024-06-10?
      // Note: "< exDate" excludes exDate itself, so '2024-06-10' price is NOT pre-ex if exDate='2024-06-10'
    ])
    // Use exDate strictly after the last pre-ex price
    const prices2 = mkPrices([
      ['2024-06-03', 28800],
      ['2024-06-09', 29000],  // closePreEx
      ['2024-06-10', 27700],  // ex-date (post-drop, not adjusted)
      ['2024-06-17', 27800],
    ])
    const events: DividendEvent[] = [
      { exDate: '2024-06-10', payDate: '2024-06-26', amountPerCert: 1300, taxRate: 0.05 },
    ]
    const out = applyDividendAdjustment(prices2, events)
    const factor = (29000 - 1300 * 0.95) / 29000
    expect(out[0]!.price).toBeCloseTo(28800 * factor, 4)
    expect(out[1]!.price).toBeCloseTo(29000 * factor, 4)
    // Prices on/after ex-date unchanged
    expect(out[2]!.price).toBe(27700)
    expect(out[3]!.price).toBe(27800)
    // Prevent regression: verify length unchanged
    expect(out.length).toBe(prices2.length)

    // First arg unused in asserts but keep to document intent
    void prices
  })

  it('applies multiple events cumulatively', () => {
    // Two events. Prices BEFORE second ex-date already have factor1 applied,
    // so factor2 is computed against the ALREADY-scaled closePreEx. Result:
    // oldest price gets multiplied by factor1 × factor2.
    const prices = mkPrices([
      ['2024-01-01', 30000],
      ['2024-06-09', 29000],  // closePreEx for event 1
      ['2024-06-10', 27700],
      ['2025-05-19', 31000],  // closePreEx for event 2
      ['2025-05-20', 29600],
    ])
    const events: DividendEvent[] = [
      { exDate: '2024-06-10', payDate: '2024-06-26', amountPerCert: 1300, taxRate: 0.05 },
      { exDate: '2025-05-20', payDate: '2025-06-06', amountPerCert: 1400, taxRate: 0.05 },
    ]
    const out = applyDividendAdjustment(prices, events)
    // After event 1: prices [0..2] scaled by f1 = (29000 - 1235)/29000
    // Then event 2: closePreEx = 31000 (unchanged since it's AFTER event 1 ex-date? No —
    // event 1's loop iterates idx 0..1 (prices < '2024-06-10'), so prices[3]=2025-05-19 is
    // NOT scaled by event 1. closePreEx for event 2 = 31000.
    // f2 = (31000 - 1330)/31000
    // prices[0..3] scaled by f2 (all < '2025-05-20')
    // Net: prices[0..1] scaled by f1 * f2, prices[2..3] scaled by f2 only
    const f1 = (29000 - 1300 * 0.95) / 29000
    const f2 = (31000 - 1400 * 0.95) / 31000
    expect(out[0]!.price).toBeCloseTo(30000 * f1 * f2, 4)
    expect(out[1]!.price).toBeCloseTo(29000 * f1 * f2, 4)
    expect(out[2]!.price).toBeCloseTo(27700 * f2, 4)
    expect(out[3]!.price).toBeCloseTo(31000 * f2, 4)
    expect(out[4]!.price).toBe(29600)
  })

  it('skips events before series starts', () => {
    const prices = mkPrices([
      ['2024-07-01', 28000],
      ['2024-07-08', 28100],
    ])
    const events: DividendEvent[] = [
      { exDate: '2024-06-10', payDate: '2024-06-26', amountPerCert: 1300, taxRate: 0.05 },
    ]
    const out = applyDividendAdjustment(prices, events)
    // No price is BEFORE exDate, nothing to scale
    expect(out[0]!.price).toBe(28000)
    expect(out[1]!.price).toBe(28100)
  })

  it('does not mutate input array', () => {
    const prices = mkPrices([
      ['2024-06-09', 29000],
      ['2024-06-10', 27700],
    ])
    const snapshot = JSON.parse(JSON.stringify(prices))
    applyDividendAdjustment(prices, [
      { exDate: '2024-06-10', payDate: '2024-06-26', amountPerCert: 1300, taxRate: 0.05 },
    ])
    expect(prices).toEqual(snapshot)
  })

  it('reports only dividend events that actually changed the series', () => {
    const prices = mkPrices([
      ['2024-06-09', 29000],
      ['2024-06-10', 27700],
    ])
    const beforeSeries: DividendEvent = {
      exDate: '2024-06-10',
      payDate: '2024-06-26',
      amountPerCert: 1300,
      taxRate: 0.05,
    }
    const beforeHistory: DividendEvent = {
      exDate: '2020-01-01',
      payDate: '2020-01-10',
      amountPerCert: 100,
      taxRate: 0,
    }

    const result = applyDividendAdjustments(prices, [beforeHistory, beforeSeries])

    expect(result.appliedEvents).toEqual([beforeSeries])
    expect(result.points[0]!.price).toBeLessThan(prices[0]!.price)
  })

  it('does not record an event when adjustment leaves prices unchanged', () => {
    const prices = mkPrices([
      ['2024-06-09', 100],
      ['2024-06-10', 90],
    ])

    const result = applyDividendAdjustments(prices, [{
      exDate: '2024-06-10',
      payDate: '2024-06-26',
      amountPerCert: 100,
      taxRate: 0,
    }])

    expect(result.points).toEqual(prices)
    expect(result.appliedEvents).toEqual([])
  })
})
