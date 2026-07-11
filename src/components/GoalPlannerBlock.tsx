/**
 * GoalPlannerBlock: "Để đến đích, bạn cần nạp bao nhiêu mỗi tháng?"
 *
 * Reverse compound calc: cho target FV + horizon, solve PMT (monthly contribution).
 * Dùng CAGR lịch sử làm base rate, +/- 3% cho 3 kịch bản.
 *
 * Retail VN cần công cụ này để biến mục tiêu trừu tượng ("1 tỷ", "5 tỷ", "tiền học con")
 * thành con số cụ thể mỗi tháng. Không phải cam kết, là phép tính cảm nhận khoảng cách.
 *
 * Math: FV = PV × (1 + r)^n + PMT × [((1 + r)^n − 1) / r]
 *       → PMT = (FV − PV × (1 + r)^n) / [((1 + r)^n − 1) / r]
 * với r = monthly rate, n = months, end-of-period contribution.
 */
import { useState, memo } from 'react'
import { formatVND } from '../utils/vndFormat'

export interface GoalPlannerPortfolio {
  id: string
  name: string
  color: string
  /** Giá trị danh mục hiện tại (PV cho phép tính) */
  finalValue: number
  /** CAGR đã quy năm từ backtest */
  cagr: number | null
  /** Số tiền nạp mỗi tháng ước lượng, dùng để so sánh mức hiện tại vs mức cần */
  monthlyContribution: number
}

interface Props {
  portfolios: GoalPlannerPortfolio[]
}

const PRESET_TARGETS = [
  { label: '1 tỷ', value: 1_000_000_000 },
  { label: '2 tỷ', value: 2_000_000_000 },
  { label: '3 tỷ', value: 3_000_000_000 },
]

const YEAR_OPTIONS = [5, 10, 15, 20, 25, 30]

function GoalPlannerBlockImpl({ portfolios }: Props) {
  const [target, setTarget] = useState<number>(1_000_000_000)
  const [years, setYears] = useState<number>(10)
  const [customInput, setCustomInput] = useState<string>('')
  const [customError, setCustomError] = useState<string | null>(null)

  if (portfolios.length === 0) return null
  const valid = portfolios.filter(p => p.cagr !== null && p.finalValue > 0)
  if (valid.length === 0) return null

  const applyCustom = () => {
    if (!customInput.trim()) {
      setCustomError(null)
      return
    }
    const n = parseCustomTarget(customInput)
    if (n === null) {
      setCustomError('Không đọc được số. Thử: 500tr, 1.5 tỷ, 2 tỉ, 1500000000')
      return
    }
    setTarget(n)
    setCustomError(null)
  }

  const activePreset = PRESET_TARGETS.find(p => p.value === target)

  return (
    <div className="dca-goal-block">
      <h3 className="dca-goal-title">Để đến đích, bạn cần nạp bao nhiêu mỗi tháng?</h3>
      <p className="dca-goal-sub">
        Giả sử CAGR tương lai loanh quanh mức lịch sử của quỹ, và bạn vẫn đều đặn nạp
        tiền mỗi tháng. Danh mục hiện tại của bạn cũng tiếp tục sinh lời theo CAGR này,
        cộng với tiền nạp mới mỗi tháng, cả hai cùng cộng dồn tới mục tiêu. Chọn mục
        tiêu tài sản và số năm, chúng ta sẽ tính ngược số tiền bạn cần nạp thêm. Đây
        không phải cam kết, chỉ là phép tính cho bạn cảm nhận khoảng cách giữa hiện tại
        và đích đến.
      </p>

      <div className="dca-goal-controls">
        <div className="dca-goal-control-row">
          <span className="dca-goal-control-label">Mục tiêu:</span>
          {PRESET_TARGETS.map(p => (
            <button
              key={p.value}
              className={`dca-goal-btn${target === p.value ? ' dca-goal-btn--active' : ''}`}
              onClick={() => { setTarget(p.value); setCustomInput(''); setCustomError(null) }}
            >
              {p.label}
            </button>
          ))}
          <div className="dca-goal-custom">
            <input
              type="text"
              className="dca-goal-custom-input"
              placeholder="hoặc nhập (vd: 500tr, 1.5 tỷ)"
              value={customInput}
              onChange={(e) => setCustomInput(formatCustomInput(e.target.value))}
              onBlur={applyCustom}
              onKeyDown={(e) => { if (e.key === 'Enter') applyCustom() }}
            />
          </div>
        </div>
        {customError && (
          <div className="dca-goal-custom-error">{customError}</div>
        )}

        <div className="dca-goal-control-row">
          <span className="dca-goal-control-label">Trong:</span>
          {YEAR_OPTIONS.map(y => (
            <button
              key={y}
              className={`dca-goal-btn${years === y ? ' dca-goal-btn--active' : ''}`}
              onClick={() => setYears(y)}
            >
              {y} năm
            </button>
          ))}
        </div>

        <div className="dca-goal-current">
          Mục tiêu đang chọn: <strong>{formatVND(target)}</strong>
          {activePreset ? '' : ' (tùy chọn)'} sau <strong>{years} năm</strong>
        </div>
      </div>

      {valid.map(p => (
        <GoalForPortfolio key={p.id} portfolio={p} target={target} years={years} />
      ))}
    </div>
  )
}

