/**
 * DcaReturnExplainer: giải thích vì sao có 2 con số lợi nhuận khác nhau (CAGR vs MWRR).
 *
 * Retail VN hay nhìn thấy 2 con số chênh lệch nhau 5-10% và bối rối.
 * Dùng ẩn dụ "cây giống" trực tiếp từ blog Võ Hoàng Hạc (cam-nang-dca-toan-tap phần 2)
 * để giải thích: CAGR giả định toàn bộ tiền có từ đầu, MWRR chiết khấu từng dòng tiền.
 *
 * Default collapsed, user nào tò mò thì mở.
 */
import { useState, memo } from 'react'

interface ExplainerPortfolio {
  id: string
  name: string
  color: string
  cagr: number | null
  mwrr: number | null
}

interface Props {
  portfolios: ExplainerPortfolio[]
}

function DcaReturnExplainerImpl({ portfolios }: Props) {
  const [open, setOpen] = useState(false)

  // Nếu không có portfolio nào có đủ 2 chỉ số thì không render
  const valid = portfolios.filter(p => p.cagr !== null && p.mwrr !== null)
  if (valid.length === 0) return null

  // Pick portfolio có gap lớn nhất giữa CAGR vs MWRR để làm ví dụ minh họa
  const example = [...valid].sort(
    (a, b) => Math.abs((b.mwrr! - b.cagr!)) - Math.abs((a.mwrr! - a.cagr!)),
  )[0]!

  const cagrPct = (example.cagr! * 100).toFixed(2)
  const mwrrPct = (example.mwrr! * 100).toFixed(2)
  const gap = (example.mwrr! - example.cagr!) * 100
  const gapAbs = Math.abs(gap).toFixed(2)
  const mwrrHigher = gap > 0

  return (
    <div className={`dca-explainer-block${open ? ' dca-explainer-block--open' : ''}`}>
      <button
        className="dca-explainer-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="dca-explainer-icon">💡</span>
        <span className="dca-explainer-toggle-text">
          Vì sao có 2 con số lợi nhuận khác nhau (CAGR vs MWRR)?
        </span>
        <span className="dca-explainer-chevron">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="dca-explainer-body">
          <p className="dca-explainer-intro">
            Nhiều nhà đầu tư nhìn thấy 2 con số lợi nhuận chênh lệch nhau và bối rối:
            <em> "Tôi đã đầu tư tổng cộng 108 triệu đồng... nếu mà tăng trưởng 30%/năm
            thì không thể nào tôi chỉ có 168 triệu được. Quá vô lý!" </em>
            Thật ra cả hai đều đúng, chỉ là đo khác nhau.
          </p>

          <div className="dca-explainer-compare">
            <div className="dca-explainer-metric">
              <div className="dca-explainer-metric-name">CAGR</div>
              <div className="dca-explainer-metric-val">{cagrPct}%/năm</div>
              <div className="dca-explainer-metric-desc">
                Trả lời: <em>"Toàn bộ số tiền tôi đã đầu tư đã tăng trưởng bao nhiêu phần
                trăm mỗi năm?"</em> Giả định tất cả vốn đã hoạt động từ ngày đầu tiên.
              </div>
            </div>

            <div className="dca-explainer-vs">vs</div>

            <div className="dca-explainer-metric dca-explainer-metric--highlight">
              <div className="dca-explainer-metric-name">MWRR</div>
              <div className="dca-explainer-metric-val">{mwrrPct}%/năm</div>
              <div className="dca-explainer-metric-desc">
                Trả lời: <em>"Từng khoản tôi nạp vào tăng trưởng trung bình bao nhiêu phần
                trăm mỗi năm?"</em> Chiết khấu từng dòng tiền theo thời gian thực tế nắm giữ.
              </div>
            </div>
          </div>

          <div className="dca-explainer-analogy">
            <h4 className="dca-explainer-analogy-title">🌱 Ví dụ "cây giống"</h4>
            <p>
              Mỗi tháng bạn dành ra một khoản tiền để mua cây giống về trồng. Hãy xem
              mỗi cái cây là một khoản đầu tư.
            </p>
            <p>
              Sau ba năm, bạn bán hết số cây đang có. Tổng số tiền bán được xem như là
              doanh thu từ khoản đầu tư. Câu hỏi đặt ra là:{' '}
              <em>"Làm sao bạn biết khoản đầu tư này tốt tới đâu?"</em>
            </p>
            <ul className="dca-explainer-bullets">
              <li>
                <strong>CAGR</strong> coi như bạn có đủ tiền từ đầu để mua tất cả cây trong
                ngày đầu tiên. Chia lợi nhuận cuối cùng cho tổng vốn, quy về hằng năm.
              </li>
              <li>
                <strong>MWRR</strong> tính tăng trưởng của <em>từng cái cây riêng biệt</em>.
                Cây trồng lâu có nhiều thời gian sinh trưởng sẽ mang về nhiều tiền hơn cây
                mới mua.
              </li>
            </ul>
            <p>
              Với DCA, khoản tiền bạn nạp tháng đầu tiên đã nắm giữ nhiều năm, nhưng khoản
              tiền tháng trước chỉ mới nắm giữ vài tuần. MWRR nhận ra điều này nên{' '}
              {mwrrHigher ? (
                <>thường cao hơn CAGR. Trong ví dụ của bạn, MWRR cao hơn CAGR{' '}
                <strong>{gapAbs}%/năm</strong>.</>
              ) : (
                <>chênh lệch với CAGR khoảng <strong>{gapAbs}%/năm</strong>.</>
              )}
            </p>
          </div>

          <div className="dca-explainer-conclusion">
            <strong>Nên nhìn con số nào?</strong> Nếu bạn muốn biết tiền của mình thực tế
            đã tăng trưởng ra sao, <strong>MWRR là chỉ số chính cho chiến lược DCA</strong>.
            Nhưng nếu bạn quen so sánh với các hình thức đầu tư khác (gửi tiết kiệm,
            trái phiếu) thì CAGR vẫn hữu ích. Nó trả lời câu hỏi đơn giản hơn: <em>"toàn
            bộ số tiền tôi đã đầu tư tăng bao nhiêu phần trăm mỗi năm?"</em>
          </div>
        </div>
      )}
    </div>
  )
}

export const DcaReturnExplainer = memo(DcaReturnExplainerImpl)
