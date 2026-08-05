import type { CalculatorId } from '../../types'
import { CALCULATORS, findCalculator } from './CalculatorRegistry'

/**
 * Container cho tab "Máy tính".
 *
 * Nhiệm vụ duy nhất: hiện thanh điều hướng và render đúng máy tính đang chọn.
 * Mọi tính toán nằm trong từng component con, container không biết gì về nội dung
 * bên trong. Nhờ vậy khi tách route riêng thì bỏ hẳn container này đi cũng được.
 */
interface CalculatorTabProps {
  calcId?: CalculatorId
  onSelect: (id: CalculatorId) => void
}

export function CalculatorTab({ calcId, onSelect }: CalculatorTabProps) {
  const active = findCalculator(calcId)
  const ActiveCalculator = active.component

  return (
    <div className="calc-tab">
      <div className="calc-intro">
        <h2 className="calc-title">Máy tính nhanh</h2>
      </div>

      <nav className="calc-nav" aria-label="Chọn máy tính">
        {CALCULATORS.map(calc => (
          <button
            key={calc.id}
            type="button"
            className={`calc-nav-btn ${calc.id === active.id ? 'calc-nav-btn--active' : ''}`}
            aria-current={calc.id === active.id ? 'page' : undefined}
            onClick={() => onSelect(calc.id)}
          >
            <span className="calc-nav-label">{calc.label}</span>
            <span className="calc-nav-desc">{calc.description}</span>
          </button>
        ))}
      </nav>

      <ActiveCalculator />
    </div>
  )
}
