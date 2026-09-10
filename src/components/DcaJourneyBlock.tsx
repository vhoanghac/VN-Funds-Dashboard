/**
 * DcaJourneyBlock: hero narrative cho tab DCA.
 *
 * Single portfolio: 1 câu chuyện chi tiết với số vốn, giá trị cuối kỳ và lời ròng.
 * Multi portfolio: xếp hạng các danh mục theo giá trị cuối kỳ.
 *
 * Mental model: retail VN không quen tách net profit khỏi total value. Hero
 * phải kể: "đã đầu tư X, giờ có Y, lời ròng Z, đó bằng cái gì trong đời thực".
 */
import { Fragment, memo, type ReactNode } from 'react'
import { formatVND } from '../utils/vndFormat'
import { dcaYearlyMWRR } from '../utils/dca'
import { DcaBlock } from './DcaLayout'

export interface JourneyPortfolio {
  id: string
  name: string
  color: string
  totalInvested: number
  finalValue: number
  /** Giá trị danh mục theo thời gian (đã gồm cashflow) — dùng để tính MWRR từng năm */
  valueSeries: { date: string; value: number }[]
  /** Toàn bộ cashflows (âm = đầu tư) — dùng để tính MWRR từng năm */
  cashflows: { date: string; amount: number }[]
}

interface Props {
  portfolios: JourneyPortfolio[]
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
  details?: ReactNode
}

function DcaJourneyBlockImpl({ portfolios, startDate, endDate, details }: Props) {
  if (portfolios.length === 0) return null

  const period = describePeriod(startDate, endDate)

  // Single portfolio → full narrative
  if (portfolios.length === 1) {
    const p = portfolios[0]!
    const netProfit = p.finalValue - p.totalInvested
    const profitPct = p.totalInvested > 0 ? (netProfit / p.totalInvested) * 100 : 0
    return (
      <DcaBlock>
        <div className="dca-journey-headline">
          Trong suốt <strong>{period}</strong>, bạn đều đặn để dành một
          khoản tiền để mua <strong style={{ color: p.color }}>{p.name}</strong>.
          Tổng cộng đã đầu tư <strong>{formatVND(p.totalInvested)}</strong>.
        </div>

        <div className="dca-journey-grid">
          <div className="dca-journey-stat">
            <div className="dca-journey-stat-label">Tổng tiền đã đầu tư</div>
            <div className="dca-journey-stat-value">{formatVND(p.totalInvested)}</div>
          </div>
          <div className="dca-journey-stat dca-journey-stat--highlight">
            <div className="dca-journey-stat-label">Tổng giá trị danh mục</div>
            <div className="dca-journey-stat-value">{formatVND(p.finalValue)}</div>
          </div>
          <div className={`dca-journey-stat dca-journey-stat--${netProfit >= 0 ? 'pos' : 'neg'}`}>
            <div className="dca-journey-stat-label">Lợi nhuận</div>
            <div className="dca-journey-stat-value">
              {netProfit >= 0 ? '+' : ''}{formatVND(netProfit)}
            </div>
            <div className="dca-journey-stat-sub">
              {netProfit >= 0 ? '+' : ''}{profitPct.toFixed(1)}%
            </div>
          </div>
        </div>

        {details}
      </DcaBlock>
    )
  }

  // Multi portfolio → xếp hạng theo giá trị cuối kỳ
  const sorted = [...portfolios].sort((a, b) => b.finalValue - a.finalValue)

  return (
    <DcaBlock>
      <div className="dca-journey-headline">
        Cùng một lịch đầu tư, cùng trải qua <strong>{period}</strong>, nhưng
        {' '}<strong>{portfolios.length} danh mục</strong> lại cho kết quả rất khác nhau.
      </div>

      <div className="dca-journey-ranked">
        {sorted.map((p, idx) => {
          const netProfit = p.finalValue - p.totalInvested
          const profitPct = p.totalInvested > 0 ? (netProfit / p.totalInvested) * 100 : 0
          const rankLabel = idx === 0 ? '🥇' : idx === sorted.length - 1 && sorted.length > 2 ? '🥉' : idx === 1 ? '🥈' : ''
          return (
            <div key={p.id} className="dca-journey-card" style={{ borderLeftColor: p.color }}>
              <div className="dca-journey-card-head">
                <span className="dca-journey-card-rank">{rankLabel}</span>
                <span className="dca-journey-card-name" style={{ color: p.color }}>{p.name}</span>
              </div>
              <div className="dca-journey-card-value">{formatVND(p.finalValue)}</div>
              <div className="dca-journey-card-sub">
                Đầu tư {formatVND(p.totalInvested)}, lời
                {' '}<span className={netProfit >= 0 ? 'dca-journey-pos' : 'dca-journey-neg'}>
                  {netProfit >= 0 ? '+' : ''}{formatVND(netProfit)} ({netProfit >= 0 ? '+' : ''}{profitPct.toFixed(1)}%)
                </span>
              </div>
            </div>
          )
        })}
      </div>
      {details}

    </DcaBlock>
  )
}

export const DcaJourneyBlock = memo(DcaJourneyBlockImpl)

/**
 * EOYReturnsTable: hiệu suất DANH MỤC CỦA NHÀ ĐẦU TƯ từng năm (End-of-Year Returns),
 * tính bằng Modified Dietz method (money-weighted, có tính dòng tiền đầu tư).
 *
 * Khác với TWRR (dcaYearlyReturns, đo hiệu suất bản thân quỹ như thể đầu tư
 * 1 lần từ đầu, bất kể bạn đầu tư bao nhiêu/khi nào), Modified Dietz đo đúng
 * trải nghiệm DCA thực tế: tiền đầu tư sớm trong năm được tính trọng số cao hơn
 * (nhiều thời gian sinh lời), tiền đầu tư cuối năm gần như chưa kịp sinh lời.
 * Đây là công thức chuẩn GIPS, không cần giải lặp nên luôn ổn định dù mỗi
 * năm chỉ có ~12 lần đầu tư.
 */
