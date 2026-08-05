import { MoneyInput } from '../MoneyInput'

/**
 * Mấy ô nhập dùng chung cho cả 3 máy tính.
 *
 * Đây chỉ là lớp vỏ quanh input, không đọc funds hay portfolio, nên vẫn giữ được
 * quy tắc self-contained của Calculator Suite. Dùng lại class `dca-param-row` và
 * `dca-label` để form máy tính trông giống hệt form tab DCA, kể cả trên mobile.
 */

interface MoneyFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  hint?: string
}

export function MoneyField({ label, value, onChange, hint }: MoneyFieldProps) {
  return (
    <div className="dca-param-row">
      <label className="dca-label">{label}</label>
      <div className="dca-amount-input">
        <MoneyInput value={value} onChange={onChange} min={0} />
        <span className="dca-currency">₫</span>
      </div>
      {hint && <span className="calc-field-hint">{hint}</span>}
    </div>
  )
}

interface PercentFieldProps {
  label: string
  /** Giá trị lưu dạng thập phân (0.08), ô nhập hiển thị dạng phần trăm (8) */
  value: number
  onChange: (value: number) => void
  step?: number
  max?: number
  hint?: string
}

export function PercentField({ label, value, onChange, step = 0.5, max = 100, hint }: PercentFieldProps) {
  return (
    <div className="dca-param-row">
      <label className="dca-label">{label}</label>
      <div className="calc-unit-input">
        <input
          type="number"
          className="calc-number-input"
          min={0}
          max={max}
          step={step}
          value={Number((value * 100).toFixed(4))}
          onChange={e => {
            const pct = Math.min(max, Math.max(0, parseFloat(e.target.value) || 0))
            onChange(pct / 100)
          }}
        />
        <span className="calc-unit">%/năm</span>
      </div>
      {hint && <span className="calc-field-hint">{hint}</span>}
    </div>
  )
}

interface YearsFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  max?: number
}

export function YearsField({ label, value, onChange, max = 60 }: YearsFieldProps) {
  return (
    <div className="dca-param-row">
      <label className="dca-label">{label}</label>
      <div className="calc-unit-input">
        <input
          type="number"
          className="calc-number-input"
          min={1}
          max={max}
          step={1}
          value={value}
          onChange={e => {
            const years = Math.min(max, Math.max(1, Math.round(parseFloat(e.target.value) || 1)))
            onChange(years)
          }}
        />
        <span className="calc-unit">năm</span>
      </div>
    </div>
  )
}

interface ResultRowProps {
  label: string
  value: string
  /** Dòng kết quả chính, in đậm và to hơn */
  primary?: boolean
  tone?: 'neutral' | 'good' | 'bad'
}

export function ResultRow({ label, value, primary, tone = 'neutral' }: ResultRowProps) {
  const cls = ['calc-result-row', primary ? 'calc-result-row--primary' : '', `calc-result-row--${tone}`]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls}>
      <span className="calc-result-label">{label}</span>
      <span className="calc-result-value">{value}</span>
    </div>
  )
}
