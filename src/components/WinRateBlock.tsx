import { memo, useMemo } from 'react'
import type { ReturnPoint } from '../types'
import { rollingCumulativeReturnsMap, winRateAgainstRolledB } from '../utils/calculations'

interface Props {
  portfolioReturns: ReturnPoint[][]    // [baseline, btc1, btc2, btc3]
  btcPercents: [number, number, number]
  stats: { name: string; color: string }[]    // portfolioStats cho color mapping
}

const HORIZONS = [
  { months: 12, label: '1 năm' },
  { months: 24, label: '2 năm' },
  { months: 36, label: '3 năm' },
  { months: 60, label: '5 năm' },
]

/**
 * Probability framing: trong tất cả khoảng rolling N năm, danh mục BTC
 * thắng baseline bao nhiêu lần? Giúp trả lời câu hỏi retail hay lo:
 * "BTC có vẻ hên xui, biết đâu tôi mua xong nó rớt thì sao?"
 *
 * Mỗi ô là một cặp (horizon, btc_weight). Ví dụ: ở ô "3% BTC × 3 năm",
 * hiển thị "87/100 lần thắng" = trong 100 khoảng 3-năm liên tiếp có
 * trong dữ liệu lịch sử, danh mục có 3% BTC thắng danh mục không BTC
 * 87 khoảng.
 */
function WinRateBlockImpl({ portfolioReturns, btcPercents, stats }: Props) {
  const baseReturns = portfolioReturns[0]
  if (!baseReturns) return null

  // Compute all (horizon × btc%) cells. baseReturns is shared across all 3
  // weight scenarios, nên chỉ tính rolling map của nó 1 lần/kỳ hạn (4 lần),
  // thay vì tính lại mỗi lần lặp qua btcPercents (12 lần) — cùng 1 dữ liệu,
  // cùng 1 kỳ hạn thì kết quả rolling y hệt nhau.
  const grid = useMemo(() => {
    if (!baseReturns) return []
    const baseRolledByHorizon = new Map(
      HORIZONS.map(h => [h.months, rollingCumulativeReturnsMap(baseReturns, h.months)]),
    )
    return btcPercents.map((_, i) => {
      const btcReturns = portfolioReturns[i + 1]
      if (!btcReturns) return null
      return HORIZONS.map(h => {
        const rolledBMap = baseRolledByHorizon.get(h.months)!
        const { wins, total } = winRateAgainstRolledB(btcReturns, h.months, rolledBMap)
        return { months: h.months, label: h.label, wins, total }
      })
    })
  }, [portfolioReturns, btcPercents, baseReturns])

  if (grid.length === 0 || !grid.some(row => row && row.some(c => c.total > 0))) return null

  // Best cell để làm takeaway: cao nhất win rate tuyệt đối
  let best: { btcPct: number; label: string; wins: number; total: number; rate: number } | null = null
  grid.forEach((row, i) => {
    if (!row) return
    row.forEach(c => {
      if (c.total === 0) return
      const rate = c.wins / c.total
      if (!best || rate > best.rate) {
        best = { btcPct: btcPercents[i]!, label: c.label, wins: c.wins, total: c.total, rate }
      }
    })
  })

  return (
    <div className="winrate-container">
      <div className="chart-header">
        <h3>Xác suất thắng: bao nhiêu lần Bitcoin kéo danh mục vượt trội?</h3>
        <span
          className="chart-tooltip-icon"
          title="Với mỗi khoảng rolling N năm liên tiếp trong dữ liệu lịch sử, so sánh danh mục có BTC với danh mục không BTC. Ô hiển thị số lần danh mục có BTC thắng / tổng số khoảng. Ví dụ 87/100 nghĩa là trong 100 khoảng 3-năm, danh mục BTC thắng 87 khoảng."
        >?</span>
      </div>
      <div className="winrate-intro">
        Với mỗi tỷ trọng Bitcoin, so sánh danh mục có BTC với danh mục không BTC trên tất cả khoảng thời gian N năm liên tiếp có trong dữ liệu lịch sử.
      </div>

      <div className="winrate-table-wrap">
        <table className="winrate-table">
          <thead>
            <tr>
              <th className="winrate-th-name">Tỷ trọng BTC</th>
              {HORIZONS.map(h => (
                <th key={h.months}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, i) => {
              if (!row) return null
              const stat = stats[i + 1]
              return (
                <tr key={i}>
                  <td className="winrate-td-name">
                    {stat && <span className="perf-dot" style={{ background: stat.color }} />}
                    {btcPercents[i]}% Bitcoin
                  </td>
                  {row.map(c => {
                    if (c.total === 0) {
                      return <td key={c.months} className="winrate-cell winrate-cell--na">—</td>
                    }
                    const rate = c.wins / c.total
                    const pctStr = (rate * 100).toFixed(0) + '%'
                    const cls = rate >= 0.7 ? 'winrate-cell--strong'
                              : rate >= 0.5 ? 'winrate-cell--medium'
                              : 'winrate-cell--weak'
                    return (
                      <td key={c.months} className={`winrate-cell ${cls}`}>
                        <div className="winrate-fraction">{c.wins}<span className="winrate-slash">/</span>{c.total}</div>
                        <div className="winrate-bar-wrap">
                          <div className="winrate-bar" style={{ width: `${rate * 100}%` }} />
                        </div>
                        <div className="winrate-pct">{pctStr} lần thắng</div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {best && <WinRateTakeaway best={best} />}
    </div>
  )
}

export const WinRateBlock = memo(WinRateBlockImpl)

interface Best {
  btcPct: number
  label: string
  wins: number
  total: number
  rate: number
}

function WinRateTakeaway({ best }: { best: Best }) {
  return (
    <div className="winrate-takeaway">
      <span className="mm-takeaway-emoji">🎯</span>
      <span>
        Ở <strong>{best.btcPct}% Bitcoin</strong>, trong{' '}
        <strong>{best.total} khoảng {best.label}</strong> liên tiếp có trong lịch sử, danh mục có BTC thắng{' '}
        <strong>{best.wins} lần</strong> ({(best.rate * 100).toFixed(0)}%). Không phải lúc nào cũng thắng, nhưng xác suất rõ ràng nghiêng về phía có BTC.
      </span>
    </div>
  )
}
