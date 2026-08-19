import { describe, expect, it } from 'vitest'
import { MAX_PORTFOLIOS } from './PortfolioCard'

describe('PortfolioCard limits', () => {
  it('allows up to ten portfolios in the DCA tab', () => {
    expect(MAX_PORTFOLIOS).toBe(10)
  })
})
