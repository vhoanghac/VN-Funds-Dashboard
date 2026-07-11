/**
 * BankComparisonBlock: so sánh DCA với gửi tiết kiệm ngân hàng.
 *
 * Retail VN luôn so với tiết kiệm. Dashboard này trả lời thẳng:
 * "Cùng số tiền đó, gửi ngân hàng thì có bao nhiêu?"
 *
 * Cách tính: lấy từng khoản nạp thực tế (từ investedSeries delta), compound
 * mỗi khoản tại lãi suất ngân hàng từ ngày nạp đến ngày kết thúc. Chính xác
 * hơn FV annuity formula (vốn giả định dòng tiền đều).
 *
 * Lãi suất mặc định 6.5%/năm, gần trung bình tiết kiệm kỳ hạn 12 tháng
 * nhóm ngân hàng lớn VN 2024–2026. Có thể user chỉnh trong tương lai.
 */
import { useState, memo } from 'react'
import { formatVND } from '../utils/vndFormat'

const DEFAULT_BANK_RATE = 0.065  // 6.5%/năm

const RATE_OPTIONS = [
  { label: '5%', value: 0.05 },
  { label: '6.5%', value: 0.065 },
  { label: '8%', value: 0.08 },
]

export interface BankCompareResult {
  id: string
  name: string
  color: string
  finalValue: number
  investedSeries: { date: string; value: number }[]
}

interface Props {
  results: BankCompareResult[]
  endDate: string  // YYYY-MM-DD
}

function BankComparisonBlockImpl({ results, endDate }: Props) {
  const [bankRate, setBankRate] = useState<number>(DEFAULT_BANK_RATE)

  if (results.length === 0) return null

  const end = new Date(endDate).getTime()
  const msPerYear = 365.25 * 24 * 3600 * 1000

  const comparisons = results.map(r => {
    // Derive deltas from cumulative investedSeries
    let prevCum = 0
    let bankFV = 0
    for (const p of r.investedSeries) {
      const delta = p.value - prevCum
      prevCum = p.value
      if (delta <= 0) continue
      const yearsHeld = (end - new Date(p.date).getTime()) / msPerYear
      if (yearsHeld < 0) continue
      bankFV += delta * Math.pow(1 + bankRate, yearsHeld)
    }
    const diff = r.finalValue - bankFV
    return {
      ...r,
      bankFV,
      diff,
      diffPct: bankFV > 0 ? (diff / bankFV) * 100 : 0,
    }
  })

  return (
    <div className="dca-bank-compare-block">
      <div className="dca-bank-compare-head">
        <h3 className="dca-bank-compare-title">So với gửi tiết kiệm ngân hàng thì sao?</h3>
        <div className="dca-bank-compare-rate">
          <span>Lãi suất giả định:</span>
          <div className="dca-bank-compare-rate-btns">
            {RATE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`dca-bank-rate-btn${Math.abs(opt.value - bankRate) < 1e-6 ? ' dca-bank-rate-btn--active' : ''}`}
                onClick={() => setBankRate(opt.value)}
                title="Lãi suất tiết kiệm có kỳ hạn giả định, compound hàng năm"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="dca-bank-compare-sub">
        Giả sử cùng lịch nạp tiền đó, nhưng thay vì mua quỹ, bạn đem gửi tiết kiệm
        ngân hàng với lãi suất <strong>{(bankRate * 100).toFixed(1)}%/năm</strong>
        {' '}ghép lãi hàng năm. Kết quả sẽ như thế nào?
      </p>

      <div className="dca-bank-compare-grid">
        {comparisons.map(c => (
          <div key={c.id} className="dca-bank-compare-row">
            <div className="dca-bank-compare-portfolio" style={{ borderLeftColor: c.color }}>
              <span className="dca-bank-compare-name" style={{ color: c.color }}>{c.name}</span>
              <span className="dca-bank-compare-val">{formatVND(c.finalValue)}</span>
            </div>
            <div className="dca-bank-compare-vs">vs</div>
            <div className="dca-bank-compare-bank">
              <span className="dca-bank-compare-name">🏦 Gửi ngân hàng</span>
              <span className="dca-bank-compare-val">{formatVND(c.bankFV)}</span>
            </div>
            <div className={`dca-bank-compare-delta dca-bank-compare-delta--${c.diff >= 0 ? 'pos' : 'neg'}`}>
              <span className="dca-bank-compare-delta-label">
                {c.diff >= 0 ? 'DCA hơn' : 'Ngân hàng hơn'}
              </span>
              <span className="dca-bank-compare-delta-val">
                {c.diff >= 0 ? '+' : ''}{formatVND(c.diff)}
              </span>
              <span className="dca-bank-compare-delta-pct">
                ({c.diff >= 0 ? '+' : ''}{c.diffPct.toFixed(1)}%)
              </span>
            </div>
          </div>
        ))}
      </div>

      {comparisons.length > 0 && (
        <BankTakeaway comparisons={comparisons} />
      )}
    </div>
  )
}

