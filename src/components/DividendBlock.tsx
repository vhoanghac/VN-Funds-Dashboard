/**
 * DividendBlock: narrative cổ tức cho tab DCA.
 *
 * Sau khi dashboard chuyển sang adjusted NAV ở layer CSV loader, giá đã phản
 * ánh sẵn cổ tức tái đầu tư sau thuế cho toàn bộ dashboard (Compare, Simulation,
 * LS vs DCA, Bitcoin, DCA). Block này chỉ kể lại những đợt cổ tức đã thực sự
 * xảy ra trong kỳ DCA của user, để họ biết số tiền điều chỉnh đến từ đâu.
 *
 * Chỉ hiển thị khi:
 *   - Portfolio có quỹ chia cổ tức (hiện tại chỉ DCDE)
 *   - Có ít nhất 1 đợt chi trả rơi vào khoảng startDate..endDate
 */
import { memo } from 'react'
import type { DividendEvent, DividendNarrativeStats } from '../utils/dividendAdjust'
import { formatVNDFull } from '../utils/vndFormat'

export interface PortfolioDividendNarrative {
  portfolioId: string
  portfolioName: string
  color: string
  stats: DividendNarrativeStats[]
}

interface Props {
  /** Danh sách fundId xuất hiện trong bất kỳ portfolio nào của user */
  fundIds: string[]
  /** Map fundId → lịch sử cổ tức (load từ dividends.json) */
  dividendsByFund: Map<string, DividendEvent[]>
  /** Khoảng DCA thực tế của user (YYYY-MM-DD) */
  startDate: string
  endDate: string
  /**
   * Shadow simulation per portfolio trên RAW NAV. Khi có, hiển thị thêm
   * summary "tổng tiền thật, tổng ccq thật" cho từng danh mục × từng quỹ.
   */
  narrativeByPortfolio?: PortfolioDividendNarrative[]
}