export const GoalPlannerBlock = memo(GoalPlannerBlockImpl)

function GoalForPortfolio({
  portfolio,
  target,
  years,
}: {
  portfolio: GoalPlannerPortfolio
  target: number
  years: number
}) {
  const cagr = portfolio.cagr ?? 0

  const basePmt = solveMonthlyContribution(target, portfolio.finalValue, cagr, years)
  const pessPmt = solveMonthlyContribution(target, portfolio.finalValue, cagr - 0.03, years)
  const optPmt = solveMonthlyContribution(target, portfolio.finalValue, cagr + 0.03, years)

  const currentMonthly = portfolio.monthlyContribution
  const ratio = currentMonthly > 0 && basePmt > 0 ? basePmt / currentMonthly : null

  return (
    <div className="dca-goal-card">
      <div className="dca-goal-card-header">
        <span style={{ color: portfolio.color, fontWeight: 700 }}>{portfolio.name}</span>
        <span className="dca-goal-card-cagr">
          CAGR lịch sử: {(cagr * 100).toFixed(1)}%/năm
        </span>
      </div>

      <div className="dca-goal-scenarios">
        <ScenarioRow
          label="Xấu"
          sub={`CAGR ${((cagr - 0.03) * 100).toFixed(1)}%/năm`}
          pmt={pessPmt}
          color="#ef4444"
        />
        <ScenarioRow
          label="Base"
          sub={`CAGR ${(cagr * 100).toFixed(1)}%/năm`}
          pmt={basePmt}
          color={portfolio.color}
          highlight
        />
        <ScenarioRow
          label="Tốt"
          sub={`CAGR ${((cagr + 0.03) * 100).toFixed(1)}%/năm`}
          pmt={optPmt}
          color="#10b981"
        />
      </div>

      <GoalTakeaway
        target={target}
        years={years}
        basePmt={basePmt}
        currentMonthly={currentMonthly}
        ratio={ratio}
        cagr={cagr}
        currentValue={portfolio.finalValue}
      />
    </div>
  )
}

function ScenarioRow({
  label, sub, pmt, color, highlight,
}: { label: string; sub: string; pmt: number; color: string; highlight?: boolean }) {
  return (
    <div className={`dca-goal-scenario${highlight ? ' dca-goal-scenario--highlight' : ''}`}>
      <div className="dca-goal-scenario-label">
        <span className="dca-goal-scenario-swatch" style={{ background: color }} />
        <span>{label}</span>
      </div>
      <div className="dca-goal-scenario-sub">{sub}</div>
      <div className="dca-goal-scenario-pmt">
        {pmt <= 0 ? 'Đã đủ, không cần nạp thêm' : `${formatVND(Math.round(pmt))}/tháng`}
      </div>
    </div>
  )
}

function GoalTakeaway({
  target, years, basePmt, currentMonthly, ratio, cagr, currentValue,
}: {
  target: number
  years: number
  basePmt: number
  currentMonthly: number
  ratio: number | null
  cagr: number
  currentValue: number
}) {
  if (basePmt <= 0) {
    return (
      <div className="dca-goal-takeaway">
        Với CAGR lịch sử <strong>{(cagr * 100).toFixed(1)}%/năm</strong>, bạn không
        cần nạp thêm đồng nào. Chỉ cần giữ nguyên danh mục hiện tại{' '}
        <strong>{formatVND(Math.round(currentValue))}</strong> qua{' '}
        <strong>{years} năm nữa</strong> là vượt qua mục tiêu{' '}
        <strong>{formatVND(target)}</strong>. Dĩ nhiên phép tính này giả định CAGR
        giữ được mức lịch sử, thị trường không bao giờ chắc chắn.
      </div>
    )
  }

  let ratioText: string
  if (ratio === null || currentMonthly <= 0) {
    ratioText = 'Đây là con số cần nạp đều đặn mỗi tháng trong suốt kỳ hạn trên.'
  } else if (ratio <= 1.2) {
    ratioText = `So với mức bạn đang nạp bây giờ (${formatVND(Math.round(currentMonthly))}/tháng), con số này gần tương đương. Bạn đang đi đúng hướng, chỉ cần giữ kỷ luật nạp đều đặn.`
  } else if (ratio <= 2) {
    ratioText = `So với mức bạn đang nạp bây giờ (${formatVND(Math.round(currentMonthly))}/tháng), gấp khoảng ${ratio.toFixed(1)} lần. Khoảng cách này có thể thu hẹp bằng cách kéo dài thời gian, hoặc tăng dần số tiền nạp mỗi khi lương tăng.`
  } else {
    ratioText = `So với mức bạn đang nạp bây giờ (${formatVND(Math.round(currentMonthly))}/tháng), gấp hơn ${ratio.toFixed(1)} lần. Mục tiêu này hơi xa. Có ba đòn bẩy: kéo dài thời gian, tăng thu nhập để nạp nhiều hơn, hoặc xem lại mục tiêu cho thực tế. Thời gian là đòn bẩy rẻ nhất.`
  }

  return (
    <div className="dca-goal-takeaway">
      Giả sử CAGR tương lai loanh quanh mức lịch sử{' '}
      <strong>{(cagr * 100).toFixed(1)}%/năm</strong>, để có{' '}
      <strong>{formatVND(target)}</strong> sau <strong>{years} năm</strong>, bạn cần
      nạp <strong>{formatVND(Math.round(basePmt))}/tháng</strong> đều đặn. {ratioText}
    </div>
  )
}

