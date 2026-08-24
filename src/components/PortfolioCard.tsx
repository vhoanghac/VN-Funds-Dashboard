import Select from 'react-select'
import type { FundMeta, PortfolioCardState, RebalanceFrequency } from '../types'
import type { DCASlot } from '../utils/dca'
import { isSavingsAssetId, savingsAssetId, SAVINGS_OPTION_LABEL } from '../utils/savingsAsset'
import { SavingsRateInput } from './SavingsRateInput'

export const PORTFOLIO_COLORS = [
  '#059669', // green
  '#2563EB', // blue
  '#DC2626', // red
  '#F59E0B', // amber
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#6366F1', // indigo
  '#84CC16', // lime
]
export const MAX_PORTFOLIOS = 10
export const MAX_FUNDS_PER_PORTFOLIO = 10

export const REBAL_OPTIONS: { value: RebalanceFrequency; label: string }[] = [
  { value: 'monthly', label: 'Hàng tháng' },
  { value: 'quarterly', label: 'Hàng quý' },
  { value: 'yearly', label: 'Hàng năm' },
]

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
  showRemove?: boolean
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
  showRemove = true,
}: Props) {
  const totalWeight = portfolio.slots.reduce((s, f) => s + f.weight, 0)
  const isOverUnder = Math.abs(totalWeight - 100) > 0.01
  const color = PORTFOLIO_COLORS[pIdx % PORTFOLIO_COLORS.length]!

  return (
    <div className="portfolio-card">
      {showRemove && (
        <div className="portfolio-icon-row">
          <button
            className="portfolio-delete-btn-corner"
            onClick={onRemove}
            title="Xoá danh mục"
          >
            ✕
          </button>
        </div>
      )}

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
        {portfolio.slots.map((slot, idx) => {
          const isSavings = isSavingsAssetId(slot.fundId)
          const selectedOption = isSavings
            ? { value: slot.fundId, label: SAVINGS_OPTION_LABEL }
            : fundOptions.find(o => o.value === slot.fundId) || null
          return (
          <div key={idx} className="portfolio-slot-row">
            <Select
              className="portfolio-fund-select"
              classNamePrefix="fund-search"
              options={fundOptions}
              value={selectedOption}
              onChange={opt => onUpdateSlot(idx, { fundId: opt?.value || '' })}
              placeholder="Tìm quỹ..."
              noOptionsMessage={() => 'Không tìm thấy'}
              isSearchable
              styles={portfolioSelectStyles}
            />
            {isSavings && (
              <SavingsRateInput
                fundId={slot.fundId}
                onCommit={rate => onUpdateSlot(idx, { fundId: savingsAssetId(rate) })}
              />
            )}
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
          )
        })}
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