function DividendBlockImpl({ fundIds, dividendsByFund, startDate, endDate, narrativeByPortfolio }: Props) {
  // Group events theo fundId, chỉ lấy những đợt ex-date rơi vào kỳ DCA
  const byFund = new Map<string, DividendEvent[]>()
  for (const fundId of fundIds) {
    const events = dividendsByFund.get(fundId)
    if (!events) continue
    const inWindow = events.filter(ev => ev.exDate >= startDate && ev.exDate <= endDate)
    if (inWindow.length > 0) {
      inWindow.sort((a, b) => a.exDate.localeCompare(b.exDate))
      byFund.set(fundId, inWindow)
    }
  }

  if (byFund.size === 0) return null

  const multiplePortfolios = (narrativeByPortfolio?.length ?? 0) > 1

  return (
    <>
      <div className="section-divider">
        <span className="section-divider-label">Cổ tức &amp; tái đầu tư</span>
      </div>
      <div className="dca-journey-block">
        <div className="dca-journey-headline">
          Trong kỳ DCA này, quỹ <strong>{Array.from(byFund.keys()).join(', ')}</strong>{' '}
          đã chi trả cổ tức. Dashboard đã điều chỉnh giá để phản ánh giả định tái đầu
          tư sau thuế TNCN, nên hiệu suất bạn thấy ở mọi biểu đồ đã bao gồm phần
          lợi nhuận từ cổ tức.
        </div>

        {Array.from(byFund.entries()).map(([fundId, evs]) => {
          // Map event → per-portfolio stats để render inline trong 1 bảng duy nhất
          const portfolioStats: { p: PortfolioDividendNarrative; s: DividendNarrativeStats }[] = []
          if (narrativeByPortfolio) {
            for (const p of narrativeByPortfolio) {
              const s = p.stats.find(st => st.fundId === fundId)
              if (s && s.eventCount > 0) portfolioStats.push({ p, s })
            }
          }

          return (
            <div key={fundId} className="dca-dividend-group">
              <div className="dca-dividend-fund-head">
                Quỹ <strong>{fundId}</strong> — {evs.length} đợt chi trả trong kỳ
                {' '}<span className="dca-dividend-muted">(đã trừ thuế TNCN)</span>
              </div>

              {portfolioStats.length === 0 && (
                // Fallback khi chưa có shadow simulation: chỉ hiện thông tin đợt
                <table className="dca-dividend-table">
                  <thead>
                    <tr>
                      <th>Ngày chốt quyền</th>
                      <th>Ngày nhận tiền</th>
                      <th className="num">Cổ tức/ccq (gross)</th>
                      <th className="num">Cổ tức/ccq (net)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evs.map(ev => (
                      <tr key={ev.exDate}>
                        <td>{formatDate(ev.exDate)}</td>
                        <td>{formatDate(ev.payDate)}</td>
                        <td className="num">{formatVNDFull(ev.amountPerCert)}</td>
                        <td className="num">{formatVNDFull(ev.amountPerCert * (1 - ev.taxRate))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {portfolioStats.map(({ p, s }) => (
                <div key={p.portfolioId} className="dca-dividend-portfolio">
                  {multiplePortfolios && (
                    <div className="dca-dividend-portfolio-name">Danh mục: {p.portfolioName}</div>
                  )}
                  <table className="dca-dividend-table">
                    <thead>
                      <tr>
                        <th>Ngày chốt</th>
                        <th>Ngày nhận</th>
                        <th className="num">Cổ tức/ccq</th>
                        <th className="num">CCQ đang nắm</th>
                        <th className="num">Tiền mặt trước thuế</th>
                        <th className="num">Thuế TNCN</th>
                        <th className="num">Tiền mặt thực nhận</th>
                        <th className="num">Mua thêm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.events.map(ev => (
                        <tr key={ev.exDate}>
                          <td>{formatDate(ev.exDate)}</td>
                          <td>{formatDate(ev.payDate)}</td>
                          <td className="num">{formatVNDFull(ev.gross / ev.unitsAtEx)}</td>
                          <td className="num">{formatNumber(ev.unitsAtEx)}</td>
                          <td className="num">{formatVNDFull(ev.gross)}</td>
                          <td className="num">{formatPercent(ev.tax / ev.gross)}</td>
                          <td className="num">{formatVNDFull(ev.net)}</td>
                          <td className="num">+{formatNumber(ev.sharesAdded)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4}>Tổng</td>
                        <td className="num">{formatVNDFull(s.totalGross)}</td>
                        <td className="num"></td>
                        <td className="num">{formatVNDFull(s.totalNet)}</td>
                        <td className="num">+{formatNumber(s.totalSharesAdded)} ccq</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
            </div>
          )
        })}

        <div className="dca-journey-takeaway">
          <span className="dca-journey-takeaway-icon">💵</span>
          <div>
            <strong>Giải thích giá NAV.</strong> Giá NAV trên fmarket giảm đúng bằng giá
            trị cổ tức vào ngày chốt quyền. Đây là raw NAV (giá thô), không phải chuỗi
            giá đã được điều chỉnh cho cổ tức. Một số nền tảng tự tính lại lịch sử giá
            để xóa cú giảm điểm do cổ tức, cho ra chuỗi "tổng hiệu suất" đã bao gồm giả
            định tái đầu tư cổ tức. Nhưng trên Fmarket (hay website của quỹ) thì không
            làm việc này mà họ chỉ cung cấp raw NAV.
            {' '}Dữ liệu giá trên dashboard đã được điều chỉnh dựa trên các đợt chia cổ
            tức để đảm bảo tính nhất quán. Hệ số điều chỉnh được tính toán dựa trên giá
            trước ngày chốt quyền và giá trị cổ tức thực nhận (sau thuế TNCN).
          </div>
        </div>
      </div>
    </>
  )
}

export const DividendBlock = memo(DividendBlockImpl)

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

function formatNumber(n: number): string {
  return n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
}
