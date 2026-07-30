import { memo, useMemo } from 'react'
import type { PortfolioStats } from './PerformanceTable'
import { formatVND, vndComparison, signedVND } from '../utils/vndFormat'

interface Props {
  investAmount: number
  stats: PortfolioStats[]        // stats[0] = 100% fund (no BTC), stats[1..] = portfolios with BTC
  fundId: string
  startDate?: string
  endDate?: string
}

/**
 * Hero block: "nếu bạn đầu tư 100 triệu vào E1VFVN30 từ 2020..., hôm nay có bao nhiêu"
 * So sánh portfolio không có BTC vs các portfolio có BTC bằng tiền VND thật.
 * Mục tiêu: làm cho retail investor VN cảm được tác động của Bitcoin bằng
 * đơn vị quen thuộc (xe máy, ô tô, nghỉ hưu) thay vì % trừu tượng.
 */
function MoneyMachineBlockImpl({ investAmount, stats, fundId, startDate, endDate }: Props) {
  const cards = useMemo(() => {
    if (stats.length < 2) return null
    const base = stats[0]!
    const baseFinal = investAmount * (1 + base.cumReturn)

    return stats.slice(1).map(s => {
      const finalVal = investAmount * (1 + s.cumReturn)
      const delta = finalVal - baseFinal
      return {
        name: s.name,
        color: s.color,
        finalVal,
        delta,
        cumReturn: s.cumReturn,
      }
    })
  }, [stats, investAmount])

  if (!cards || stats.length < 2) return null

  const base = stats[0]!
  const baseFinal = investAmount * (1 + base.cumReturn)

  // Pick the most attractive card for the headline takeaway.
  // Chọn card có delta dương lớn nhất để kể câu chuyện.
  const bestCard = cards.reduce((best, c) => (c.delta > best.delta ? c : best), cards[0]!)
  const bestPct = bestCard.name.match(/([\d.]+)% Bitcoin/)?.[1] ?? ''
  const comparison = vndComparison(bestCard.delta)
  const periodStr = startDate && endDate ? `từ ${formatPeriod(startDate)} đến ${formatPeriod(endDate)}` : ''
  const yearsStr = startDate && endDate ? yearsBetween(startDate, endDate) : ''

  return (
    <div className="money-machine-block">
      <div className="money-machine-header">
        <h3>Nếu bạn đầu tư <span className="money-amount-highlight">{formatVND(investAmount)}</span> vào {fundId} {periodStr}...</h3>
      </div>

      <div className="money-machine-cards">
        {/* Baseline card */}
        <div className="mm-card mm-card--base" style={{ borderTopColor: base.color }}>
          <div className="mm-card-label">Không có Bitcoin</div>
          <div className="mm-card-amount-row">
            <span className="mm-card-start">{formatVND(investAmount)}</span>
            <span className="mm-card-arrow">→</span>
            <span className="mm-card-final">{formatVND(baseFinal)}</span>
          </div>
          <div className="mm-card-return" style={{ color: base.color }}>
            {formatPct(base.cumReturn)}
          </div>
        </div>

        {/* BTC cards */}
        {cards.map(c => (
          <div key={c.name} className="mm-card mm-card--btc" style={{ borderTopColor: c.color }}>
            <div className="mm-card-label">{c.name}</div>
            <div className="mm-card-amount-row">
              <span className="mm-card-start">{formatVND(investAmount)}</span>
              <span className="mm-card-arrow">→</span>
              <span className="mm-card-final">{formatVND(c.finalVal)}</span>
            </div>
            <div className="mm-card-return" style={{ color: c.color }}>
              {formatPct(c.cumReturn)}
            </div>
            {c.delta !== 0 && (
              <div className={`mm-card-delta ${c.delta > 0 ? 'mm-card-delta--pos' : 'mm-card-delta--neg'}`}>
                {signedVND(c.delta)} so với không có BTC
              </div>
            )}
          </div>
        ))}
      </div>

      {bestCard.delta > 0 && comparison && (
        <div className="money-machine-takeaway">
          <span className="mm-takeaway-emoji">💡</span>
          <span>
            Nếu bạn thêm <strong>{bestPct}% Bitcoin</strong>
            {yearsStr ? ` ${yearsStr} trước` : ''}, hôm nay bạn có thêm{' '}
            <strong>{formatVND(bestCard.delta)}</strong>. Đó gần bằng <strong>{comparison}</strong>.
          </span>
        </div>
      )}
    </div>
  )
}

export const MoneyMachineBlock = memo(MoneyMachineBlockImpl)

function formatPct(v: number): string {
  const pct = v * 100
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
}

function formatPeriod(dateStr: string): string {
  const [y, m] = dateStr.split('-')
  return `${m}/${y}`
}

function yearsBetween(from: string, to: string): string {
  const f = new Date(from).getTime()
  const t = new Date(to).getTime()
  const years = (t - f) / (1000 * 60 * 60 * 24 * 365.25)
  if (years < 1) return ''
  if (years < 1.5) return '1 năm'
  return `${years.toFixed(0)} năm`
}
