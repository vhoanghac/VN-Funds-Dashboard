import { memo } from 'react'

/**
 * Tab "Minh Bạch Hoá": tài liệu giải thích chính xác cách dashboard tính từng
 * con số, bắt đầu từ tab DCA. Nội dung tĩnh, viết theo giọng blog vohoanghac,
 * ví dụ số dùng số minh hoạ cố định (không kéo từ trạng thái mô phỏng) để luôn
 * khớp với code và không bao giờ vỡ khi dữ liệu đổi.
 *
 * Mỗi công thức ở đây phản ánh đúng hàm thật trong src/utils/dca.ts,
 * drawdownStats.ts và calculations.ts. Khi sửa công thức trong code, nhớ cập
 * nhật lại tab này cho khớp.
 */

const SECTIONS = [
  { id: 'm-data', label: '0. Dữ liệu lấy từ đâu' },
  { id: 'm-sim', label: '1. Mô phỏng DCA chạy thế nào' },
  { id: 'm-returns', label: '2. Bốn cách đo lợi nhuận' },
  { id: 'm-risk', label: '3. Đo rủi ro' },
  { id: 'm-behavior', label: '4. Các kịch bản hành vi' },
  { id: 'm-future', label: '5. Dự phóng tương lai (Endgame)' },
]

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Khối công thức nổi bật (monospace, nền nhạt). */
function Formula({ children }: { children: React.ReactNode }) {
  return <div className="method-formula">{children}</div>
}

/** Dòng "trong đó:" giải thích ký hiệu ngay dưới công thức. */
function Where({ children }: { children: React.ReactNode }) {
  return <div className="method-where">{children}</div>
}

/** Dòng nối con số này tới đúng chỗ nó xuất hiện trên tab tương ứng (mặc định tab DCA). */
function SeenAt({ where = 'tab DCA', children }: { where?: string; children: React.ReactNode }) {
  return (
    <div className="method-seenat">
      <span className="method-seenat-icon">👉</span>
      <span>Xuất hiện ở {where}: {children}</span>
    </div>
  )
}

/** Hộp ví dụ số cụ thể. */
function Example({ children }: { children: React.ReactNode }) {
  return (
    <div className="method-example">
      <div className="method-example-label">Ví dụ bằng số</div>
      <div className="method-example-body">{children}</div>
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="method-section">
      <h3 className="method-section-title">{title}</h3>
      {children}
    </section>
  )
}

