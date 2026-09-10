/**
 * DcaReturnExplainer: gộp hai phần giải thích của tab DCA thành một khối.
 *
 * Trước đây tách làm hai: "Vì sao có 3 con số lợi nhuận khác nhau" (so sánh
 * nhanh CAGR, TWRR, MWRR) và "Giải Thích Khái Niệm" (định nghĩa, công thức).
 * Nay gộp còn một khối: mở ra là thấy cả so sánh nhanh lẫn định nghĩa chi tiết.
 *
 * Ẩn dụ "cây giống" lấy từ blog Võ Hoàng Hạc (cẩm nang DCA toàn tập phần 2).
 * Default collapsed, user nào tò mò thì mở.
 */
import { useState, memo } from 'react'

interface ExplainerPortfolio {
  id: string
  name: string
  color: string
  cagr: number | null
  twrr: number | null
  mwrr: number | null
}

interface Props {
  portfolios: ExplainerPortfolio[]
  /** "quỹ" hoặc "cổ phiếu" để câu chữ không gọi sai loại tài sản. */
  assetLabel?: string
}

function DcaReturnExplainerImpl({ portfolios, assetLabel = 'quỹ' }: Props) {
  const [open, setOpen] = useState(false)

  // Khối luôn hiện: phần định nghĩa bên dưới là kiến thức tĩnh, không cần dữ liệu,
  // và trước đây phần này là mục "Giải Thích Khái Niệm" luôn hiển thị. Ba thẻ số
  // và ví dụ chỉ hiện khi có ít nhất một danh mục đủ cả ba chỉ số.
  const valid = portfolios.filter(p => p.cagr !== null && p.mwrr !== null && p.twrr !== null)
  const example = valid.length > 0
    ? [...valid].sort((a, b) => Math.abs((b.mwrr! - b.cagr!)) - Math.abs((a.mwrr! - a.cagr!)))[0]!
    : undefined

  const cagrPct = example ? (example.cagr! * 100).toFixed(2) : ''
  const twrrPct = example ? (example.twrr! * 100).toFixed(2) : ''
  const mwrrPct = example ? (example.mwrr! * 100).toFixed(2) : ''
  const gapMvT = example ? (example.mwrr! - example.twrr!) * 100 : 0
  const timingHelped = gapMvT > 0
  const gapMvTabs = Math.abs(gapMvT).toFixed(2)

  return (
    <div className={`dca-explainer-block${open ? ' dca-explainer-block--open' : ''}`}>
      <button
        className="dca-explainer-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="dca-explainer-icon">💡</span>
        <span className="dca-explainer-toggle-text">
          Vì sao có 3 con số lợi nhuận khác nhau? Giải thích CAGR, TWRR, MWRR
        </span>
        <span className="dca-explainer-chevron">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="dca-explainer-body">
          <p className="dca-explainer-intro">
            Nhiều nhà đầu tư nhìn thấy mấy con số lợi nhuận chênh lệch nhau và bối rối:
            <em> "Tôi đã đầu tư tổng cộng 108 triệu đồng... nếu mà tăng trưởng 30%/năm
            thì không thể nào tôi chỉ có 168 triệu được. Quá vô lý!" </em>
            Thật ra mỗi con số trả lời một câu hỏi khác nhau.
          </p>

          {example && (
          <>
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
              <div className="dca-explainer-metric-name">TWRR</div>
              <div className="dca-explainer-metric-val">{twrrPct}%/năm</div>
              <div className="dca-explainer-metric-desc">
                Trả lời: <em>"Chính {assetLabel} này tăng trưởng bao nhiêu phần trăm mỗi
                năm?"</em> Đã tách khỏi chuyện bạn đầu tư lúc nào. Dùng để so sánh các{' '}
                {assetLabel} với nhau.
              </div>
            </div>

            <div className="dca-explainer-vs">vs</div>

            <div className="dca-explainer-metric">
              <div className="dca-explainer-metric-name">MWRR</div>
              <div className="dca-explainer-metric-val">{mwrrPct}%/năm</div>
              <div className="dca-explainer-metric-desc">
                Trả lời: <em>"Từng khoản tôi đầu tư vào tăng trưởng trung bình bao nhiêu
                phần trăm mỗi năm?"</em> Chiết khấu từng dòng tiền theo thời gian thực tế
                nắm giữ.
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
                <strong>TWRR</strong> đo tốc độ lớn của <em>chính giống cây</em>, không phụ
                thuộc bạn mua cây lúc nào. Hai người cùng trồng một giống, mua ở hai thời
                điểm khác nhau, TWRR giống nhau.
              </li>
              <li>
                <strong>MWRR</strong> tính tăng trưởng của <em>từng cái cây riêng biệt</em>.
                Cây trồng lâu có nhiều thời gian sinh trưởng sẽ mang về nhiều tiền hơn cây
                mới mua.
              </li>
            </ul>
            <p>
              Với DCA, khoản tiền bạn đầu tư tháng đầu tiên đã nắm giữ nhiều năm, nhưng
              khoản tiền tháng trước chỉ mới nắm giữ vài tuần. MWRR tính đến điều này.
              Trong ví dụ của bạn, MWRR {timingHelped ? 'cao hơn' : 'thấp hơn'} TWRR
              khoảng <strong>{gapMvTabs}%/năm</strong>
              {timingHelped
                ? ', nghĩa là thời điểm bạn đầu tư có lợi.'
                : ', nghĩa là thời điểm bạn đầu tư kém thuận lợi.'}
            </p>
          </div>
          </>
          )}

          {/* Hợp nhất phần "Giải Thích Khái Niệm" cũ vào đây */}
          <div className="dca-glossary-content dca-glossary-content--plain">
            <hr className="dca-glossary-divider" />

            <p>
              Phần dưới đi sâu vào từng chỉ số, kèm công thức và ví dụ số. Cả bốn chỉ số
              đều đúng, chỉ khác câu hỏi chúng trả lời.
            </p>

            <hr className="dca-glossary-divider" />

            <h3>① Lợi nhuận tích lũy</h3>
            <p>
              Đây là chỉ số đơn giản nhất: tổng số phần trăm bạn lãi hoặc lỗ so với vốn
              đã đầu tư.
            </p>
            <div className="dca-glossary-formula">
              Lợi nhuận tích lũy = Giá trị cuối kỳ ÷ Tổng đầu tư &minus; 1
            </div>
            <p>
              Ví dụ: bạn đầu tư tổng cộng 41 triệu, danh mục hiện trị giá 56 triệu →
              lợi nhuận tích lũy = 56 ÷ 41 &minus; 1 = <strong>+36.6%</strong>.
            </p>
            <p>
              Con số này trả lời <em>"Tổng tôi lãi bao nhiêu phần trăm?"</em> nhưng không
              cho biết tốc độ tăng trưởng mỗi năm, nên khó so sánh giữa các khoảng thời
              gian khác nhau.
            </p>

            <hr className="dca-glossary-divider" />

            <h3>② CAGR: Lợi nhuận tích lũy quy năm</h3>
            <p>
              CAGR lấy lợi nhuận tích lũy ở trên và quy về năm. Nếu danh mục tăng đều mỗi
              năm với một tỷ lệ cố định, tỷ lệ đó là bao nhiêu?
            </p>
            <div className="dca-glossary-formula">
              CAGR = (Giá trị cuối ÷ Tổng đầu tư)<sup>1/n</sup> &minus; 1
            </div>
            <p>
              Ví dụ: 56 triệu ÷ 41 triệu trong 3 năm → CAGR = 1.366<sup>1/3</sup> &minus; 1
              = <strong>+11.1%/năm</strong>. Con số này giúp so sánh các danh mục có thời
              gian khác nhau.
            </p>
            <blockquote className="dca-glossary-note">
              <strong>Lưu ý:</strong> CAGR trong tab này tính theo góc nhìn của nhà đầu tư,
              tổng vốn đã đầu tư so với giá trị cuối kỳ. Đây <em>không phải</em> CAGR thuần
              của {assetLabel} (đó là TWRR), vì nó bỏ qua các lần đầu tư DCA. Chỉ quy năm
              khi kỳ từ 1 năm trở lên.
            </blockquote>

            <hr className="dca-glossary-divider" />

            <h3>③ TWRR: Lợi nhuận của chính {assetLabel}</h3>
            <p>
              TWRR là lợi nhuận của chính {assetLabel}, không phụ thuộc bạn đầu tư lúc nào
              và bao nhiêu. Cách tính: nhân gộp lợi nhuận từng phiên.
            </p>
            <div className="dca-glossary-formula">
              (1 + r<sub>1</sub>) × (1 + r<sub>2</sub>) × ... × (1 + r<sub>n</sub>), rồi quy năm
            </div>
            <p>
              Mỗi r là lợi nhuận một phiên. Tiền bạn đầu tư thêm bị tách ra, còn phí giao
              dịch thì vẫn bị trừ. Nhờ vậy hai người cùng một {assetLabel} nhưng đầu tư
              khác lịch vẫn ra cùng một TWRR. Đây là con số để so sánh các {assetLabel} với
              nhau.
            </p>
            <blockquote className="dca-glossary-note">
              <strong>Hai cột TWRR trong bảng:</strong> cột sau phí đã trừ phí mua, phí bán
              và thuế; cột trước phí thì chưa. Chênh lệch giữa hai cột là phần phí ăn mòn.
            </blockquote>

            <hr className="dca-glossary-divider" />

            <h3>④ MWRR: Chỉ số chính cho DCA</h3>
            <p>
              MWRR là tỷ suất sinh lời thực tế của bạn, có tính đến <strong>thời điểm và số
              tiền</strong> của từng lần đầu tư. Về mặt toán học, MWRR chính là IRR của
              toàn bộ dòng tiền.
            </p>
            <p>
              Đây là chỉ số trả lời đúng câu hỏi quan trọng nhất với DCA:{' '}
              <em>"Chiến lược đầu tư định kỳ của tôi thực sự hiệu quả bao nhiêu %/năm?"</em>
            </p>

            <h4>Tại sao MWRR thường khác CAGR trong DCA?</h4>
            <p>
              Chênh lệch này bình thường khi thị trường tăng đều. Nó đến từ cách mỗi chỉ số
              hiểu về "thời gian đầu tư":
            </p>
            <ul>
              <li>
                <strong>CAGR giả định sai:</strong> công thức ngầm coi như{' '}
                <em>toàn bộ vốn đã hoạt động suốt n năm</em>. Nhưng khoản đầu tư tháng thứ
                30 chỉ hoạt động 6 tháng cuối, không phải 3 năm. CAGR cho ra con số thấp hơn.
              </li>
              <li>
                <strong>MWRR phản ánh đúng:</strong> mỗi khoản chỉ hoạt động từ lúc đầu tư
                đến cuối kỳ. Để ra kết quả cuối kỳ từ những khoản ngắn hạn hơn, lãi suất
                thực tế phải cao hơn.
              </li>
            </ul>
            <div className="dca-glossary-table-wrap">
              <table className="dca-glossary-table">
                <thead>
                  <tr>
                    <th>Khoản đầu tư</th>
                    <th>Thời gian thực tế hoạt động</th>
                    <th>CAGR giả định là</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>5M ban đầu</td><td>3 năm</td><td>3 năm ✓</td></tr>
                  <tr><td>1M tháng 6</td><td>2 năm 6 tháng</td><td>3 năm ✗</td></tr>
                  <tr><td>1M tháng 18</td><td>1 năm 6 tháng</td><td>3 năm ✗</td></tr>
                  <tr><td>1M tháng 35</td><td>1 tháng</td><td>3 năm ✗</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              Thời gian hoạt động trung bình thực tế chỉ khoảng 1,5 năm, không phải 3 năm.
              MWRR tính đúng điều đó nên cho con số cao hơn CAGR.
            </p>
            <blockquote className="dca-glossary-note">
              <strong>Quan hệ này có thể đảo chiều:</strong> nếu bạn đầu tư một khoản lớn
              ngay trước khi thị trường sụt mạnh (<em>"đu đỉnh"</em>), MWRR sẽ{' '}
              <strong>thấp hơn</strong> CAGR, phản ánh đúng thiệt hại do thời điểm đầu tư.
            </blockquote>

            <hr className="dca-glossary-divider" />

            <h3>⑤ Dùng chỉ số nào?</h3>
            <div className="dca-glossary-table-wrap">
              <table className="dca-glossary-table">
                <thead>
                  <tr>
                    <th>Câu hỏi</th>
                    <th>Chỉ số phù hợp</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Tổng tôi lãi bao nhiêu phần trăm so với vốn đã đầu tư?</td>
                    <td><strong>Lợi nhuận tích lũy</strong></td>
                  </tr>
                  <tr>
                    <td>Nếu quy năm thì mỗi năm lãi bao nhiêu?</td>
                    <td><strong>CAGR</strong></td>
                  </tr>
                  <tr>
                    <td>{assetLabel} hoặc chiến lược này tốt đến đâu, so với các {assetLabel} khác?</td>
                    <td><strong>TWRR</strong> ✓ Khuyến nghị</td>
                  </tr>
                  <tr>
                    <td>Số tiền tôi thực đầu tư đã đi tới đâu?</td>
                    <td><strong>MWRR</strong> ✓ Khuyến nghị</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <blockquote className="dca-glossary-note">
              Muốn đánh giá {assetLabel} hoặc chiến lược, đọc <strong>TWRR</strong>. Muốn
              biết tiền của bạn đi tới đâu, đọc <strong>MWRR</strong>. Lợi nhuận tích lũy và
              CAGR là con số bổ trợ giúp hiểu thêm bức tranh tổng thể.
            </blockquote>
          </div>
        </div>
      )}
    </div>
  )
}

export const DcaReturnExplainer = memo(DcaReturnExplainerImpl)
