import { describe, expect, it } from 'vitest'
import { MAX_PORTFOLIOS, PORTFOLIO_COLORS } from './PortfolioCard'

describe('PortfolioCard limits', () => {
  it('allows up to ten portfolios in the DCA tab', () => {
    expect(MAX_PORTFOLIOS).toBe(10)
  })

  it('has a unique color for every supported portfolio', () => {
    expect(PORTFOLIO_COLORS).toHaveLength(MAX_PORTFOLIOS)
    expect(new Set(PORTFOLIO_COLORS).size).toBe(MAX_PORTFOLIOS)
  })
})