function MethodologyPanelImpl() {
  return (
    <div className="methodology-panel">
      <header className="method-header">
        <h2>Minh Bạch Hoá</h2>
      </header>

      <nav className="method-toc" aria-label="Mục lục">
        <div className="method-toc-title">Trong trang này</div>
        <ul>
          {SECTIONS.map(s => (
            <li key={s.id}>
              <button type="button" onClick={() => scrollToId(s.id)}>{s.label}</button>
            </li>
          ))}
        </ul>
      </nav>

      {/* ─────────────────────────── 0. DỮ LIỆU ─────────────────────────── */}
      <Section id="m-data" title="0. Dữ liệu lấy từ đâu">
        <p>
          Giá quỹ mở lấy từ <strong>fmarket.vn</strong> (NAV mỗi ngày giao dịch). Giá ETF
          và Bitcoin lấy từ <strong>vnstock</strong> và CoinGecko. Giá vàng lấy từ
          sjc.com.vn. Toàn bộ tự động cập nhật hàng ngày.
        </p>
        <p>
          Với quỹ có chia cổ tức (ví dụ DCDE), giá lịch sử được <strong>điều chỉnh cổ
          tức sau thuế</strong> ngay ở khâu nạp dữ liệu, theo kiểu factor của Yahoo. Nhờ
          vậy phần hiệu suất tự động phản ánh giả định tái đầu tư cổ tức, bạn không phải
          tự cộng trừ gì thêm.
        </p>
        <p>
          Mỗi quỹ cập nhật NAV vào ngày khác nhau, nhất là các quỹ đời đầu. Trước khi
          tính, dashboard căn tất cả về một <strong>lưới ngày chung</strong>: ngày nào
          một quỹ chưa có giá thì lấy giá gần nhất trước đó (forward fill). Khi so nhiều
          quỹ, kỳ tính bắt đầu từ ngày muộn nhất mà tất cả các quỹ đều đã có dữ liệu.
        </p>
        <SeenAt where="tab So Sánh">mục "Chất lượng dữ liệu" minh bạch khoảng dữ liệu và các khoảng trống của từng quỹ.</SeenAt>

        <h4 className="method-sub">0.1. Tiết kiệm ngân hàng: không lấy dữ liệu ở đâu cả</h4>
        <p>
          Tiết kiệm ngân hàng là trường hợp khác hẳn mọi tài sản còn lại trong danh sách.
          Nó không có NAV, không có nguồn nào để fetch. Bạn nhập một mức lãi suất cố định
          (mặc định 6%/năm), dashboard tự sinh ra một chuỗi giá lãi kép ngay trong trình
          duyệt, rồi coi chuỗi giá đó như NAV của một quỹ bình thường:
        </p>
        <Formula>Giá(t) = 100 × (1 + lãi suất)<sup>số ngày đã trôi qua / 365,25</sup></Formula>
        <p>
          Chuỗi giá này hoạt động giống như chứng chỉ quỹ. Mỗi lần nạp tiền, vẫn mua
          "đơn vị" tại giá hôm đó. Vẫn trộn theo tỷ trọng. Vẫn tái cân bằng theo lịch bạn
          chọn. Tiền nạp tháng nào, sinh lãi từ tháng đó, không gộp lại rồi cộng lãi một
          cục cuối năm.
        </p>
        <p>
          Giới hạn cần biết: lãi suất ngân hàng thật đổi theo từng năm, lúc 4%, lúc 8%. Số
          bạn nhập ở đây thì <strong>cố định suốt cả kỳ backtest</strong>, dù kỳ đó 10 hay
          20 năm. Đây không phải dữ liệu lịch sử lãi suất thật. Nhãn "lãi suất cố định giả
          định" ở dropdown chọn quỹ nhắc đúng điều đó.
        </p>
        <p>
          Hai chỗ dashboard cố tình KHÔNG hiển thị tiết kiệm, vì hiện lên là dạy sai:
        </p>
        <ul className="method-list">
          <li>
            <strong>Biểu đồ "Giá tài sản" (tab So Sánh).</strong> Chuỗi giá gốc 100 kia là
            chỉ số tự sinh, không phải giá thật của một đơn vị tài sản nào ngoài đời. Đặt
            nó cạnh giá một chứng chỉ quỹ hay giá một lượng vàng là ngầm bảo rằng tiết kiệm
            cũng có "giá đơn vị".
          </li>
          <li>
            <strong>Tỷ số Sharpe (tab Bitcoin).</strong> Sharpe là lợi nhuận chia cho biến
            động. Tiết kiệm có biến động bằng 0, chia cho 0 thì không ra "hiệu quả vô hạn"
            mà là không định nghĩa được, nên ô đó để trống. Sharpe sinh ra để so hai tài sản
            đều có rủi ro, áp lên tài sản không rủi ro là dùng sai thước.
          </li>
        </ul>
        <Example>
          <p>Gửi tiết kiệm với lãi suất giả định 6%/năm:</p>
          <ul>
            <li>Ngày bắt đầu: giá = 100.</li>
            <li>Sau đúng 1 năm: giá = 100 × 1,06<sup>1</sup> = <strong>106</strong>.</li>
            <li>Sau đúng 2 năm: giá = 100 × 1,06<sup>2</sup> = <strong>112,36</strong>.</li>
          </ul>
          <p>
            Trộn 60% tiết kiệm 6%/năm với 40% một quỹ ETF trong cùng danh mục thì phần
            tiết kiệm luôn đi lên đều đặn, còn phần ETF vẫn lên xuống theo thị trường như
            bình thường. Kết quả là một đường TWRR bớt dốc hơn, nhưng cũng bớt xóc hơn.
          </p>
        </Example>
        <SeenAt where="4 tab">tuỳ chọn "Tiết kiệm ngân hàng (lãi suất cố định, tự nhập)" trong danh sách chọn quỹ ở tab DCA, So Sánh, Tái Cân Bằng và Bitcoin, kèm ô nhập lãi suất %/năm ngay bên cạnh.</SeenAt>
      </Section>

      {/* ─────────────────────────── 1. MÔ PHỎNG ─────────────────────────── */}
      <Section id="m-sim" title="1. Mô phỏng DCA chạy thế nào">
        <p>
          DCA (đầu tư định kỳ) được mô phỏng như một vòng lặp đi qua từng ngày giao dịch.
          Đầu vào là những gì bạn nhập: số tiền đầu tiên, số tiền định kỳ, tần suất nạp
          (hàng ngày, hàng tuần, hàng tháng...), danh mục và tỷ trọng từng quỹ, cùng lịch
          tái cân bằng.
        </p>
        <p>Mỗi ngày, vòng lặp làm tuần tự:</p>
        <ol className="method-list">
          <li>
            <strong>Đo lợi nhuận thị trường trước.</strong> Tính giá trị danh mục hôm nay
            theo giá mới, so với giá trị cuối ngày hôm qua, ra lợi nhuận trong ngày. Bước
            này làm <em>trước</em> khi cộng tiền mới vào, để tách phần "thị trường tăng
            giảm" khỏi phần "bạn nạp thêm".
          </li>
          <li>
            <strong>Nạp tiền (nếu tới kỳ).</strong> Đến kỳ nạp thì mua thêm chứng chỉ quỹ
            tại NAV ngày đó, chia theo tỷ trọng danh mục. Số đơn vị quỹ tăng lên.
          </li>
          <li>
            <strong>Tái cân bằng (nếu tới lịch).</strong> Bán bớt quỹ đang vượt tỷ trọng,
            mua thêm quỹ đang thiếu, đưa danh mục về đúng tỷ trọng mục tiêu.
          </li>
        </ol>
        <p>
          Kết quả là bốn chuỗi số theo thời gian: <strong>giá trị danh mục</strong> (đã
          gồm tiền nạp), <strong>tổng đã đầu tư</strong>, <strong>dòng tiền</strong> (mỗi
          lần nạp là một số âm), và <strong>chuỗi lợi nhuận tích lũy TWRR</strong> (giải
          thích ở mục 2). Mọi bảng và biểu đồ trong tab DCA đều dựng lại từ bốn chuỗi này.
        </p>
        <p>
          Mô phỏng giả định mua được đúng số tiền bạn nhập mỗi kỳ, chưa tính phí giao dịch
          và thuế (trừ phần cổ tức đã trừ thuế ở khâu điều chỉnh giá). Với vàng, có cảnh
          báo riêng nếu số tiền mỗi kỳ chưa đủ mua 1 lô thật ngoài đời.
        </p>
      </Section>

      {/* ─────────────────────────── 2. LỢI NHUẬN ─────────────────────────── */}
      <Section id="m-returns" title="2. Bốn cách đo lợi nhuận">
        <p>
          Cùng một danh mục DCA có thể cho ra vài con số lợi nhuận khác nhau, và mỗi con
          số trả lời một câu hỏi khác nhau.
        </p>

        <h4 className="method-sub">2.1. Lợi nhuận tích lũy</h4>
        <p>Câu hỏi: mỗi đồng đã đầu tư tới nay lời bao nhiêu phần trăm?</p>
        <Formula>Lợi nhuận tích lũy = Giá trị cuối kỳ / Tổng đã đầu tư − 1</Formula>
        <p>
          Cách tính này đơn giản nhất. Nhưng nó không quy về năm, cũng không phân biệt
          đồng tiền nào đã nằm trong thị trường lâu hơn. Người DCA 10 năm và người DCA
          2 năm có thể ra cùng một con số, mà thực chất là hai câu chuyện khác hẳn nhau.
        </p>
        <SeenAt>cột "Lợi nhuận tích lũy" trong Bảng thống kê, và ô "Lợi nhuận" phần "Hành trình của bạn".</SeenAt>

        <h4 className="method-sub">2.2. CAGR nhà đầu tư</h4>
        <p>Câu hỏi: nếu quy về mỗi năm lời đều nhau thì bao nhiêu?</p>
        <Formula>CAGR = (Giá trị cuối / Tổng đã đầu tư)<sup>1 / số năm</sup> − 1</Formula>
        <p>
          Công thức này quy lợi nhuận về mỗi năm, nhưng <strong>chỉ đúng nếu toàn bộ vốn
          đã nằm trong thị trường từ ngày đầu</strong>. Với DCA thì không phải vậy. Phần
          lớn tiền chỉ mới nạp gần đây, chưa kịp sinh lời bao nhiêu.
        </p>
        <p>
          Vì thế CAGR nhà đầu tư thường <em>thấp hơn</em> MWRR ở dưới. Con số này tiện để
          so nhanh, nhưng không phải thước đo công bằng nhất cho DCA.
        </p>
        <SeenAt>cột "CAGR" trong Bảng thống kê.</SeenAt>

        <h4 className="method-sub">2.3. MWRR (lợi nhuận có trọng số dòng tiền)</h4>
        <p>
          Câu hỏi: nếu tính đúng thời điểm và số tiền của từng lần nạp, mỗi năm bạn thực
          sự lãi bao nhiêu? Đây là thước đo công bằng nhất cho DCA.
        </p>
        <p>
          MWRR chính là IRR (tỷ suất sinh lợi nội tại). Dashboard đi tìm mức lãi năm r,
          sao cho khi quy hết các dòng tiền về hiện tại theo r thì tổng bằng 0:
        </p>
        <Formula>Tìm r sao cho: Σ CF<sub>i</sub> / (1 + r)<sup>t<sub>i</sub></sup> = 0</Formula>
        <Where>
          CF<sub>i</sub> là dòng tiền thứ i: âm khi bạn nạp tiền vào, dương ở ngày cuối kỳ
          và bằng đúng giá trị danh mục lúc đó. t<sub>i</sub> là số năm kể từ lần nạp đầu
          tiên. Phương trình này không giải thẳng ra được, nên dashboard dò nghiệm bằng
          phương pháp Newton-Raphson.
        </Where>
        <p>
          MWRR có tính đến chuyện tiền nạp muộn có ít thời gian sinh lời hơn. Nhờ vậy nó
          không bị kéo thấp như CAGR nhà đầu tư. Đó là lý do vì sao trong DCA, MWRR
          thường cao hơn CAGR.
        </p>
        <SeenAt>cột "MWRR" trong Bảng thống kê, và cột "MWRR" ở các bảng kịch bản hoảng loạn / tăng tiền.</SeenAt>

        <Example>
          <p>
            Giả sử bạn nạp 100 triệu ngay đầu kỳ, nạp thêm 100 triệu sau đúng 1 năm, và
            sau 2 năm danh mục trị giá 231 triệu. Ba con số ra khác nhau:
          </p>
          <ul>
            <li>Lợi nhuận tích lũy = 231 / 200 − 1 = <strong>+15,5%</strong></li>
            <li>CAGR nhà đầu tư = (231 / 200)<sup>1/2</sup> − 1 = <strong>+7,47%/năm</strong></li>
            <li>
              MWRR: giải −100 − 100/(1+r) + 231/(1+r)<sup>2</sup> = 0, ra r =
              {' '}<strong>+10%/năm</strong>
            </li>
          </ul>
          <p>
            MWRR (10%) cao hơn CAGR nhà đầu tư (7,47%) vì 100 triệu nạp năm thứ hai chỉ có
            1 năm để sinh lời, MWRR tính đúng điều đó. CAGR nhà đầu tư lại giả định cả 200
            triệu đã chạy đủ 2 năm, nên bị kéo xuống thấp.
          </p>
        </Example>

        <h4 className="method-sub">2.4. TWRR (lợi nhuận có trọng số thời gian)</h4>
        <p>
          Câu hỏi: bản thân danh mục sinh lời thế nào, bất kể bạn nạp bao nhiêu và khi
          nào? TWRR tách hoàn toàn khỏi dòng tiền, đo đúng "hiệu suất của quỹ" chứ không
          phải "hiệu suất của ví bạn".
        </p>
        <p>
          Cách tính: mỗi ngày đo lợi nhuận thị trường (trước khi nạp thêm tiền), rồi nhân
          dồn các ngày lại:
        </p>
        <Formula>
          TWRR = (1 + r<sub>1</sub>)(1 + r<sub>2</sub>)...(1 + r<sub>n</sub>) − 1
        </Formula>
        <Where>
          r<sub>ngày</sub> = (giá trị danh mục hôm nay, tính trước khi nạp tiền mới) /
          (giá trị cuối ngày hôm qua) − 1.
        </Where>
        <p>
          Vì phần tiền nạp thêm được cộng vào <em>sau</em> khi đo lợi nhuận, việc bạn nạp
          nhiều hay ít không làm lệch TWRR. Đây là con số dùng để so sánh giữa các quỹ và
          để tính drawdown "bão thị trường thật" ở mục 3.
        </p>
        <Example>
          <p>Một danh mục qua 2 ngày:</p>
          <ul>
            <li>Ngày 0: nạp 100, giá trị 100.</li>
            <li>
              Ngày 1: thị trường tăng, giá trị (trước khi nạp) = 110, vậy r<sub>1</sub> =
              +10%. Sau đó nạp thêm 100, giá trị cuối ngày = 210.
            </li>
            <li>Ngày 2: thị trường giảm, giá trị = 189, vậy r<sub>2</sub> = 189/210 − 1 = −10%.</li>
          </ul>
          <p>
            TWRR = (1 + 0,10)(1 − 0,10) − 1 = <strong>−1%</strong>. Đúng bằng phần thị
            trường thực sự đi (tăng 10% rồi giảm 10%), không dính gì tới việc bạn nạp thêm
            100 giữa chừng. Trong khi đó số dư tài khoản đi từ 100 lên 210 rồi xuống 189,
            một câu chuyện khác hẳn.
          </p>
        </Example>

        <h4 className="method-sub">2.5. Đối chiếu nhanh</h4>
        <div className="method-table-wrap">
          <table className="method-table">
            <thead>
              <tr>
                <th>Thước đo</th>
                <th>Trả lời câu hỏi</th>
                <th>Có tính dòng tiền?</th>
                <th>Quy về năm?</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Lợi nhuận tích lũy</td>
                <td>Mỗi đồng lời bao nhiêu %?</td>
                <td>Có (gộp chung)</td>
                <td>Không</td>
              </tr>
              <tr>
                <td>CAGR nhà đầu tư</td>
                <td>Quy đều mỗi năm bao nhiêu?</td>
                <td>Không (coi như nạp 1 lần đầu kỳ)</td>
                <td>Có</td>
              </tr>
              <tr>
                <td>MWRR</td>
                <td>Lãi kép thực tế của bạn?</td>
                <td>Có (đúng thời điểm từng lần)</td>
                <td>Có</td>
              </tr>
              <tr>
                <td>TWRR</td>
                <td>Bản thân quỹ sinh lời thế nào?</td>
                <td>Không (tách hẳn dòng tiền)</td>
                <td>Có (khi quy CAGR)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 className="method-sub">2.6. Hiệu suất từng năm (Modified Dietz)</h4>
        <p>
          Bảng "Hiệu suất danh mục của bạn từng năm" không dùng TWRR mà dùng phương pháp
          Modified Dietz, để đo đúng trải nghiệm DCA thực tế của bạn trong từng năm. Tiền
          nạp càng sớm trong năm càng được tính trọng số cao (có nhiều thời gian sinh lời
          hơn), nạp cuối năm gần như chưa kịp sinh lời.
        </p>
        <Formula>
          R = (EV − BV − nạp ròng) / (BV + Σ nạp<sub>i</sub> × (1 − t<sub>i</sub>/T))
        </Formula>
        <Where>
          EV là giá trị cuối năm, BV là giá trị đầu năm, nạp ròng là tổng tiền nạp trong
          năm, t<sub>i</sub> là số ngày từ đầu kỳ tới lần nạp thứ i, T là tổng số ngày của
          năm đó. Đây là công thức chuẩn GIPS cho kỳ ngắn, ra kết quả ổn định mà không cần
          dò lặp như MWRR.
        </Where>
        <SeenAt>bảng "Hiệu suất danh mục của bạn từng năm" trong phần "Hiệu suất đầu tư".</SeenAt>
      </Section>

      {/* ─────────────────────────── 3. RỦI RO ─────────────────────────── */}
      <Section id="m-risk" title="3. Đo rủi ro">
        <h4 className="method-sub">3.1. Drawdown: vì sao có 2 đường</h4>
        <p>
          Drawdown là mức sụt giảm vốn so với đỉnh cao nhất từng đạt. Trong mục "Kiên trì
          qua bão" có 2 biểu đồ trông giống nhau nhưng đo 2 thứ khác nhau:
        </p>
        <Formula>Drawdown = Giá trị hiện tại / Đỉnh cao nhất từng đạt − 1</Formula>
        <ul className="method-list">
          <li>
            <strong>Giá quỹ sập bao nhiêu?</strong> Dùng chuỗi TWRR, tức tách khỏi dòng
            tiền. Đây là "bão thị trường thật" của bản thân quỹ, thường sâu hơn.
          </li>
          <li>
            <strong>Số dư tài khoản sập bao nhiêu?</strong> Dùng chuỗi giá trị thật của
            ví bạn (đã gồm tiền nạp). Đây là thứ bạn thấy khi mở app quỹ.
          </li>
        </ul>
        <p>
          Số dư tài khoản thường sập nông hơn giá quỹ, vì mỗi lần bạn nạp thêm tiền giữa
          bão, đỉnh số dư được kéo lên chậm lại và đáy cũng không sập sâu bằng. Đó chính
          là phần DCA cứu vớt. Ví dụ trong lịch sử DCDS, giá quỹ từng sập khoảng −69,5%
          nhưng số dư tài khoản lúc tệ nhất chỉ khoảng −52,2%.
        </p>
        <SeenAt>hai biểu đồ "Giá quỹ sập bao nhiêu?" và "Số dư tài khoản sập bao nhiêu?" trong "Kiên trì qua bão".</SeenAt>

        <h4 className="method-sub">3.2. Sụt giảm tối đa, trung bình, lâu nhất</h4>
        <p>
          Cả ba chỉ số dưới đây đều tính trên chuỗi drawdown TWRR, tức là mức sụt giảm
          của bản thân quỹ, không phải mức sụt giảm bạn thực sự nhìn thấy trên số dư tài
          khoản (xem lại mục 3.1 để biết vì sao 2 con số này khác nhau).
        </p>
        <ul className="method-list">
          <li>
            <strong>Sụt giảm tối đa:</strong> đợt sụt giảm có mức độ sâu nhất của chuỗi,
            tính từ đỉnh cũ xuống đáy sâu nhất từng chạm tới.
          </li>
          <li>
            <strong>Sụt giảm trung bình:</strong> lấy trung bình mức sụt giảm của tất cả
            các ngày trong kỳ (ngày đang ở đỉnh thì tính 0%). Con số này cho biết mức
            "chìm dưới đỉnh" bạn thường gặp, không chỉ riêng lần tệ nhất.
          </li>
          <li>
            <strong>Dưới đỉnh lâu nhất:</strong> đợt dài nhất tính từ ngày lập đỉnh tới
            ngày quỹ vượt lại đúng đỉnh đó. Đợt nào chưa hồi phục thì vẫn tính tới ngày dữ
            liệu gần nhất.
          </li>
        </ul>
        <SeenAt>các cột "Sụt giảm tối đa / TB / Dưới đỉnh lâu nhất" trong Bảng thống kê, và bảng "Các đợt sụt giảm lớn nhất".</SeenAt>

        <h4 className="method-sub">3.3. Biến động (độ lệch chuẩn quy năm)</h4>
        <p>
          Đo mức dao động của lợi nhuận. Con số càng cao thì hành trình càng "xóc".
        </p>
        <Formula>Biến động = Độ lệch chuẩn của lợi nhuận từng phiên × √(số phiên/năm)</Formula>
        <Where>
          số phiên/năm được suy ra từ mật độ dữ liệu thực tế (tổng số điểm chia cho tổng
          số năm), <strong>không cố định 252</strong>. Nếu để cố định 252, các tài sản
          giao dịch cả cuối tuần như Bitcoin (khoảng 365 phiên/năm) sẽ bị tính sai, thấp
          hơn thực tế. Suy ra từ mật độ thật nên đúng dù dữ liệu là quỹ mở, ETF hay Bitcoin.
        </Where>
        <SeenAt>cột "Biến động" trong Bảng thống kê.</SeenAt>

        <h4 className="method-sub">3.4. Profit Factor</h4>
        <p>Câu hỏi: gộp tất cả các phiên lại, tổng lời so với tổng lỗ là bao nhiêu?</p>
        <Formula>Profit Factor = Σ(lợi nhuận các phiên tăng) / |Σ(lỗ các phiên giảm)|</Formula>
        <p>
          Lớn hơn 1 nghĩa là tổng lời nhiều hơn tổng lỗ. Ví dụ 1,5 lần nghĩa là cứ 1 đồng
          lỗ thì có 1,5 đồng lời bù lại. Tính trên lợi nhuận TWRR theo từng phiên.
        </p>
        <SeenAt>cột "Profit Factor" trong Bảng thống kê.</SeenAt>
      </Section>

      {/* ─────────────────────────── 4. HÀNH VI ─────────────────────────── */}
      <Section id="m-behavior" title="4. Các kịch bản hành vi">
        <h4 className="method-sub">4.1. Hoảng loạn dừng nạp, và "chi phí cơ hội"</h4>
        <p>
          Kịch bản này chạy lại đúng danh mục đó, nhưng mỗi khi quỹ giảm quá một ngưỡng
          (ví dụ −15% hoặc −25% so với đỉnh), giả định bạn sợ và bỏ nạp kỳ đó. Số tiền bỏ
          nạp coi như giữ làm tiền mặt, không sinh lời cũng không mất.
        </p>
        <p>
          So sánh không thể lấy thẳng giá trị cuối, vì kịch bản panic bỏ nạp nên tổng vốn
          ít hơn hẳn. Nếu so thẳng thì chênh lệch bị thổi phồng bởi phần "chưa đầu tư",
          chứ không phải do đầu tư kém. Nên dashboard cộng lại phần tiền mặt bỏ nạp trước
          khi so:
        </p>
        <Formula>
          Chi phí cơ hội = Giá trị (đầu tư đều đặn) − [ Giá trị (panic) + Tiền mặt đã bỏ nạp ]
        </Formula>
        <p>
          Nhờ vậy con số này là thiệt hại thực do mua sai thời điểm và mất lãi kép, tách
          khỏi việc đơn giản là có ít vốn hơn. Lý do panic thường thua: những lần nạp giữa
          lúc giảm sâu là những lần mua được giá rẻ nhất, và khi hồi phục chính các đơn vị
          đó sinh lãi nhiều nhất.
        </p>
        <SeenAt>bảng và biểu đồ "Nếu bạn hoảng loạn dừng đầu tư khi thấy đỏ?".</SeenAt>

        <h4 className="method-sub">4.2. Tăng tiền khi thấy đỏ</h4>
        <p>
          Đảo ngược kịch bản trên: mỗi khi quỹ giảm quá ngưỡng, giả định bạn chủ động nạp
          thêm một khoản, tức mua thêm khi giá rẻ. Vì cách này đầu tư <em>nhiều</em> vốn
          hơn (khác với panic đầu tư ít vốn hơn), bảng không có cột "chi phí cơ hội".
        </p>
        <p>
          Ở đây thước đo công bằng nhất là <strong>MWRR</strong>, không phải "% lợi nhuận"
          thô. Vì "% lợi nhuận" tính trên mỗi đồng đã đầu tư nhưng không phân biệt tiền vào
          sớm hay muộn, còn MWRR tính đúng số năm mỗi đồng đã có để sinh lời. Cùng lịch nạp
          khác nhau thì phải so bằng MWRR mới không bị lệch.
        </p>
        <SeenAt>bảng "Ngược lại, nếu bạn tăng tiền khi thấy đỏ?".</SeenAt>

        <h4 className="method-sub">4.3. Rolling returns: bạn đang nằm ở đâu?</h4>
        <p>
          Câu hỏi: nếu rất nhiều người cùng mua quỹ này nhưng mỗi người bắt đầu ở một
          tháng khác nhau và giữ đúng N năm, kết quả của bạn nằm ở đâu trong đám đông đó?
        </p>
        <p>
          Dashboard lấy tất cả các cửa sổ N năm liên tiếp trong lịch sử, tính CAGR (kiểu
          TWRR) cho từng cửa sổ, dựng thành một phân phối. Sau đó tính CAGR của <strong>
          đúng N năm gần nhất</strong> của bạn và đặt vào phân phối đó để ra thứ hạng
          (percentile).
        </p>
        <Where>
          Điểm mấu chốt: CAGR của bạn phải tính bằng <strong>cùng công thức và cùng độ dài
          cửa sổ</strong> N năm với phân phối đem so. Nếu lấy CAGR toàn kỳ đem so với phân
          phối cửa sổ N năm thì là so hai thứ khác nhau, ra thứ hạng vô nghĩa.
        </Where>
        <SeenAt>mục "Nếu bạn bắt đầu ở thời điểm khác thì sao?" với biểu đồ phân phối và câu "CAGR thực tế của bạn... nằm ở đâu".</SeenAt>

        <h4 className="method-sub">4.4. Cùng 100 triệu, vào ở thời điểm khác nhau</h4>
        <p>
          Đây là phiên bản tiền thật ngày thật của câu hỏi "vào sớm hay muộn khác nhau thế
          nào". Với mỗi mốc (10 năm, 5 năm, 3 năm, 1 năm, 6 tháng trước), giả định mua một
          lần 100 triệu tại NAV lúc đó rồi giữ đến nay:
        </p>
        <Formula>Giá trị hôm nay = 100 triệu × (NAV hôm nay / NAV lúc vào)</Formula>
        <p>
          NAV đã điều chỉnh cổ tức, nên con số này đã gồm cả phần cổ tức tái đầu tư. Không
          phải phân phối xác suất, mà là con số cụ thể bạn sẽ thấy trong tài khoản.
        </p>
        <SeenAt>bảng "Cùng 100 triệu, vào ở thời điểm khác nhau".</SeenAt>
      </Section>

      {/* ─────────────────────────── 5. TƯƠNG LAI ─────────────────────────── */}
      <Section id="m-future" title="5. Dự phóng tương lai (Endgame)">
        <h4 className="method-sub">5.1. Dự phóng bằng CAGR của chính tài sản</h4>
        <p>
          Phần Endgame chiếu tương lai bằng cách giả định bạn tiếp tục nạp đều đặn và danh
          mục sinh lời với một mức lãi kép nền. Mức nền đó dùng <strong>CAGR kiểu TWRR của
          chính tài sản</strong>, tức lấy tăng trưởng TWRR của quỹ quy về mỗi năm theo thời
          gian lịch thật:
        </p>
        <Formula>CAGR tài sản = (1 + tăng trưởng TWRR toàn kỳ)<sup>1 / số năm</sup> − 1</Formula>
        <p>
          Điểm quan trọng: dự phóng <strong>không</strong> dùng "giá trị cuối chia tổng đã
          đầu tư", vì con số đó bị kéo thấp một cách giả tạo do phần lớn vốn DCA chỉ mới
          nạp gần đây, chưa kịp sinh lời. Lấy nó làm mức nền chiếu tương lai sẽ ra dự phóng
          thấp sai. Dùng CAGR của bản thân tài sản mới phản ánh đúng khả năng sinh lời dài
          hạn của quỹ.
        </p>
        <p>
          Đây không phải dự báo. Không ai biết trước thị trường. Đó chỉ là phép ngoại suy
          "nếu tương lai lặp lại mức sinh lời trung bình của quá khứ".
        </p>
        <SeenAt>phần "Endgame" với biểu đồ dự phóng tương lai.</SeenAt>

        <h4 className="method-sub">5.2. Monte Carlo</h4>
        <p>
          Thay vì chỉ một đường dự phóng theo mức trung bình, Monte Carlo vẽ ra hàng nghìn
          tương lai có thể xảy ra, để thấy dải kết quả rộng cỡ nào.
        </p>
        <p>
          Cách làm là lấy lịch sử lợi nhuận theo tháng của quỹ, cắt thành các khối 12
          tháng liên tiếp (giữ nguyên thứ tự bên trong khối), rồi xáo trộn ngẫu nhiên các
          khối và nối lại thành một tương lai. Lặp lại 1000 lần, mỗi lần vẫn nạp tiền đều
          theo lịch DCA của bạn.
        </p>
        <p>
          Kết quả cho ra dải phân phối (các mức p10, p25, p50, p75, p90) theo từng tháng.
          Vì lấy mẫu từ chính lịch sử thật của quỹ, dải này đã bao gồm cả những giai đoạn
          xấu như bear 2018-2019 hay COVID 3/2020.
        </p>
        <SeenAt>biểu đồ Monte Carlo trong phần "Endgame".</SeenAt>
      </Section>

      <footer className="method-footer">
        <p>
          Mọi công thức ở trang này phản ánh đúng code đang chạy. Nếu bạn thấy một con số
          nào chưa được giải thích, hoặc nghi ngờ một chỗ tính sai, cứ phản hồi.
        </p>
        <p>Dữ liệu từ fmarket.vn &amp; vnstock. Cập nhật hàng ngày.</p>
      </footer>
    </div>
  )
}

export const MethodologyPanel = memo(MethodologyPanelImpl)
