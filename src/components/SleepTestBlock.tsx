import { memo } from 'react'
import type { PortfolioStats } from './PerformanceTable'
import { formatVND } from '../utils/vndFormat'

interface Props {
  investAmount: number
  stats: PortfolioStats[]      // stats[0] = baseline (no BTC)
}

/**
 * Sleep Test: dịch 3 chỉ số rủi ro (worst week, worst month, max drawdown)
 * ra số tiền VND cụ thể. Mục tiêu là trả lời câu hỏi retail investor hay
 * hỏi nhất: "nếu tệ nhất thì tôi mất bao nhiêu?"
 *
 * Narrative chính: thêm BTC kéo lợi nhuận lên nhưng cũng làm đáy sâu hơn.
 * Người dùng cần thấy cả 2 mặt để quyết định tỷ trọng BTC nào họ thật sự
 * chịu nổi về mặt tâm lý (pain threshold), không chỉ về mặt toán học.
 */
function SleepTestBlockImpl({ investAmount, stats }: Props) {
  if (stats.length < 2) return null

  const base = stats[0]!
  const worstBtc = stats.slice(1).reduce(
    (worst, s) => (s.maxDD < worst.maxDD ? s : worst),
    stats[1]!,
  )

  // Delta drawdown tệ nhất giữa portfolio BTC cao nhất và baseline, dùng cho takeaway
  const extraPainVND = investAmount * Math.abs(worstBtc.maxDD - base.maxDD)
  const btcFloor = investAmount * (1 + worstBtc.maxDD)

  return (
    <div className="sleep-test-container">
      <div className="chart-header">
        <h3>Bài kiểm tra tâm lý: nếu rơi xuống đáy, bạn còn bao nhiêu?</h3>
        <span
          className="chart-tooltip-icon"
          title="Ba chỉ số rủi ro dịch ra số tiền thật. Tệ nhất 1 tuần / 1 tháng là biến động ngắn hạn trong lịch sử. Drawdown tệ nhất là mức sụt giảm sâu nhất từ đỉnh xuống đáy trong toàn bộ thời kỳ mô phỏng. Dùng để đánh giá bạn có ngủ ngon được với danh mục này không."
        >?</span>
      </div>
      <div className="sleep-test-intro">
        Nếu danh mục bạn có <strong>{formatVND(investAmount)}</strong>, ở các điểm tệ nhất trong lịch sử mô phỏng, danh mục còn lại:
      </div>

      <div className="perf-table-wrap">
        <table className="perf-table sleep-test-table">
          <thead>
            <tr>
              <th className="perf-th-name">Danh mục</th>
              <th title="Tuần giảm mạnh nhất trong lịch sử. Số tiền là danh mục còn lại sau tuần đó.">Tệ nhất 1 tuần</th>
              <th title="Khoảng 4 tuần liên tiếp giảm mạnh nhất. Số tiền là danh mục còn lại sau 4 tuần đó.">Tệ nhất 1 tháng</th>
              <th title="Mức sụt giảm sâu nhất từ đỉnh xuống đáy. Số tiền là danh mục còn lại tại điểm đáy.">Drawdown tệ nhất</th>
            </tr>
          </thead>
          <tbody>
            {stats.map(s => (
              <tr key={s.name}>
                <td className="perf-td-name">
                  <span className="perf-dot" style={{ background: s.color }} />
                  {s.name}
                </td>
                <td className="perf-neg sleep-cell">
                  <div className="sleep-pct">{fmtPct(s.worstWeek)}</div>
                  <div className="sleep-vnd">còn {formatVND(investAmount * (1 + s.worstWeek))}</div>
                </td>
                <td className="perf-neg sleep-cell">
                  <div className="sleep-pct">{fmtPct(s.worstMonth)}</div>
                  <div className="sleep-vnd">còn {formatVND(investAmount * (1 + s.worstMonth))}</div>
                </td>
                <td className="perf-neg sleep-cell">
                  <div className="sleep-pct">{fmtPct(s.maxDD)}</div>
                  <div className="sleep-vnd">còn {formatVND(investAmount * (1 + s.maxDD))}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {extraPainVND > 0 && (
        <div className="sleep-test-takeaway">
          <span className="mm-takeaway-emoji">😰</span>
          <span>
            Với <strong>{worstBtc.name}</strong>, có thời điểm danh mục <strong>{formatVND(investAmount)}</strong> của bạn chỉ còn{' '}
            <strong>{formatVND(btcFloor)}</strong>. Nhìn con số đó, bạn có ngủ được không? Nếu không, giảm tỷ trọng Bitcoin xuống mức thấp hơn.
          </span>
        </div>
      )}
    </div>
  )
}

export const SleepTestBlock = memo(SleepTestBlockImpl)

function fmtPct(value: number): string {
  return (value * 100).toFixed(1) + '%'
}
