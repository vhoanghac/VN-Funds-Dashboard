import { memo, useMemo, useState, Fragment, type ReactNode } from 'react'
import type { PricePoint } from '../types'
import {
  buildPeriods, periodStat, groupByYearInTerm,
  type CycleMode,
} from '../utils/cycleReturns'

interface Props {
  btc: PricePoint[]
  base: PricePoint[]
  baseName: string
}

const YEAR_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: 'Năm 1 của nhiệm kỳ',
  2: 'Năm 2 của nhiệm kỳ',
  3: 'Năm 3 của nhiệm kỳ',
  4: 'Năm 4 của nhiệm kỳ',
}

/**
 * Lợi nhuận xếp theo năm thứ mấy trong nhiệm kỳ tổng thống Mỹ.
 *
 * Đây KHÔNG phải công cụ dự báo. Mẫu chỉ có hai nhiệm kỳ rưỡi, và ba cách giải
 * thích khác nhau (bầu cử giữa kỳ, Fed siết tiền, chu kỳ halving) đều trùng pha
 * nhau nên không tách được. Bảng bày ra đúng những gì đã xảy ra, kèm đủ thứ để
 * người đọc tự thấy nó mỏng tới đâu: số lần quan sát, cột halving, và một nút
 * đổi khung đo cho thấy con số nhảy khi cắt thời gian theo cách khác.
 */
