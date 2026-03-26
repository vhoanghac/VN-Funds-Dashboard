import Select from 'react-select'
import type { FundMeta } from '../types'
import { FUND_COLORS, MAX_COMPARE_FUNDS } from '../constants'

interface Props {
  allFunds: FundMeta[]
  selectedFunds: string[]
  onChangeFunds: (funds: string[]) => void
  startDate?: string
  endDate?: string
}

interface FundOption {
  value: string
  label: string
}

export function FundSelector({
  allFunds,
  selectedFunds,
  onChangeFunds,
  startDate,
  endDate,
}: Props) {
  const options: FundOption[] = allFunds.map(f => ({
    value: f.id,
    label: f.name_vi,
  }))

  function changeFund(index: number, newId: string) {
    const next = [...selectedFunds]
    next[index] = newId
    onChangeFunds(next)
  }

  function removeFund(index: number) {
    if (selectedFunds.length <= 1) return
    onChangeFunds(selectedFunds.filter((_, i) => i !== index))
  }

  function addFund() {
    if (selectedFunds.length >= MAX_COMPARE_FUNDS) return
    const used = new Set(selectedFunds)
    const available = allFunds.find(f => !used.has(f.id))
    if (available) {
      onChangeFunds([...selectedFunds, available.id])
    }
  }

  return (
    <div className="fund-selector">
      <div className="fund-selector-list">
        {selectedFunds.map((fundId, i) => (
          <div key={i} className="fund-selector-item">
            <span
              className="fund-color-dot"
              style={{ background: FUND_COLORS[i % FUND_COLORS.length] }}
            />
            <Select<FundOption>
              className="fund-search-select"
              classNamePrefix="fund-search"
              options={options}
              value={options.find(o => o.value === fundId) || null}
              onChange={opt => opt && changeFund(i, opt.value)}
              placeholder="Tìm quỹ..."
              noOptionsMessage={() => 'Không tìm thấy'}
              isSearchable
              styles={selectStyles}
            />
            <button
              className="fund-remove-btn"
              onClick={() => removeFund(i)}
              disabled={selectedFunds.length <= 1}
              title="Xoá quỹ"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button
        className="fund-add-btn"
        onClick={addFund}
        disabled={selectedFunds.length >= MAX_COMPARE_FUNDS}
      >
        + Thêm quỹ so sánh
      </button>

      {startDate && endDate && (
        <div className="comparison-period">
          So sánh từ {formatDate(startDate)} đến {formatDate(endDate)}
        </div>
      )}
    </div>
  )
}

const selectStyles = {
  control: (base: Record<string, unknown>) => ({
    ...base,
    minHeight: 38,
    borderColor: '#e5e7eb',
    boxShadow: 'none',
    '&:hover': { borderColor: '#2563EB' },
    fontSize: '0.95rem',
  }),
  menu: (base: Record<string, unknown>) => ({
    ...base,
    zIndex: 20,
  }),
  option: (base: Record<string, unknown>, state: { isFocused: boolean; isSelected: boolean }) => ({
    ...base,
    fontSize: '0.9rem',
    backgroundColor: state.isSelected ? '#2563EB' : state.isFocused ? '#eff6ff' : undefined,
    color: state.isSelected ? 'white' : '#1a1a1a',
  }),
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}
