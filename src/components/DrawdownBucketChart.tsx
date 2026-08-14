import { memo, useState } from 'react'
import type { DrawdownBucketRow } from '../utils/lsVsDca'
import { MIN_DRAWDOWN_EPISODES, dcaEndingForNarrative } from '../utils/lsVsDca'
import { formatVND } from '../utils/vndFormat'

/** "2015-01-14" thành "01/2015". */
function fmtMonth(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(0, 4)}`
}

/** Một kiểu chọn ngày bán, kèm mốc so sánh tính trên đúng kỳ nắm giữ đó. */
export interface DrawdownBucketView {
  rows: DrawdownBucketRow[]
  /** Tỷ lệ LS thắng tính trên mọi tháng, làm mốc so sánh. */
  baselineWinRate: number
  /** Chênh lệch trung vị trên mọi tháng, theo tỷ lệ vốn. Âm là DCA về ít tiền hơn. */
  baselineCostOfCapital: number
  totalScenarios: number
  /** Số tháng giữ thêm sau khi rải xong. 0 là bán ngay. */
  extraMonths: number
}

interface Props {
  /** Các kỳ nắm giữ cho chọn, sắp theo thứ tự giữ càng lâu càng về sau. */
  views: DrawdownBucketView[]
  totalCapital: number
  dcaMonths: number
}

/** Nhãn nút, suy từ số tháng giữ thêm nên thêm mốc mới không phải sửa gì ở đây. */
function modeLabel(extraMonths: number): string {
  if (extraMonths <= 0) return 'Bán ngay khi rải xong'
  const years = extraMonths / 12
  return `Giữ thêm ${years === 1 ? '1 năm' : `${years} năm`} rồi bán`
}

/**
 * Vào lệnh lúc thị trường đã giảm sâu thì kết quả khác gì lúc bình thường.
 *
 * Mọi khối khác trong tab đều gộp chung mọi thời điểm bắt đầu. Khối này tách
 * theo trạng thái thị trường lúc vào lệnh, đo bằng mức giảm so với đỉnh cao
 * nhất TÍNH TỚI đúng ngày đó.
 *
 * Đây là khối dễ làm người đọc tự tin sai nhất trong cả tab, nên lớp trung
 * thực ở đây nặng tay hơn mọi chỗ khác. Lý do: các dải sâu gom toàn bộ kịch
 * bản vào đúng vài cú sập. Bitcoin giảm quá 60% có 735 kịch bản, nghe như một
 * quy luật, thực chất là 3 lần. Vì vậy cột đáng đọc không phải số kịch bản mà
 * là số giai đoạn.
 */
function DrawdownBucketChartImpl({ views, totalCapital, dcaMonths }: Props) {
  const [modeIdx, setModeIdx] = useState(0)
  const view = views[Math.min(modeIdx, views.length - 1)] ?? views[0]!
  const { rows, baselineWinRate, baselineCostOfCapital, totalScenarios } = view

  const filled = rows.filter(r => r.scenarios > 0)
  if (filled.length === 0) return null

  const deep = filled.filter(r => r.to <= -0.3)
  const solid = filled.filter(r => r.episodes >= MIN_DRAWDOWN_EPISODES)
  const deepest = deep[deep.length - 1]

  // Thang đo chung cho mọi thanh, để so chiều dài giữa các dòng có nghĩa.
  const maxAbs = Math.max(
    ...filled.map(r => Math.abs(r.medianCostOfCapital ?? 0)),
    Math.abs(baselineCostOfCapital),
    0.01,
  )

  return (
    <div className="perf-table-container">
      <div className="chart-header">
        <h3>Vào lệnh lúc thị trường đã giảm sâu thì sao?</h3>
        <span
          className="chart-tooltip-icon"
          title="Mức giảm đo so với đỉnh cao nhất tính tới đúng ngày bắt đầu, không phải đỉnh của cả chuỗi. Ngày 1/2015 không thể biết đỉnh 2021 nằm ở đâu."
        >?</span>
      </div>

      <p className="holdcost-intro">
        Mấy khối trên gộp chung mọi thời điểm bắt đầu, lúc thị trường đang đỉnh cũng như lúc
        đang sập. Khối này tách riêng ra: nếu bạn vào lệnh đúng lúc giá đã rơi khỏi đỉnh một
        quãng, thì đầu tư một lần và DCA khác nhau thế nào. Vẫn rải đều{' '}
        <strong>{dcaMonths} tháng</strong> như các khối khác.
      </p>

      <div className="holdcost-modes">
        <span className="holdcost-modes-label">Bán khi nào</span>
        {views.map((v, i) => (
          <button
            key={v.extraMonths}
            className={`lsdca-horizon-btn ${i === modeIdx ? 'lsdca-horizon-btn-active' : ''}`}
            onClick={() => setModeIdx(i)}
            title={v.extraMonths <= 0
              ? `Rải xong ${dcaMonths} tháng là bán luôn`
              : `Rải xong ${dcaMonths} tháng rồi giữ thêm ${v.extraMonths / 12} năm nữa mới bán`}
          >
            {modeLabel(v.extraMonths)}
          </button>
        ))}
      </div>

      <p className="holdcost-mode-note">
        {view.extraMonths > 0
          ? <>Rải đều {dcaMonths} tháng, giữ tiếp thêm {view.extraMonths / 12} năm nữa rồi mới
            bán, tổng cộng {dcaMonths + view.extraMonths} tháng kể từ ngày vào lệnh. Giữ lâu hơn
            thì cần nhiều dữ liệu tương lai hơn, nên số kịch bản ở mỗi dải ít đi so với chế độ
            bán ngay.</>
          : <>Rải đều {dcaMonths} tháng rồi bán luôn, không giữ thêm ngày nào. Đây là cách
            tính dùng chung với khối tóm tắt và histogram bên trên.</>}
      </p>

      <div className="ddbucket-baseline">
        <span className="ddbucket-baseline-label">Mốc so sánh, tính trên cả {totalScenarios.toLocaleString('vi-VN')} kịch bản</span>
        <span className="ddbucket-baseline-value">
          Đầu tư một lần thắng <strong>{(baselineWinRate * 100).toFixed(0)}%</strong>
          {' · '}
          chênh trung vị{' '}
          <strong className={baselineCostOfCapital < 0 ? 'cycle-neg' : 'cycle-pos'}>
            {baselineCostOfCapital < 0 ? '−' : '+'}{formatVND(Math.abs(baselineCostOfCapital * totalCapital))}
          </strong>
        </span>
      </div>

      <div className="holdcost-rows ddbucket-rows">
        {rows.map(r => {
          const thin = r.episodes < MIN_DRAWDOWN_EPISODES
          const empty = r.scenarios === 0
          const cost = r.medianCostOfCapital
          return (
            <div
              key={r.label}
              className="holdcost-row"
              title={empty
                ? 'Quỹ này chưa từng giảm tới mức đó'
                : r.medianLsGrowth !== null && r.medianCostOfCapital !== null
                  ? `${r.label}: đầu tư một lần về đích ${formatVND(r.medianLsGrowth * totalCapital)}, DCA về đích ${formatVND(dcaEndingForNarrative(r.medianLsGrowth, r.medianCostOfCapital) * totalCapital)}.`
                  : undefined}
            >
              <div className="holdcost-label ddbucket-label">
                <span className="ddbucket-band">{r.label}</span>
                {r.episodeStarts.length > 0 && (
                  <span className="ddbucket-dates">
                    {r.episodeStarts.map(fmtMonth).join(' · ')}
                  </span>
                )}
              </div>
              <div className="holdcost-track">
                <div className="holdcost-zero" />
                {cost !== null && (
                  <div
                    className={`holdcost-bar ${cost < 0 ? 'holdcost-bar--neg' : 'holdcost-bar--pos'}${thin ? ' holdcost-bar--thin' : ''}`}
                    style={{
                      width: `${Math.abs(cost) / maxAbs * 48}%`,
                      [cost < 0 ? 'right' : 'left']: '50%',
                    }}
                  />
                )}
              </div>
              <div className="holdcost-value">
                {empty
                  ? <span className="holdcost-na">chưa từng giảm tới mức này</span>
                  : <>
                      <span className={cost! < 0 ? 'cycle-neg' : 'cycle-pos'}>
                        {cost! < 0 ? '−' : '+'}{formatVND(Math.abs(cost! * totalCapital))}
                      </span>
                      <span className="holdcost-indep">
                        {(r.lsWinRate! * 100).toFixed(0)}% LS thắng
                        {' · '}
                        {r.scenarios} kịch bản
                        {' · '}
                        {thin && '⚠ '}{r.episodes} giai đoạn
                      </span>
                    </>
                }
              </div>
            </div>
          )
        })}
      </div>

      <p className="holdcost-axis-caption">
        Trái vạch giữa: DCA về đích ít tiền hơn. Phải: DCA về đích nhiều hơn.
      </p>

      <div className="holdcost-note">
        <p>
          Để minh bạch số liệu, dưới mỗi dải giảm giá đều ghi rõ các tháng bắt đầu của từng
          giai đoạn để bạn dễ dàng kiểm chứng.
        </p>
        <p>
          Cách tính rất đơn giản: Chọn tháng sớm nhất làm mốc, sau đó bỏ qua toàn bộ các
          tháng nằm trong chu kỳ nắm giữ{' '}
          {view.extraMonths > 0 ? dcaMonths + view.extraMonths : dcaMonths} tháng tiếp theo.
          Tháng đầu tiên xuất hiện sau chu kỳ đó sẽ được chọn làm mốc mới, và cứ thế tiếp tục.
        </p>
        <p>
          Bằng cách này, các giai đoạn sẽ hoàn toàn tách biệt về mặt thời gian. Điều này
          giải thích vì sao số lượng giai đoạn luôn nhỏ hơn rất nhiều so với tổng số kịch
          bản.{deepest && deepest.scenarios > 0 && (
            <> Chẳng hạn, ở mức <strong>{deepest.label.toLowerCase()}</strong>, dù có đến{' '}
            {deepest.scenarios} kịch bản nhưng thực tế chúng chỉ nằm trong{' '}
            <strong>{deepest.episodes} giai đoạn</strong> độc lập.</>)} Hàng trăm kịch bản
          kia đơn giản là do cùng một khoảng thời gian được đếm đi đếm lại.
        </p>
        <p>
          {solid.length === 0
            ? <><strong>Không dòng nào đủ để kết luận.</strong> Mọi dòng đều dựa trên dưới{' '}
              {MIN_DRAWDOWN_EPISODES} giai đoạn. Xem cho biết thị trường đã từng ra sao,
              đừng xem như quy luật.</>
            : <>Chỉ <strong>{solid.length} trên {filled.length} dòng có số liệu</strong> đạt từ{' '}
              {MIN_DRAWDOWN_EPISODES} giai đoạn trở lên. Các dòng còn lại bị làm mờ kèm dấu ⚠.</>}
          {' '}Và ngay cả dòng đạt ngưỡng cũng chỉ là vài giai đoạn, không phải vài trăm.
        </p>
        <p>
          <strong>Hai giai đoạn vẫn có thể cùng một đợt sập.</strong> Chúng không dùng chung
          ngày nào, nhưng nếu cùng nằm trong một bear market thì cùng phụ thuộc một lần hồi
          phục về sau.
        </p>
        <p>
          Hãy hình dung hai thời điểm giá cùng giảm 50 - 60%. Nếu bạn mua vào, một năm sau
          có thể bạn sẽ lỗ nặng, nhưng cũng có thể lãi gấp vài lần. Điều gì quyết định
          chuyện này? Đó là khoảng thời gian kể từ khi giá tạo đỉnh, chứ không thuần túy là
          độ sâu của nhịp giảm. Bạn có thể thấy rõ quy luật này ở khối dữ liệu bên dưới.
        </p>
        <p>
          <strong>Bảng này không nói lần sau sẽ ra sao.</strong> Nó chỉ kể lại mấy lần đã
          rồi. Thị trường giảm 50% rồi vẫn giảm tiếp 50% nữa được.
        </p>
      </div>
    </div>
  )
}

export const DrawdownBucketChart = memo(DrawdownBucketChartImpl)