function BitcoinCycleTableImpl({ btc, base, baseName }: Props) {
  const [mode, setMode] = useState<CycleMode>('term')

  const rows = useMemo(() => {
    if (btc.length === 0) return []
    const dataStart = btc[0]!.date
    const dataEnd = btc[btc.length - 1]!.date
    return buildPeriods(mode, dataStart, dataEnd).map(period => ({
      period,
      btc: periodStat(btc, period),
      base: periodStat(base, period),
    }))
  }, [btc, base, mode])

  const grouped = useMemo(() => {
    const map = groupByYearInTerm(rows.map(r => r.period))
    const byId = new Map(rows.map(r => [r.period.id, r]))
    return ([1, 2, 3, 4] as const)
      .map(year => ({
        year,
        periods: (map.get(year) ?? []).map(p => byId.get(p.id)!),
      }))
      .filter(g => g.periods.length > 0)
  }, [rows])

  if (rows.length === 0) return null

  return (
    <div className="chart-container cycle-table-card">
      <div className="chart-header">
        <h3>Lợi nhuận theo năm nhiệm kỳ tổng thống Mỹ</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className={`log-scale-btn${mode === 'term' ? ' log-scale-btn-active' : ''}`}
            onClick={() => setMode('term')}
            title="Cắt theo nhiệm kỳ: mỗi năm tính từ ngày nhậm chức 20/1 tới 20/1 năm sau."
          >
            Theo nhiệm kỳ
          </button>
          <button
            className={`log-scale-btn${mode === 'election' ? ' log-scale-btn-active' : ''}`}
            onClick={() => setMode('election')}
            title="Cắt theo kỳ bầu cử: mỗi năm tính từ ngày bầu cử đầu tháng 11. Khung này tách đợt tăng sau bầu cử ra khỏi năm 4 của người tiền nhiệm."
          >
            Theo kỳ bầu cử
          </button>
          <button
            className={`log-scale-btn${mode === 'calendar' ? ' log-scale-btn-active' : ''}`}
            onClick={() => setMode('calendar')}
            title="Cắt theo năm dương lịch: mỗi năm tính từ 1/1 tới 31/12."
          >
            Năm dương lịch
          </button>
          <span
            className="chart-tooltip-icon"
            title="Bấm qua lại ba nút để thấy cùng một chuỗi giá cho ra con số khác nhau khi cắt thời gian theo cách khác. Mốc 1/1 không có ý nghĩa gì với thị trường, nó chỉ là thói quen kế toán."
          >?</span>
        </div>
      </div>

      <p className="cycle-table-intro">
        {mode === 'term' && 'Mỗi năm đo từ ngày nhậm chức 20/1 tới 20/1 năm sau.'}
        {mode === 'election' && 'Mỗi năm đo từ ngày bầu cử đầu tháng 11 tới ngày này năm sau, năm cuối khép lại đúng kỳ bầu cử kế tiếp.'}
        {mode === 'calendar' && 'Mỗi năm đo từ 1/1 tới 31/12, không liên quan tới ngày nhậm chức.'}
        {' '}Cột "mức giảm từ đỉnh" là phần rơi từ đỉnh cao nhất trong kỳ xuống mức cuối kỳ.
      </p>

      <div className="cycle-table-wrap">
        <table className="cycle-table">
          <thead>
            <tr>
              <th>Kỳ</th>
              <th className="num">Bitcoin</th>
              <th className="num">{baseName}</th>
              <th className="num">Mức BTC giảm từ đỉnh</th>
              <th>Halving</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ year, periods }) => {
              const done = periods.filter(p => p.period.complete).length
              const running = periods.filter(p => p.period.partial === 'unfinished').length
              const short = periods.filter(p => p.period.partial === 'truncated').length
              return (
                <Fragment key={year}>
                  <tr className="cycle-table-group">
                    <td colSpan={5}>
                      {YEAR_LABEL[year]}
                      <span className="cycle-table-count">
                        {done} lần quan sát trọn vẹn
                        {running > 0 && `, ${running} kỳ đang chạy`}
                        {short > 0 && `, ${short} kỳ thiếu dữ liệu đầu`}
                      </span>
                    </td>
                  </tr>
                  {periods.map(({ period, btc: b, base: v }) => (
                    <tr key={period.id}>
                      <td>
                        <span className="cycle-table-term">{period.president}</span>
                        <span className="cycle-table-years">{period.label}</span>
                        {period.partial === 'unfinished' && (
                          <span className="cycle-table-partial">đang chạy</span>
                        )}
                        {period.partial === 'truncated' && (
                          <span
                            className="cycle-table-partial"
                            title={`Kỳ này đã kết thúc từ lâu, nhưng dữ liệu giá chỉ bắt đầu từ ${btc[0]?.date ?? ''} nên đoạn đầu kỳ bị thiếu. Con số đo từ ngày có dữ liệu đầu tiên.`}
                          >thiếu dữ liệu đầu kỳ</span>
                        )}
                      </td>
                      <td className="num">{pct(b.close)}</td>
                      <td className="num">{pct(v.close)}</td>
                      <td className="num">{pct(b.giveback)}</td>
                      <td>{period.hasHalving ? <span className="cycle-table-halving">có</span> : ''}</td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="cycle-table-note">
        <p>
          <strong>Bảng này không dự báo được gì.</strong> Mẫu chỉ có hai nhiệm kỳ trọn vẹn
          cộng một nhiệm kỳ đang chạy. Với chừng đó quan sát thì quy luật nào cũng vẽ ra
          được, và quy luật nào cũng có thể bị phá vỡ ở lần sau.
        </p>
        <p>
          <strong>Chọn mốc cắt nào là đã chọn một câu trả lời.</strong> Ngày nhậm chức
          20/1 do Hiến pháp Mỹ ấn định, nhưng lấy nó làm ranh giới thì cả giai đoạn từ
          đầu tháng 11 tới 20/1, tức lúc thị trường đang phản ứng với người sắp lên,
          lại bị tính vào năm 4 của người sắp mãn nhiệm. Bấm nút "theo kỳ bầu cử" để
          tách đoạn đó ra và xem quy luật năm 4 co lại bao nhiêu.
        </p>
        <p>
          Riêng năm 2 của nhiệm kỳ, cả Bitcoin lẫn {baseName} đều âm ở mọi lần quan sát.
          Nhưng {baseName} thì không có lý do gì phải phản ứng với bầu cử giữa kỳ Mỹ.
          Điều đó gợi ý nguyên nhân nằm ở chỗ khác. Có ít nhất ba thứ trùng pha nhau
          trong khoảng dữ liệu này: bầu cử giữa kỳ, các đợt Fed siết tiền (2018 và 2022),
          và chu kỳ halving Bitcoin. Nhìn cột halving thì thấy năm 4 của nhiệm kỳ nào
          cũng trùng một kỳ halving. Không có cách nào tách ba thứ đó ra khỏi nhau bằng
          dữ liệu hiện có.
        </p>
      </div>
    </div>
  )
}

export const BitcoinCycleTable = memo(BitcoinCycleTableImpl)

function pct(v: number | null): ReactNode {
  if (v === null) return '–'
  const cls = v > 0 ? 'cycle-pos' : v < 0 ? 'cycle-neg' : ''
  return <span className={cls}>{v > 0 ? '+' : ''}{v.toFixed(1)}%</span>
}
