import { memo } from 'react'
import type { SincePeakRow } from '../utils/lsVsDca'
import { MIN_DRAWDOWN_EPISODES, MIN_DRAWDOWN_FOR_SINCE_PEAK, dcaEndingForNarrative } from '../utils/lsVsDca'
import { formatVND } from '../utils/vndFormat'

interface Props {
  rows: SincePeakRow[]
  totalCapital: number
  dcaMonths: number
}

/** "2015-01-14" thành "01/2015". */
function fmtMonth(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(0, 4)}`
}

function pct(v: number, digits = 0): string {
  const s = v >= 0 ? '+' : ''
  return `${s}${(v * 100).toFixed(digits)}%`
}

/**
 * Kết quả tách theo số tháng đã trôi qua kể từ đỉnh, thay vì theo mức giảm.
 *
 * Khối này ra đời sau khi đo lại khối chia theo mức giảm và phát hiện mức giảm
 * là biến yếu: cùng dải "giảm 50 tới 60%" của Bitcoin, vào lệnh 2 tháng sau
 * đỉnh thì một năm sau lỗ 61%, vào lệnh 29 tháng sau đỉnh thì lãi 430%. Thứ
 * tách hai kết quả đó ra là bear đã chạy được bao lâu, không phải giá đã rơi
 * bao sâu.
 *
 * Quy luật này lặp lại ở cả bốn quỹ đã thử, không riêng Bitcoin.
 */
function SincePeakChartImpl({ rows, totalCapital, dcaMonths }: Props) {
  const filled = rows.filter(r => r.scenarios > 0)
  if (filled.length === 0) return null

  const maxAbs = Math.max(...filled.map(r => Math.abs(r.medianCostOfCapital ?? 0)), 0.01)

  // Hai đầu của bảng, dùng làm ví dụ trong phần chữ. Lấy từ chính dữ liệu đang
  // hiện chứ không viết cứng, để đổi quỹ thì câu chữ đổi theo.
  const early = filled[0]!
  const late = filled[filled.length - 1]!
  const swings = early.lsLossRate !== null && late.lsLossRate !== null
    && early.lsLossRate - late.lsLossRate > 0.2

  return (
    <div className="perf-table-container">
      <div className="chart-header">
        <h3>Thời gian sau khi tạo đỉnh có tác động thế nào?</h3>
        <span
          className="chart-tooltip-icon"
          title="Chỉ tính những lần vào lệnh khi giá đã rời đỉnh ít nhất 20%. Đỉnh là mức cao nhất tính tới đúng ngày đó, không phải đỉnh của cả chuỗi."
        >?</span>
      </div>

      <p className="holdcost-intro">
        Biểu đồ bên trên diễn giải giá đã giảm tới mức độ nào. Còn biểu đồ này diễn giải
        thời gian sau khi tạo đỉnh có tác động đến hiệu suất của danh mục trong tương lai
        không. Vẫn cùng bộ kịch bản, vẫn rải đều {dcaMonths} tháng, chỉ đổi cách xếp nhóm.
      </p>

      <p className="holdcost-mode-note">
        Chỉ tính những lần vào lệnh khi giá đã rời đỉnh ít nhất{' '}
        {Math.abs(MIN_DRAWDOWN_FOR_SINCE_PEAK * 100)}%, tức thị trường đang thật sự đi xuống
        chứ không phải rung lắc quanh đỉnh. Mỗi dòng ghi kèm tháng bắt đầu của từng giai
        đoạn, đếm theo đúng quy tắc của khối trên: hai giai đoạn không dùng chung ngày nào.
      </p>

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
                ? 'Chưa từng có lần nào rơi vào nhóm này'
                : r.medianLsGrowth !== null && r.medianCostOfCapital !== null
                  ? `${r.label} sau đỉnh: đầu tư một lần về đích ${formatVND(r.medianLsGrowth * totalCapital)}, DCA về đích ${formatVND(dcaEndingForNarrative(r.medianLsGrowth, r.medianCostOfCapital) * totalCapital)}.`
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
                  ? <span className="holdcost-na">chưa từng xảy ra</span>
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
                      <span className="holdcost-indep ddbucket-market">
                        Thị trường: về đích {pct(r.medianLsGrowth! - 1)},{' '}
                        {(r.lsLossRate! * 100).toFixed(0)}% số lần vẫn đang lỗ
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
          Ban đầu, chúng ta dễ lầm tưởng "giá giảm sâu thế nào" là yếu tố quyết định. Tuy
          nhiên, dữ liệu cho thấy cùng một mức giảm 50-60% của Bitcoin, kết quả sau một năm
          có thể chênh lệch cực lớn: có lần lỗ 61%, nhưng có lần lại lãi tới 430%. Điều tạo
          ra sự khác biệt này chính là khoảng thời gian tính từ đỉnh gần nhất.
        </p>
        <p>
          Lịch sử cho thấy một thị trường gấu (bear market) của Bitcoin thường kéo dài 12-13
          tháng. Nếu giá giảm 50% chỉ 2 tháng sau đỉnh, đà suy giảm có thể vẫn còn kéo dài.
          Ngược lại, nếu giá giảm 50% khi đỉnh đã qua 15 tháng, phần lớn nhịp điều chỉnh có
          thể đã kết thúc.
        </p>
        <p className="sincepeak-sub">Cách đọc hiểu bảng dữ liệu</p>
        {swings && (
          <ul className="sincepeak-list">
            <li>
              <strong>Xác suất rủi ro:</strong> Nếu vào lệnh khi đỉnh vừa đi qua{' '}
              {early.label.toLowerCase()}, tỷ lệ lỗ sau 1 năm lên tới{' '}
              <strong>{(early.lsLossRate! * 100).toFixed(0)}%</strong>. Nếu chờ đỉnh qua{' '}
              {late.label.toLowerCase()}, xác suất rủi ro này giảm về mức{' '}
              <strong>{(late.lsLossRate! * 100).toFixed(0)}%</strong>.
            </li>
          </ul>
        )}
        <p>
          <strong>Chiến lược rải vốn (DCA):</strong> Hiệu quả rải vốn phụ thuộc vào vị trí
          của bạn trong chu kỳ.
        </p>
        <ul className="sincepeak-list">
          <li>
            <strong>Mua sát đỉnh:</strong> Rải vốn giúp tối ưu giá vì thị trường còn giảm
            tiếp, giúp bạn "đỡ đau" hơn.
          </li>
          <li>
            <strong>Mua khi đỉnh đã qua lâu:</strong> Rải vốn lúc này lại làm giảm hiệu
            suất. Thị trường thường đã bước vào pha phục hồi, việc để tiền mặt nằm chờ sẽ
            khiến bạn lỡ mất đợt sóng tăng trưởng (thể hiện rõ qua cột "LS thắng" tăng dần).
          </li>
        </ul>
        <p>
          <strong>Bảng này không nói khi nào nên vào lệnh.</strong> Bạn không biết đỉnh ở đâu
          cho tới khi nó qua lâu rồi, và không biết bear lần này dài bằng mấy lần trước hay
          không. Bảng chỉ kể lại mấy chu kỳ đã đi qua.
        </p>
      </div>
    </div>
  )
}

export const SincePeakChart = memo(SincePeakChartImpl)