interface TakeawayProps {
  comparisons: Array<{
    name: string
    diff: number
    diffPct: number
  }>
}

function BankTakeaway({ comparisons }: TakeawayProps) {
  const winners = comparisons.filter(c => c.diff > 0)
  const losers  = comparisons.filter(c => c.diff <= 0)
  const best = [...comparisons].sort((a, b) => b.diff - a.diff)[0]!

  if (winners.length === comparisons.length) {
    // All beat bank
    return (
      <div className="chart-takeaway chart-takeaway--green">
        <span className="chart-takeaway-icon">🎯</span>
        <div className="chart-takeaway-body">
          Tất cả <strong>{comparisons.length}</strong> danh mục đều cho kết quả tốt
          hơn gửi tiết kiệm. Dẫn đầu là <strong>{best.name}</strong>, hơn ngân hàng
          {' '}<strong>+{formatVND(best.diff)}</strong> ({best.diffPct >= 0 ? '+' : ''}{best.diffPct.toFixed(1)}%).
          {' '}Trong giai đoạn này, việc chấp nhận rủi ro của quỹ đã được đền đáp xứng đáng.
        </div>
      </div>
    )
  }

  if (losers.length === comparisons.length) {
    // All lost to bank
    return (
      <div className="chart-takeaway chart-takeaway--red">
        <span className="chart-takeaway-icon">⚠️</span>
        <div className="chart-takeaway-body">
          Tất cả <strong>{comparisons.length}</strong> danh mục đều thua gửi tiết
          kiệm trong giai đoạn này. Thị trường Việt Nam là thị trường cận biên, từ
          bull sang bear diễn ra chóng vánh, rất dễ rơi vào giai đoạn không thuận
          lợi như 2018-2019 hoặc sau COVID 3/2020. Gửi tiết kiệm đảm bảo lợi nhuận
          như mong đợi, còn quỹ thì không. Thử chọn khoảng thời gian dài hơn để
          xem bức tranh đầy đủ hơn.
        </div>
      </div>
    )
  }

  // Mixed
  return (
    <div className="chart-takeaway chart-takeaway--orange">
      <span className="chart-takeaway-icon">⚖️</span>
      <div className="chart-takeaway-body">
        <strong>{winners.length}/{comparisons.length}</strong> danh mục có kết quả
        tốt hơn gửi tiết kiệm. <strong>{best.name}</strong> dẫn đầu với
        {' '}<strong>+{formatVND(best.diff)}</strong>. Những danh mục còn lại chưa
        đủ bù đắp rủi ro mà bạn đã chấp nhận. Không phải quỹ nào cũng phù hợp,
        đó là lý do vì sao phải chọn kỹ.
      </div>
    </div>
  )
}

export const BankComparisonBlock = memo(BankComparisonBlockImpl)
