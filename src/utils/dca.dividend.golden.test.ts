import { describe, expect, it } from 'vitest'
import type { PricePoint } from '../types'
import { applyDividendAdjustment, type DividendEvent } from './dividendAdjust'
import {
  dcaMaxDrawdown,
  dcaMWRR,
  simulateDCA,
  trackDividendNarrative,
} from './dca'

// Selected rows copied from public/data/DCDE.csv. Keep this fixture small and stable.
const DCDE_RAW: PricePoint[] = [
  { date: '2014-01-01', price: 8457 },
  { date: '2024-06-07', price: 29391.49 },
  { date: '2024-06-10', price: 28241.85 },
  { date: '2024-06-26', price: 27975.01 },
  { date: '2025-05-19', price: 27713.43 },
  { date: '2025-05-20', price: 26167.74 },
  { date: '2025-06-06', price: 27302.55 },
  { date: '2026-07-13', price: 27887.74 },
  { date: '2026-07-14', price: 25622.54 },
  { date: '2026-07-31', price: 24704.44 },
  { date: '2026-08-17', price: 24797.12 },
]

const DCDE_DIVIDENDS: DividendEvent[] = [
  { exDate: '2024-06-10', payDate: '2024-06-26', amountPerCert: 1300, taxRate: 0.05 },
  { exDate: '2025-05-20', payDate: '2025-06-06', amountPerCert: 1400, taxRate: 0.05 },
  { exDate: '2026-07-14', payDate: '2026-07-31', amountPerCert: 1900, taxRate: 0.025 },
]

const DCDE_ADJUSTED_EXPECTED = [
  7200.497136078633,
  25024.63516259711,
  25100.5005441656,
  24863.3412374911,
  24630.856859437157,
  24429.49450753629,
  25488.92243910765,
  26035.24,
  25622.54,
  24704.44,
  24797.12,
]

// Selected rows copied from public/data/TCBF.csv.
const TCBF_RAW: PricePoint[] = [
  { date: '2015-09-09', price: 10000 },
  { date: '2025-07-28', price: 20756 },
  { date: '2025-07-29', price: 19776 },
  { date: '2025-08-20', price: 19842 },
  { date: '2025-08-29', price: 19881 },
]

const TCBF_DIVIDENDS: DividendEvent[] = [
  { exDate: '2025-07-29', payDate: '2025-08-20', amountPerCert: 1000, taxRate: 0.05 },
]

const TCBF_ADJUSTED_EXPECTED = [
  9542.301021391406,
  19806,
  19776,
  19842,
  19881,
]

