import { useState } from 'react'

export function DCAGlossary() {
  const [open, setOpen] = useState(false)

  return (
    <div className="dca-glossary">
      <button
        className="dca-glossary-toggle"
        onClick={() => setOpen(!open)}
      >
        Giải Thích Khái Niệm {open ? '▲' : '▼'}
      </button>

      {open && (
        <div className="dca-glossary-content">

          {/* ── Intro ── */}
          <p>
            Tab DCA hiển thị <strong>3 chỉ số chính</strong> trong thẻ tóm tắt:
            Lợi nhuận tích lũy, CAGR, và MWRR. Ba chỉ số này đo những điều khác nhau
            và dùng cho những mục đích khác nhau. Phần dưới đây giải thích từng chỉ số
            theo trình tự từ đơn giản đến phức tạp.
          </p>

          <hr className="dca-glossary-divider" />

          {/* ── 1. Lợi nhuận tích lũy ── */}
          <h3>① Lợi nhuận tích lũy</h3>
          <p>
            Đây là chỉ số đơn giản nhất: tổng số % bạn lãi hoặc lỗ so với vốn đã đầu tư.
          </p>
          <div className="dca-glossary-formula">
            Lợi nhuận tích lũy = Giá trị cuối kỳ ÷ Tổng đầu tư &minus; 1
          </div>
          <p>
            Ví dụ: bạn đầu tư tổng cộng 41 triệu, danh mục hiện trị giá 56 triệu →
            lợi nhuận tích lũy = 56 ÷ 41 &minus; 1 = <strong>+36.6%</strong>.
          </p>
          <p>
            Chỉ số này trả lời câu hỏi <em>"Tổng tôi lãi bao nhiêu %?"</em> nhưng
            không cho biết tốc độ tăng trưởng mỗi năm, nên khó so sánh giữa các khoảng
            thời gian khác nhau.
          </p>

          <hr className="dca-glossary-divider" />

          {/* ── 2. CAGR ── */}
          <h3>② CAGR: Lợi nhuận tích lũy quy năm</h3>
          <p>
            CAGR (Compound Annual Growth Rate) lấy lợi nhuận tích lũy ở trên và "quy
            năm" nó: nếu danh mục tăng đều mỗi năm với một tỷ lệ cố định, thì tỷ lệ
            đó là bao nhiêu?
          </p>
          <div className="dca-glossary-formula">
            CAGR = (Giá trị cuối ÷ Tổng đầu tư)<sup>1/n</sup> &minus; 1
          </div>
          <p>
            Ví dụ: 56 triệu ÷ 41 triệu trong 3 năm → CAGR = 1.366<sup>1/3</sup> &minus; 1
            = <strong>+11.1%/năm</strong>. Con số này phản ánh sức mạnh của lãi kép
            và giúp bạn so sánh các danh mục có thời gian khác nhau.
          </p>
          <blockquote className="dca-glossary-note">
            <strong>Lưu ý:</strong> CAGR trong tab này tính theo góc nhìn của nhà đầu
            tư, tổng vốn đã đầu tư so với giá trị cuối kỳ. Đây <em>không phải</em> CAGR
            thuần của quỹ (TWRR), vốn bỏ qua các lần nạp tiền DCA.
          </blockquote>

          <hr className="dca-glossary-divider" />

          {/* ── 3. MWRR ── */}
          <h3>③ MWRR: Chỉ số chính cho DCA</h3>
          <p>
            MWRR (Money-Weighted Rate of Return) là tỷ suất sinh lời thực tế của bạn
            với tư cách là nhà đầu tư, có tính đến <strong>thời điểm và số tiền</strong> của
            từng lần nạp. Về mặt toán học, MWRR chính là IRR (Internal Rate of Return)
            của toàn bộ dòng tiền.
          </p>
          <p>
            Đây là chỉ số trả lời đúng câu hỏi quan trọng nhất với DCA:{' '}
            <em>"Chiến lược nạp tiền định kỳ của tôi thực sự hiệu quả bao nhiêu %/năm?"</em>
          </p>

          <h4>Tại sao MWRR thường cao hơn CAGR trong DCA?</h4>
          <p>
            Đây là hiện tượng <strong>hoàn toàn bình thường</strong> khi thị trường
            tăng đều, và xuất phát từ cách mỗi chỉ số hiểu về "thời gian đầu tư":
          </p>
          <ul>
            <li>
              <strong>CAGR giả định sai:</strong> Công thức ngầm coi như{' '}
              <em>toàn bộ vốn đã hoạt động suốt n năm</em>. Nhưng khoản nạp tháng
              thứ 30 chỉ thực sự hoạt động 6 tháng cuối, không phải 3 năm. CAGR
              "phạt" bạn bằng cách giả định sai điều đó, nên cho ra con số thấp hơn.
            </li>
            <li>
              <strong>MWRR phản ánh đúng:</strong> MWRR biết rằng mỗi khoản nạp chỉ
              hoạt động từ lúc nạp đến cuối kỳ. Để tạo ra kết quả cuối kỳ từ những
              khoản ngắn hạn hơn đó, lãi suất thực tế phải cao hơn.
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
            Thời gian hoạt động trung bình thực tế chỉ khoảng ~1.5 năm, không phải
            3 năm. MWRR tính đúng điều đó nên cho ra con số cao hơn CAGR.
          </p>
          <blockquote className="dca-glossary-note">
            <strong>Quan hệ này có thể đảo chiều:</strong> Nếu bạn nạp một khoản lớn
            ngay trước khi thị trường sụt mạnh (<em>"đu đỉnh"</em>), MWRR sẽ{' '}
            <strong>thấp hơn</strong> CAGR, phản ánh đúng thiệt hại thực tế mà
            thời điểm nạp tiền gây ra.
          </blockquote>

          <hr className="dca-glossary-divider" />

          {/* ── 4. Kết luận ── */}
          <h3>④ Dùng chỉ số nào?</h3>
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
                  <td>Tổng tôi lãi bao nhiêu % so với vốn đã đầu tư?</td>
                  <td><strong>Lợi nhuận tích lũy</strong></td>
                </tr>
                <tr>
                  <td>Nếu quy năm thì mỗi năm lãi bao nhiêu?</td>
                  <td><strong>CAGR</strong></td>
                </tr>
                <tr>
                  <td>Chiến lược DCA của tôi thực sự hiệu quả bao nhiêu?</td>
                  <td><strong>MWRR</strong> ✓ Khuyến nghị</td>
                </tr>
              </tbody>
            </table>
          </div>
          <blockquote className="dca-glossary-note">
            Với chiến lược DCA, hãy lấy <strong>MWRR làm chỉ số chính</strong>.
            CAGR và Lợi nhuận tích lũy là những con số bổ trợ giúp bạn hiểu thêm
            bức tranh tổng thể.
          </blockquote>

        </div>
      )}
    </div>
  )
}