function EOYReturnsTableImpl({ portfolios, assetLabel = 'quỹ' }: { portfolios: JourneyPortfolio[]; assetLabel?: string }) {
  const perPortfolio = portfolios.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    byYear: new Map(dcaYearlyMWRR(p.valueSeries, p.cashflows).map(y => [y.year, y])),
  }))

  const allYears = Array.from(
    new Set(perPortfolio.flatMap(p => Array.from(p.byYear.keys()))),
  ).sort((a, b) => a - b)

  if (allYears.length === 0) return null

  // Cột "Chênh lệch" chỉ có ý nghĩa rõ ràng khi so sánh đúng 2 danh mục (B trừ A).
  // Với 3+ danh mục, "chênh lệch với cái nào" không còn là câu hỏi có 1 đáp án.
  const showDiff = perPortfolio.length === 2

  return (
    <DcaBlock title="Hiệu suất danh mục của bạn từng năm" className="dca-eoy-block">
      <p className="dca-eoy-explainer">
        Bảng này tính hiệu suất <strong>có tính đến dòng tiền bạn thực sự đầu tư</strong>
        {' '}(Modified Dietz method), không phải hiệu suất "nếu đầu tư 1 lần từ đầu"
        của bản thân {assetLabel}. Tiền đầu tư càng sớm trong năm càng được tính trọng số cao
        (có nhiều thời gian sinh lời hơn), tiền đầu tư cuối năm gần như chưa kịp sinh
        lời. Nhờ vậy con số này phản ánh đúng trải nghiệm DCA thực tế của bạn, thay
        vì chỉ đo giá {assetLabel} tăng/giảm bao nhiêu. Cột "Giá trị" là số dư danh mục tại
        điểm cuối năm đó (đã gồm mọi lần đầu tư tính đến lúc đó).
      </p>
      <div className="dca-eoy-table-scroll">
        <table className="dca-eoy-table">
          <thead>
            <tr>
              <th rowSpan={2} className="dca-eoy-th-year">Năm</th>
              {perPortfolio.map(p => (
                <th key={p.id} colSpan={2} className="dca-eoy-group-start" style={{ color: p.color }}>{p.name}</th>
              ))}
              {showDiff && <th rowSpan={2} className="dca-eoy-group-start">Chênh lệch</th>}
            </tr>
            <tr>
              {perPortfolio.map(p => (
                <Fragment key={p.id}>
                  <th className="dca-eoy-subhead dca-eoy-group-start">Lợi nhuận</th>
                  <th className="dca-eoy-subhead">Giá trị</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {allYears.map(year => {
              const rows = perPortfolio.map(p => p.byYear.get(year))
              const diffPct = showDiff && rows[0]?.value != null && rows[1]?.value != null
                ? (rows[1]!.value! - rows[0]!.value!) * 100
                : null

              return (
                <tr key={year}>
                  <td className="dca-eoy-year">{year}</td>
                  {perPortfolio.map((p, idx) => {
                    const r = rows[idx]
                    if (!r || r.value === null) {
                      return (
                        <Fragment key={p.id}>
                          <td className="dca-eoy-cell dca-eoy-cell--empty dca-eoy-group-start">—</td>
                          <td className="dca-eoy-cell dca-eoy-cell--empty">—</td>
                        </Fragment>
                      )
                    }
                    const pct = r.value * 100
                    return (
                      <Fragment key={p.id}>
                        <td className={`dca-eoy-cell dca-eoy-group-start ${pct >= 0 ? 'dca-eoy-cell--pos' : 'dca-eoy-cell--neg'}`}>
                          {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                          {r.isPartial && <sup className="dca-eoy-partial">*</sup>}
                          {r.isOpeningYear && <sup className="dca-eoy-partial">†</sup>}
                        </td>
                        <td className="dca-eoy-cell dca-eoy-cell--balance">
                          {formatVND(r.endValue)}
                        </td>
                      </Fragment>
                    )
                  })}
                  {showDiff && (
                    <td
                      className={`dca-eoy-cell dca-eoy-group-start ${diffPct === null ? 'dca-eoy-cell--empty' : diffPct >= 0 ? 'dca-eoy-cell--pos' : 'dca-eoy-cell--neg'}`}
                    >
                      {diffPct === null ? '—' : `${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)} điểm %`}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="dca-eoy-footnote">
        * Năm chưa đủ dữ liệu trọn năm (năm đầu hoặc năm cuối của khoảng so sánh).
        {' '}† Năm đầu của tài khoản, chưa có số dư đầu năm để làm mốc so sánh trực tiếp với các năm sau.
        {showDiff && ' "Chênh lệch" = lợi nhuận danh mục thứ 2 trừ danh mục thứ 1, tính bằng điểm phần trăm.'}
      </div>
    </DcaBlock>
  )
}

export const EOYReturnsTable = memo(EOYReturnsTableImpl)

/** Mô tả khoảng thời gian: "8 năm 3 tháng", "15 tháng", "45 ngày"... */
function describePeriod(startDate: string, endDate: string): string {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const ms = end.getTime() - start.getTime()
  const days = Math.floor(ms / (24 * 3600 * 1000))
  if (days < 60) return `${days} ngày`

  const totalMonths = Math.floor(days / 30.44)
  if (totalMonths < 12) return `${totalMonths} tháng`

  const years = Math.floor(totalMonths / 12)
  const months = totalMonths - years * 12
  if (months === 0) return `${years} năm`
  return `${years} năm ${months} tháng`
}
