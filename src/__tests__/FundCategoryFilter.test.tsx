import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FundCategoryFilter, filterFundsByCategory, getCategoryLabel } from '../components/FundCategoryFilter'
import type { FundMeta } from '../types'

const SAMPLE_FUNDS: FundMeta[] = [
  { id: 'DCDS', name_vi: 'DCDS - Dragon Capital', type: 'mutual_fund', start_date: '2004-05-20', csv_file: 'DCDS.csv' },
  { id: 'TCBF', name_vi: 'TCBF - Techcom Capital', type: 'bond', start_date: '2019-01-15', csv_file: 'TCBF.csv' },
  { id: 'BVBF', name_vi: 'BVBF - BaoViet Balanced', type: 'balanced', start_date: '2020-03-01', csv_file: 'BVBF.csv' },
  { id: 'E1VFVN30', name_vi: 'E1VFVN30 - ETF VN30', type: 'etf', start_date: '2014-10-07', csv_file: 'E1VFVN30.csv' },
  { id: 'DCDE', name_vi: 'DCDE - Dragon Capital', type: 'mutual_fund', start_date: '2014-01-01', csv_file: 'DCDE.csv' },
]

// ─── Render tests ────────────────────────────────────────

describe('FundCategoryFilter', () => {
  it('renders all 5 category buttons', () => {
    render(<FundCategoryFilter activeCategory="all" onCategoryChange={() => {}} />)
    expect(screen.getByText('Tất cả')).toBeInTheDocument()
    expect(screen.getByText('Cổ phiếu')).toBeInTheDocument()
    expect(screen.getByText('Trái phiếu')).toBeInTheDocument()
    expect(screen.getByText('Cân bằng')).toBeInTheDocument()
    expect(screen.getByText('ETF')).toBeInTheDocument()
  })

  it('highlights the active category button', () => {
    render(<FundCategoryFilter activeCategory="bond" onCategoryChange={() => {}} />)
    expect(screen.getByText('Trái phiếu')).toHaveClass('category-btn-active')
    expect(screen.getByText('Tất cả')).not.toHaveClass('category-btn-active')
  })

  it('highlights Tất cả when activeCategory is all', () => {
    render(<FundCategoryFilter activeCategory="all" onCategoryChange={() => {}} />)
    expect(screen.getByText('Tất cả')).toHaveClass('category-btn-active')
  })

  it('calls onCategoryChange with correct value when button is clicked', async () => {
    const onChange = vi.fn()
    render(<FundCategoryFilter activeCategory="all" onCategoryChange={onChange} />)
    await userEvent.click(screen.getByText('Trái phiếu'))
    expect(onChange).toHaveBeenCalledWith('bond')
  })

  it('calls onCategoryChange when clicking the already-active button', async () => {
    const onChange = vi.fn()
    render(<FundCategoryFilter activeCategory="bond" onCategoryChange={onChange} />)
    await userEvent.click(screen.getByText('Trái phiếu'))
    expect(onChange).toHaveBeenCalledWith('bond')
  })
})

// ─── filterFundsByCategory tests ────────────────────────

describe('filterFundsByCategory', () => {
  it('returns all funds when category is all', () => {
    expect(filterFundsByCategory(SAMPLE_FUNDS, 'all')).toHaveLength(5)
  })

  it('returns only bond funds when category is bond', () => {
    const result = filterFundsByCategory(SAMPLE_FUNDS, 'bond')
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('TCBF')
  })

  it('returns only mutual_fund when category is mutual_fund', () => {
    const result = filterFundsByCategory(SAMPLE_FUNDS, 'mutual_fund')
    expect(result.every(f => f.type === 'mutual_fund')).toBe(true)
    expect(result).toHaveLength(2)
  })
})

// ─── getCategoryLabel tests ──────────────────────────────

describe('getCategoryLabel', () => {
  it('returns correct Vietnamese labels for all types', () => {
    expect(getCategoryLabel('mutual_fund')).toBe('Cổ phiếu')
    expect(getCategoryLabel('bond')).toBe('Trái phiếu')
    expect(getCategoryLabel('balanced')).toBe('Cân bằng')
    expect(getCategoryLabel('etf')).toBe('ETF')
  })
})
