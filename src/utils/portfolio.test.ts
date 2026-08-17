import { describe, expect, it } from 'vitest'
import { isRebalanceFrequency, parsePortfolio, parsePortfolios } from './portfolio'

describe('portfolio parsing', () => {
  it('parses a valid stored portfolio and preserves its name', () => {
    expect(parsePortfolio({
      slots: [{ fundId: 'DCDS', weight: 60 }, { fundId: 'VESAF', weight: 40 }],
      rebalFreq: 'yearly',
      name: 'Danh mục dài hạn',
    })).toEqual({
      slots: [{ fundId: 'DCDS', weight: 60 }, { fundId: 'VESAF', weight: 40 }],
      rebalFreq: 'yearly',
      name: 'Danh mục dài hạn',
    })
  })

  it('falls back to quarterly for an unknown frequency', () => {
    expect(parsePortfolio({ slots: [], rebalFreq: 'never' })?.rebalFreq).toBe('quarterly')
    expect(parsePortfolio({ slots: [], rebalFreq: 3 })?.rebalFreq).toBe('quarterly')
    expect(parsePortfolio({ slots: [], rebalFreq: {} })?.rebalFreq).toBe('quarterly')
    expect(parsePortfolio({ slots: [], rebalFreq: null })?.rebalFreq).toBe('quarterly')
  })

  it('rejects a portfolio whose slots field is not an array', () => {
    expect(parsePortfolio({ slots: null, rebalFreq: 'monthly' })).toBeNull()
    expect(parsePortfolio({ slots: 'DCDS:100', rebalFreq: 'monthly' })).toBeNull()
  })

  it('drops malformed slots but keeps valid empty and zero-weight slots', () => {
    expect(parsePortfolio({
      slots: [
        { fundId: '', weight: 0 },
        { fundId: 'DCDS', weight: 100 },
        null,
        { fundId: 'BROKEN', weight: '100' },
      ],
      rebalFreq: 'monthly',
    })?.slots).toEqual([
      { fundId: '', weight: 0 },
      { fundId: 'DCDS', weight: 100 },
    ])
  })

  it('drops negative weights at the storage boundary', () => {
    expect(parsePortfolio({
      slots: [{ fundId: 'DCDS', weight: 120 }, { fundId: 'VESAF', weight: -20 }],
      rebalFreq: 'monthly',
    })?.slots).toEqual([{ fundId: 'DCDS', weight: 120 }])
  })

  it('drops non-string names without affecting the portfolio', () => {
    expect(parsePortfolio({ slots: [], rebalFreq: 'monthly', name: 42 })?.name).toBeUndefined()
    expect(parsePortfolio({ slots: [], rebalFreq: 'monthly', name: '' })?.name).toBeUndefined()
  })

  it('filters invalid entries from a stored portfolio list', () => {
    expect(parsePortfolios([
      { slots: [{ fundId: 'DCDS', weight: 100 }], rebalFreq: 'quarterly' },
      { slots: 'broken', rebalFreq: 'monthly' },
      null,
    ])).toEqual([
      { slots: [{ fundId: 'DCDS', weight: 100 }], rebalFreq: 'quarterly' },
    ])
    expect(parsePortfolios(null)).toEqual([])
  })

  it('accepts only the three supported rebalance frequencies', () => {
    expect(isRebalanceFrequency('monthly')).toBe(true)
    expect(isRebalanceFrequency('quarterly')).toBe(true)
    expect(isRebalanceFrequency('yearly')).toBe(true)
    expect(isRebalanceFrequency('never')).toBe(false)
  })
})
