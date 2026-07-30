import { memo } from 'react'
import type { HoldingCostCell } from '../utils/lsVsDca'
import { MIN_INDEPENDENT_WINDOWS } from '../utils/lsVsDca'
import { formatVND } from '../utils/vndFormat'

interface Props {
  data: HoldingCostCell[]
  dcaMonths: number
  totalCapital: number
}

/**
 * DCA tốn bao nhiêu tiền so với đầu tư một lần, đo ở từng mốc nắm giữ.
 *
 * Heatmap bên trên trả lời "DCA thua bao nhiêu LẦN". Khối này trả lời câu khác
 * hẳn: "thua thì thua bao nhiêu TIỀN". Hai câu đó lệch nhau được, vì thắng
 * thường xuyên mà mỗi lần thắng một ít thì vẫn thua ít lần mà lần nào cũng nặng.
 *
 * Mốc nào không đủ giai đoạn tách rời thì làm mờ, không tô đậm như thể chắc chắn.
 */
function HoldingCostChartImpl({ data, dcaMonths, totalCapital }: Props) {
  const measured = data.filter(d => d.medianCost !== null)
  if (measured.length === 0) return null

  const maxAbs = Math.max(...measured.map(d => Math.abs(d.medianCost!)), 0.5)
  const solid = measured.filter(d => d.independentWindows >= MIN_INDEPENDENT_WINDOWS)

  // Lấy một mốc đủ tin cậy làm ví dụ bằng tiền thật cho câu mở đầu.
  const example = solid[0] ?? measured[0]!

  // Mốc dùng để giải thích "giai đoạn tách rời". Ưu tiên mốc dài vài năm vì ở
  // đó phần chồng lấn mới lộ rõ, mốc 1 năm thì nghe không thấy vấn đề gì.
  const overlapExample = measured.find(d => d.holdingYears >= 5) ?? measured[measured.length - 1]!
  const exYears = overlapExample.holdingYears
  const exMonths = exYears * 12

  return (
    <div className="perf-table-container" style={{ marginTop: 24 }}>
      <div className="chart-header">
        <h3>DCA tốn bao nhiêu tiền so với đầu tư một lần?</h3>
        <span
          className="chart-tooltip-icon"
          title="Với mỗi mốc nắm giữ, dashboard chạy lại toàn bộ các thời điểm bắt đầu trong lịch sử, rồi lấy con số nằm giữa. Số âm nghĩa là DCA về đích với ít tiền hơn."
        >?</span>
      </div>

      <p className="holdcost-intro">
        Bạn có <strong>{formatVND(totalCapital)}</strong>. Một bên đầu tư hết ngay hôm nay.
        Bên kia chia đều ra <strong>{dcaMonths} tháng</strong> rồi mới giữ tiếp.
        Bảng dưới cho biết sau mỗi khoảng thời gian, bên DCA về đích ít hơn hay nhiều hơn bao nhiêu tiền.
      </p>

      {example.medianLsGrowth !== null && example.medianDcaGrowth !== null && (
        <p className="holdcost-example">
          Ví dụ dòng <strong>{example.holdingYears} năm</strong>: bên đầu tư một lần
          thường về đích <strong>{formatVND(example.medianLsGrowth * totalCapital)}</strong>,
          bên DCA về đích <strong>{formatVND(example.medianDcaGrowth * totalCapital)}</strong>.
          Chênh nhau{' '}
          <strong className={example.medianCostOfCapital! < 0 ? 'cycle-neg' : 'cycle-pos'}>
            {formatVND(Math.abs(example.medianCostOfCapital! * totalCapital))}
          </strong>.
          Cả hai đều lớn hơn vốn ban đầu, con số chênh lệch là khoảng cách lúc về đích
          chứ không phải tiền bị mất.
        </p>
      )}

      <div className="holdcost-rows">
        {data.map(d => {
          const thin = d.independentWindows < MIN_INDEPENDENT_WINDOWS
          return (
            <div
              key={d.holdingYears}
              className="holdcost-row"
              title={d.medianLsGrowth !== null && d.medianDcaGrowth !== null
                ? `Giữ ${d.holdingYears} năm: đầu tư một lần về đích ${formatVND(d.medianLsGrowth * totalCapital)}, DCA về đích ${formatVND(d.medianDcaGrowth * totalCapital)}.`
                : undefined}
            >
              <div className="holdcost-label">{d.holdingYears} năm</div>
              <div className="holdcost-track">
                <div className="holdcost-zero" />
                {d.medianCost !== null && (
                  <div
                    className={`holdcost-bar ${d.medianCost < 0 ? 'holdcost-bar--neg' : 'holdcost-bar--pos'}${thin ? ' holdcost-bar--thin' : ''}`}
                    style={{
                      width: `${Math.abs(d.medianCost) / maxAbs * 48}%`,
                      [d.medianCost < 0 ? 'right' : 'left']: '50%',
                    }}
                  />
                )}
              </div>
              <div className="holdcost-value">
                {d.medianCost === null
                  ? <span className="holdcost-na">
                      {d.tooShort
                        ? `chưa DCA xong (cần hơn ${dcaMonths} tháng)`
                        : 'quỹ chưa đủ lịch sử'}
                    </span>
                  : <>
                      <span className={d.medianCost < 0 ? 'cycle-neg' : 'cycle-pos'}>
                        {d.medianCostOfCapital !== null && (
                          <>{d.medianCostOfCapital < 0 ? '−' : '+'}{formatVND(Math.abs(d.medianCostOfCapital * totalCapital))}</>
                        )}
                      </span>
                      <span className="holdcost-indep">
                        {d.medianCost > 0 ? '+' : ''}{d.medianCost.toFixed(1)}%
                        {' · '}
                        {thin && '⚠ '}{d.independentWindows} giai đoạn tách rời
                      </span>
                    </>
                }
              </div>
            </div>
          )
        })}
      </div>

      <div className="holdcost-note">
        <p>
          <strong>Vì sao DCA thường về đích ít tiền hơn.</strong> Tiền chưa đầu tư thì chưa
          sinh lời. Thị trường đi lên nhiều hơn đi xuống, nên phần tiền ngồi chờ thường lỡ
          mất đoạn tăng. Đổi lại, DCA giúp bạn tránh được kịch bản tệ nhất là đầu tư hết đúng đỉnh.
        </p>
        <p>
          <strong>"Giai đoạn tách rời" nghĩa là gì.</strong> Dashboard thử lại mọi thời điểm
          bắt đầu có trong lịch sử. Nghe thì nhiều, nhưng các lần thử đó phần lớn là cùng
          một quãng thời gian được đếm đi đếm lại.
        </p>
        <p>
          Lấy dòng <strong>{exYears} năm</strong> làm ví dụ. Một lần thử bắt đầu tháng 1, lần
          kế tiếp bắt đầu tháng 2. Cả hai cùng chạy {exYears} năm, nên chúng đi qua{' '}
          <strong>{exMonths - 1} trên {exMonths} tháng giống hệt nhau</strong>. Thị trường sập
          năm nào thì cả hai cùng dính năm đó, cùng sai một kiểu. Đếm chúng thành hai lần
          kiểm chứng là tự lừa mình.
        </p>
        <p>
          Với chuỗi giá của quỹ đang chọn, chỉ nhét vừa{' '}
          <strong>{overlapExample.independentWindows} quãng {exYears} năm không đè lên nhau</strong>.
          Đó chính là con số ghi ở cuối mỗi dòng. Nó nhỏ hơn hẳn số kịch bản, và nó mới là
          thứ quyết định con số bên cạnh đáng tin tới đâu.
        </p>
        <p>
          {solid.length === 0
            ? <><strong>Không mốc nào đủ để kết luận.</strong> Mọi con số trên đây đều dựa trên
              dưới {MIN_INDEPENDENT_WINDOWS} giai đoạn tách rời, đọc cho biết thôi.</>
            : <>Chỉ <strong>{solid.length} trên {data.length} mốc</strong> có từ {MIN_INDEPENDENT_WINDOWS} giai
              đoạn tách rời trở lên. Các mốc còn lại bị làm mờ vì quỹ chưa đủ lịch sử, không phải
              vì kết quả yếu. Muốn mốc dài có ý nghĩa thì cần quỹ ra đời sớm hơn.</>}
        </p>
      </div>
    </div>
  )
}

export const HoldingCostChart = memo(HoldingCostChartImpl)
