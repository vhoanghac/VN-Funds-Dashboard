import { describe, expect, it } from 'vitest'
import type { PriceSeriesPoint } from '../types'
import {
  createPriceSeries,
  isIsoDate,
  PriceSeriesValidationError,
  toPricePoints,
  toPriceSeriesPoints,
  validatePriceSeries,
} from './priceSeries'

const POINTS: PriceSeriesPoint[] = [
  { date: '2024-01-01', value: 100 },
  { date: '2024-01-02', value: 101 },
]

function input(overrides: Partial<Parameters<typeof createPriceSeries>[0]> = {}) {
  return {
    assetId: 'DCDS',
    currency: 'VND',
    points: POINTS,
    adjustments: [],
    source: 'static-csv:/data/DCDS.csv',
    ...overrides,
  }
}

describe('PriceSeries v1', () => {
  it('creates a versioned calculation-ready series and derives asOf from points', () => {
    expect(createPriceSeries(input())).toEqual({
      version: 1,
      assetId: 'DCDS',
      currency: 'VND',
      points: POINTS,
      adjustments: [],
      source: 'static-csv:/data/DCDS.csv',
      asOf: '2024-01-02',
    })
  })

  it('round-trips the internal PricePoint bridge without changing dates or values', () => {
    const prices = [
      { date: '2024-01-01', price: 100 },
      { date: '2024-01-02', price: 101.5 },
    ]

    expect(toPricePoints(toPriceSeriesPoints(prices))).toEqual(prices)
  })

  it('keeps raw points and dividend provenance when adjusted points differ', () => {
    const rawPoints: PriceSeriesPoint[] = [
      { date: '2024-01-01', value: 110 },
      { date: '2024-01-02', value: 101 },
    ]
    const series = createPriceSeries(input({
      points: POINTS,
      rawPoints,
      adjustments: [{
        kind: 'dividend',
        exDate: '2024-01-02',
        payDate: '2024-01-10',
        amountPerCert: 10,
        taxRate: 0.05,
      }],
    }))

    expect(series.rawPoints).toEqual(rawPoints)
    expect(series.adjustments).toHaveLength(1)
  })

  it('allows purchase points to have a different date set from valuation points', () => {
    const series = createPriceSeries(input({
      purchasePoints: [{ date: '2024-01-02', value: 102 }],
    }))

    expect(series.purchasePoints).toEqual([{ date: '2024-01-02', value: 102 }])
  })

  it('rejects duplicate or unsorted primary dates', () => {
    expect(() => createPriceSeries(input({
      points: [
        { date: '2024-01-02', value: 100 },
        { date: '2024-01-02', value: 101 },
      ],
    }))).toThrow(PriceSeriesValidationError)
  })

  it('rejects raw points with a different date axis from adjusted points', () => {
    expect(() => createPriceSeries(input({
      rawPoints: [{ date: '2024-01-01', value: 100 }],
      adjustments: [{
        kind: 'dividend',
        exDate: '2024-01-02',
        payDate: '2024-01-10',
        amountPerCert: 10,
        taxRate: 0,
      }],
    }))).toThrow('rawPoints must share the same date axis as points')
  })

  it('requires raw points and adjustments to be present together', () => {
    expect(() => createPriceSeries(input({
      rawPoints: POINTS,
    }))).toThrow('rawPoints requires at least one adjustment')
    expect(() => createPriceSeries(input({
      adjustments: [{
        kind: 'dividend',
        exDate: '2024-01-02',
        payDate: '2024-01-10',
        amountPerCert: 10,
        taxRate: 0,
      }],
    }))).toThrow('adjustments requires rawPoints')
  })

  it('rejects an unsupported runtime version and an asOf that does not match points', () => {
    const result = validatePriceSeries({
      ...createPriceSeries(input()),
      version: 2,
      asOf: '2024-01-01',
    })

    expect(result.series).toBeNull()
    expect(result.issues).toEqual(expect.arrayContaining([
      { path: 'version', message: 'must equal 1' },
      { path: 'asOf', message: 'must equal the final points date' },
    ]))
  })

  it('validates real calendar dates rather than only the YYYY-MM-DD shape', () => {
    expect(isIsoDate('2024-02-29')).toBe(true)
    expect(isIsoDate('2023-02-29')).toBe(false)
    expect(isIsoDate('2024-02-30')).toBe(false)
  })
})
