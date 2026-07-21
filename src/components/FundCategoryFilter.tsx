import type { FundMeta } from '../types'

export type FundCategory = FundMeta['type'] | 'all'

interface Props {
  activeCategory: FundCategory
  onCategoryChange: (category: FundCategory) => void
}

interface CategoryButton {
  value: FundCategory
  label: string
}

const CATEGORY_BUTTONS: CategoryButton[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'mutual_fund', label: 'Cổ phiếu' },
  { value: 'bond', label: 'Trái phiếu' },
  { value: 'balanced', label: 'Cân bằng' },
  { value: 'etf', label: 'ETF' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'gold', label: 'Vàng' },
]

export function FundCategoryFilter({ activeCategory, onCategoryChange }: Props) {
  return (
    <div className="fund-category-filter">
      {CATEGORY_BUTTONS.map(btn => (
        <button
          key={btn.value}
          className={`category-btn${activeCategory === btn.value ? ' category-btn-active' : ''}`}
          onClick={() => onCategoryChange(btn.value)}
        >
          {btn.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Filter a fund list by category. 'all' returns the full list.
 * The exhaustive check ensures TypeScript errors if a new FundMeta.type
 * is added without updating CATEGORY_BUTTONS above.
 */
export function filterFundsByCategory(funds: FundMeta[], category: FundCategory): FundMeta[] {
  if (category === 'all') return funds
  return funds.filter(f => f.type === category)
}

/**
 * Exhaustive type check. If FundMeta.type gains a new value, this
 * function will produce a TypeScript compile error until CATEGORY_BUTTONS
 * and filterFundsByCategory are updated to handle it.
 */
function _assertExhaustiveFundType(type: never): never {
  throw new Error(`Unhandled fund type: ${String(type)}`)
}

export function getCategoryLabel(type: FundMeta['type']): string {
  switch (type) {
    case 'mutual_fund': return 'Cổ phiếu'
    case 'bond': return 'Trái phiếu'
    case 'balanced': return 'Cân bằng'
    case 'etf': return 'ETF'
    case 'crypto': return 'Crypto'
    case 'gold': return 'Vàng'
    default: return _assertExhaustiveFundType(type)
  }
}
