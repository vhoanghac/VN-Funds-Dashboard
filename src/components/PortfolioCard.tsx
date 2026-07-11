import Select from 'react-select'
import type { FundMeta, RebalanceFrequency } from '../types'
import type { DCASlot } from '../utils/dca'

export const PORTFOLIO_COLORS = ['#059669', '#2563EB', '#DC2626', '#F59E0B', '#8B5CF6']
export const MAX_PORTFOLIOS = 5
export const MAX_FUNDS_PER_PORTFOLIO = 10

export const REBAL_OPTIONS: { value: RebalanceFrequency; label: string }[] = [
  { value: 'monthly', label: 'Hàng tháng' },
  { value: 'quarterly', label: 'Hàng quý' },
  { value: 'yearly', label: 'Hàng năm' },
]

export interface PortfolioCardState {
  id: string
  /** Số cố định gắn với danh mục lúc tạo — dùng làm fallback tên "Portfolio {num}" */
  num: number
  name: string
  /** true nếu người dùng đã tự gõ tên — khi đó không tự động đổi tên theo quỹ nữa */
  isNameCustom: boolean
  slots: DCASlot[]
  rebalFreq: RebalanceFrequency
}

interface Props {
  portfolio: PortfolioCardState
  pIdx: number
  funds: FundMeta[]
  fundOptions: { value: string; label: string }[]
  onUpdate: (update: Partial<PortfolioCardState>) => void
  onRemove: () => void
  onAddSlot: () => void
  onRemoveSlot: (idx: number) => void
  onUpdateSlot: (idx: number, update: Partial<DCASlot>) => void
  onSetEqualWeights: () => void
  showRebal?: boolean
}

export function PortfolioCard({
  portfolio,
  pIdx,
  fundOptions,
  onUpdate,
  onRemove,
  onAddSlot,
  onRemoveSlot,
  onUpdateSlot,
  onSetEqualWeights,
  showRebal = true,
}: Props) {
  const totalWeight = portfolio.slots.reduce((s, f) => s + f.weight, 0)
  const isOverUnder = Math.abs(totalWeight - 100) > 0.01
  const color = PORTFOLIO_COLORS[pIdx % PORTFOLIO_COLORS.length]!

  return (
    <div className="portfolio-card">
      <div className="portfolio-icon-row">
        <button
          className="portfolio-delete-btn-corner"
          onClick={onRemove}
          title="Xoá danh mục"
        >
          ✕
        </button>
      </div>

      <div className="portfolio-card-header">
        <span className="portfolio-color-dot" style={{ background: color }} />
        <input
          className="portfolio-name-input"
          value={portfolio.name}
          onChange={e => onUpdate({ name: e.target.value, isNameCustom: true })}
        />
        {showRebal && (
          <div className="portfolio-rebal">
            <label>Rebalance</label>
            <select
              value={portfolio.rebalFreq}
              onChange={e => onUpdate({ rebalFreq: e.target.value as RebalanceFrequency })}
            >
              {REBAL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="portfolio-actions">
        <button
          className="portfolio-add-btn"
          onClick={onAddSlot}
          disabled={portfolio.slots.length >= MAX_FUNDS_PER_PORTFOLIO}
          title="Thêm quỹ"
        >
          +
        </button>
        <button
          className="portfolio-set-btn"
          onClick={onSetEqualWeights}
          title="Chia đều tỷ trọng"
        >
          SET
        </button>
      </div>

      <div className="portfolio-slots">
        {portfolio.slots.map((slot, idx) => (
          <div key={idx} className="portfolio-slot-row">
            <Select
              className="portfolio-fund-select"
              classNamePrefix="fund-search"
              options={fundOptions}
              value={fundOptions.find(o => o.value === slot.fundId) || null}
              onChange={opt => onUpdateSlot(idx, { fundId: opt?.value || '' })}
              placeholder="Tìm quỹ..."
              noOptionsMessage={() => 'Không tìm thấy'}
              isSearchable
              styles={portfolioSelectStyles}
            />
            <div className="portfolio-weight-input">
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={slot.weight}
                onChange={e => onUpdateSlot(idx, {
                  weight: Math.max(0, Math.min(100, Number(e.target.value))),
                })}
              />
              <span>%</span>
            </div>
            <button
              className="portfolio-remove-slot-btn"
              onClick={() => onRemoveSlot(idx)}
              disabled={portfolio.slots.length <= 1}
              title="Xoá"
            >
              −
            </button>
          </div>
        ))}
      </div>

      <div className={`portfolio-total ${isOverUnder ? 'portfolio-total-warn' : ''}`}>
        <span>Total</span>
        <span className="portfolio-total-value">{totalWeight}</span>
        <span>%</span>
      </div>
    </div>
  )
}

export const portfolioSelectStyles = {
  control: (base: Record<string, unknown>) => ({
    ...base,
    minHeight: 36,
    borderColor: '#e5e7eb',
    boxShadow: 'none',
    '&:hover': { borderColor: '#2563EB' },
    fontSize: '0.9rem',
  }),
  menu: (base: Record<string, unknown>) => ({
    ...base,
    zIndex: 20,
  }),
  option: (base: Record<string, unknown>, state: { isFocused: boolean; isSelected: boolean }) => ({
    ...base,
    fontSize: '0.85rem',
    backgroundColor: state.isSelected ? '#059669' : state.isFocused ? '#ecfdf5' : undefined,
    color: state.isSelected ? 'white' : '#1a1a1a',
  }),
}