describe('Dividend fund DCA golden paths', () => {
  it('keeps the adjusted NAV for all three real dividend events', () => {
    const adjusted = applyDividendAdjustment(DCDE_RAW, DCDE_DIVIDENDS)

    expect(adjusted.map(point => point.date)).toEqual(DCDE_RAW.map(point => point.date))
    for (const [index, point] of adjusted.entries()) {
      expect(point.price).toBeCloseTo(DCDE_ADJUSTED_EXPECTED[index]!, 8)
    }
  })

  it('keeps DCA performance on adjusted NAV, not raw NAV', () => {
    const adjusted = applyDividendAdjustment(DCDE_RAW, DCDE_DIVIDENDS)
    const result = simulateDCA(
      new Map([['DCDE', adjusted]]),
      [{ fundId: 'DCDE', weight: 100 }],
      { initialAmount: 1_000_000, cashflowAmount: 0, cashflowFreq: 'monthly' },
      'quarterly',
    )

    expect(result.totalInvested).toBe(1_000_000)
    expect(result.finalValue).toBeCloseTo(3_443_806.661036245, 6)
    expect(result.cumulative[result.cumulative.length - 1]!.value).toBeCloseTo(2.4438066610362448, 10)
    expect(dcaMWRR(result.cashflows)).toBeCloseTo(0.102910619275149, 10)
    expect(dcaMaxDrawdown(result.cumulative)).toBeCloseTo(-0.05111533444669614, 10)
  })

  it('keeps raw NAV and per-event tax for the dividend narrative', () => {
    const narrative = trackDividendNarrative(
      new Map([['DCDE', DCDE_RAW]]),
      [{ fundId: 'DCDE', weight: 100 }],
      { initialAmount: 1_000_000, cashflowAmount: 0, cashflowFreq: 'monthly' },
      'quarterly',
      new Map([['DCDE', DCDE_DIVIDENDS]]),
    )

    expect(narrative).toHaveLength(1)
    const stats = narrative[0]!
    expect(stats.eventCount).toBe(3)
    expect(stats.totalGross).toBeCloseTo(572_581.8913142651, 8)
    expect(stats.totalTax).toBeCloseTo(22_478.805178996772, 8)
    expect(stats.totalNet).toBeCloseTo(550_103.0861352682, 8)
    expect(stats.totalSharesAdded).toBeCloseTo(20.94377387126203, 8)

    expect(stats.events).toHaveLength(3)
    expect(stats.events[0]).toMatchObject({ exDate: '2024-06-10', payDate: '2024-06-26' })
    expect(stats.events[1]).toMatchObject({ exDate: '2025-05-20', payDate: '2025-06-06' })
    expect(stats.events[2]).toMatchObject({ exDate: '2026-07-14', payDate: '2026-07-31' })
    expect(stats.events[0]!.gross).toBeCloseTo(153_718.81281778408, 8)
    expect(stats.events[1]!.gross).toBeCloseTo(172_851.50302782163, 8)
    expect(stats.events[2]!.tax).toBeCloseTo(6_150.289386716484, 8)
  })

  it('keeps TCBF distribution separate from market movement', () => {
    const adjusted = applyDividendAdjustment(TCBF_RAW, TCBF_DIVIDENDS)

    expect(adjusted.map(point => point.price)).toEqual(TCBF_ADJUSTED_EXPECTED)

    // Raw NAV drops 980. The after-tax cash distribution is 950.
    // The remaining 30 is market movement, not a dividend adjustment.
    const rawPreEx = TCBF_RAW[1]!.price
    const rawEx = TCBF_RAW[2]!.price
    const netDividend = 1000 * (1 - 0.05)
    expect(rawPreEx - rawEx - netDividend).toBe(30)
    expect(adjusted[1]!.price - adjusted[2]!.price).toBe(30)
  })

  it('uses adjusted TCBF NAV for performance and raw NAV for cash distribution', () => {
    const adjusted = applyDividendAdjustment(TCBF_RAW, TCBF_DIVIDENDS)
    const dca = simulateDCA(
      new Map([['TCBF', adjusted]]),
      [{ fundId: 'TCBF', weight: 100 }],
      { initialAmount: 1_000_000, cashflowAmount: 0, cashflowFreq: 'monthly' },
      'quarterly',
    )
    const narrative = trackDividendNarrative(
      new Map([['TCBF', TCBF_RAW]]),
      [{ fundId: 'TCBF', weight: 100 }],
      { initialAmount: 1_000_000, cashflowAmount: 0, cashflowFreq: 'monthly' },
      'quarterly',
      new Map([['TCBF', TCBF_DIVIDENDS]]),
    )

    expect(dca.finalValue).toBeCloseTo(2_083_459.7394728868, 8)
    expect(dca.cumulative[dca.cumulative.length - 1]!.value).toBeCloseTo(1.0834597394728869, 10)

    expect(narrative).toHaveLength(1)
    expect(narrative[0]!.eventCount).toBe(1)
    expect(narrative[0]!.events[0]!.unitsAtEx).toBe(100)
    expect(narrative[0]!.events[0]!.gross).toBe(100_000)
    expect(narrative[0]!.events[0]!.tax).toBe(5_000)
    expect(narrative[0]!.events[0]!.net).toBe(95_000)
    expect(narrative[0]!.events[0]!.sharesAdded).toBeCloseTo(4.787823808083862, 10)
  })
})