/**
 * Solve PMT given target FV, PV, annual rate, years. Monthly compounding,
 * end-of-period contribution.
 *
 * Returns 0 if current PV already compounds to >= target (no contribution needed).
 */
function solveMonthlyContribution(
  targetFV: number,
  currentPV: number,
  annualRate: number,
  years: number,
): number {
  const months = years * 12
  if (months <= 0) return 0

  // Rate gần 0: fallback linear
  if (Math.abs(annualRate) < 1e-6) {
    const pmt = (targetFV - currentPV) / months
    return Math.max(0, pmt)
  }

  const r = Math.pow(1 + annualRate, 1 / 12) - 1
  // r có thể âm (pess scenario với CAGR thấp). Nếu r <= -1 thì toàn bộ mất, PMT vô nghĩa.
  if (r <= -0.999) return Math.max(0, (targetFV - currentPV) / months)

  const growth = Math.pow(1 + r, months)
  const fvOfCurrent = currentPV * growth

  if (fvOfCurrent >= targetFV) return 0

  // annuity factor: ((1+r)^n − 1) / r. Với r âm nhẹ vẫn valid.
  const annuityFactor = (growth - 1) / r
  if (annuityFactor <= 0) {
    // r âm đủ mạnh để annuity factor âm, fallback linear
    return Math.max(0, (targetFV - currentPV) / months)
  }

  const pmt = (targetFV - fvOfCurrent) / annuityFactor
  return Math.max(0, pmt)
}

/**
 * Tự thêm dấu chấm phân cách hàng nghìn khi người dùng gõ số thuần (vd "5000000"
 * → "5.000.000"), giúp dễ đọc hơn. Nếu chuỗi có chữ (vd "500tr", "1.5 tỷ") thì giữ
 * nguyên — không format, để không phá cú pháp gõ tắt.
 */
function formatCustomInput(raw: string): string {
  const digitsOnly = raw.replace(/\./g, '')
  if (digitsOnly !== '' && /^\d+$/.test(digitsOnly)) {
    return Number(digitsOnly).toLocaleString('de-DE')
  }
  return raw
}

/**
 * Parse free-form input: "500tr", "1.5 tỷ", "2 tỉ", "2000000000", "1,5ty",
 * hoặc số thuần đã tự format dấu chấm hàng nghìn "5.000.000".
 */
function parseCustomTarget(input: string): number | null {
  if (!input) return null
  const s = input.trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '')
  const numMatch = s.match(/([\d.]+)/)
  if (!numMatch) return null
  const hasUnit = /(tỷ|ty|tỉ|ti|triệu|trieu|tr|nghìn|nghin|ngan|ngàn|k|m)/.test(s)
  // Không có đơn vị: dấu chấm là phân cách hàng nghìn (từ auto-format), bỏ hết.
  // Có đơn vị: dấu chấm duy nhất là thập phân (vd "1.5 tỷ"), giữ nguyên.
  const plain = hasUnit ? Number(numMatch[1]!) : Number(numMatch[1]!.replace(/\./g, ''))
  if (isNaN(plain) || plain <= 0) return null

  if (/(tỷ|ty|tỉ|ti)/.test(s)) return plain * 1_000_000_000
  if (/(triệu|trieu|tr|m)/.test(s)) return plain * 1_000_000
  if (/(nghìn|nghin|ngan|ngàn|k)/.test(s)) return plain * 1_000
  return plain
}
