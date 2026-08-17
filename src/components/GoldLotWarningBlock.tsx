/**
 * GoldLotWarningBlock: minh bạch giới hạn "mua theo lô" của vàng vật chất.
 *
 * Vị trí: tab DCA, ngay dưới nút "Chạy DCA".
 *
 * Khác với quỹ mở/ETF (chia nhỏ vô hạn, mua được bằng bất kỳ số tiền nào),
 * vàng miếng/nhẫn SJC ngoài đời chỉ bán theo lô cố định — nhỏ nhất là 0,5 chỉ
 * (1 lượng = 10 chỉ). Engine DCA hiện tại vẫn giả định vàng chia nhỏ được y
 * hệt quỹ mở (đơn giản hoá cần thiết để tái dùng chung logic mô phỏng), nên
 * nếu số tiền nạp mỗi kỳ/ban đầu thấp hơn giá 1 lô, kết quả mô phỏng sẽ lạc
 * quan hơn thực tế — nhà đầu tư ngoài đời phải gộp nhiều kỳ mới đủ tiền mua.
 *
 * Giá vàng tăng theo thời gian, nên "không đủ tiền mua 1 lô" là một mốc thời
 * điểm, không phải hằng số — 5 triệu/tháng có thể từng dư sức mua 0,5 chỉ hồi
 * 2016 nhưng không còn đủ ở giá hiện tại. Vì vậy điều kiện cảnh báo luôn xét
 * theo giá tại thời điểm CUỐI của khoảng ngày đang mô phỏng (mặc định là hôm
 * nay nếu chọn "Tất cả"/"X năm qua" không giới hạn ngày kết thúc), rồi dò
 * ngược lịch sử trong đúng khoảng đó để báo chính xác từ khi nào mới thành
 * vấn đề — tránh đánh đồng cả giai đoạn mô phỏng là "không đủ tiền" khi thực
 * ra chỉ gần đây mới vậy.
 *
 * Chỉ hiển thị khi danh mục có ít nhất 1 quỹ vàng (type: 'gold'); im lặng
 * (return null) với danh mục toàn quỹ mở/ETF.
 */
import { useMemo, useState } from 'react'
import type { FundMeta, PortfolioCardState, PricePoint } from '../types'
import { formatVND } from '../utils/vndFormat'

/** Đơn vị bán lẻ nhỏ nhất SJC thực tế cho cả vàng miếng và vàng nhẫn. */
const SMALLEST_LOT_CHI = 0.5
const CHI_PER_LUONG = 10

interface Props {
  portfolios: PortfolioCardState[]
  initialAmount: number
  cashflowAmount: number
  funds: FundMeta[]
  /** Giá "bán ra" (sell) — giá nhà đầu tư phải trả khi mua. Chỉ có entry cho quỹ vàng. */
  purchasePriceData: Map<string, PricePoint[]>
  /** Khoảng ngày đang mô phỏng (YYYY-MM-DD). Rỗng = không giới hạn (dùng toàn bộ lịch sử có sẵn). */
  dateFrom: string
  dateTo: string
}

interface LotIssue {
  portfolioName: string
  fundName: string
  weight: number
  kind: 'initial' | 'periodic'
  contribution: number
  lotPrice: number
  periodsNeeded: number
  /** Nếu số tiền từng đủ mua 1 lô trong giai đoạn mô phỏng, mốc ngày bắt đầu không còn đủ nữa. */
  sinceDate: string | null
  rangeStart: string
  rangeEnd: string
}

function lotPriceAt(p: PricePoint) {
  return (p.price / CHI_PER_LUONG) * SMALLEST_LOT_CHI
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** Lọc chuỗi giá theo khoảng ngày (rỗng = không giới hạn phía đó). Giả định `prices` đã sắp theo ngày tăng dần. */
function filterRange(prices: PricePoint[], dateFrom: string, dateTo: string): PricePoint[] {
  return prices.filter(p => (!dateFrom || p.date >= dateFrom) && (!dateTo || p.date <= dateTo))
}

/**
 * Xét mức đủ tiền tại thời điểm CUỐI khoảng mô phỏng. Nếu đủ ở cuối, coi như
 * không có vấn đề (bỏ qua biến động trong quá khứ). Nếu không đủ, dò ngược để
 * tìm mốc ngày gần nhất mà số tiền còn đủ (nếu có) — đó là lúc bắt đầu thành
 * vấn đề trong giai đoạn mô phỏng.
 */
function evaluateContribution(arr: PricePoint[], contribution: number) {
  const n = arr.length
  const endLot = lotPriceAt(arr[n - 1]!)
  if (contribution >= endLot) return null

  let sinceIdx = 0
  for (let i = n - 1; i >= 0; i--) {
    if (contribution >= lotPriceAt(arr[i]!)) {
      sinceIdx = i + 1
      break
    }
  }
  return {
    lotPrice: endLot,
    sinceDate: sinceIdx > 0 ? arr[Math.min(sinceIdx, n - 1)]!.date : null,
    rangeStart: arr[0]!.date,
    rangeEnd: arr[n - 1]!.date,
  }
}

export function GoldLotWarningBlock({
  portfolios, initialAmount, cashflowAmount, funds, purchasePriceData, dateFrom, dateTo,
}: Props) {
  const [expanded, setExpanded] = useState(false)

  const goldFunds = useMemo(
    () => new Map(funds.filter(f => f.type === 'gold').map(f => [f.id, f])),
    [funds],
  )

  const { issues, hasGold } = useMemo(() => {
    const issues: LotIssue[] = []
    let hasGold = false

    for (const p of portfolios) {
      for (const s of p.slots) {
        const goldFund = s.fundId ? goldFunds.get(s.fundId) : undefined
        if (!goldFund || s.weight <= 0) continue
        hasGold = true

        const allPrices = purchasePriceData.get(s.fundId)
        if (!allPrices || allPrices.length === 0) continue // data chưa load xong
        const prices = filterRange(allPrices, dateFrom, dateTo)
        if (prices.length === 0) continue
        const weightFrac = s.weight / 100

        if (cashflowAmount > 0) {
          const contribution = cashflowAmount * weightFrac
          const detail = contribution > 0 ? evaluateContribution(prices, contribution) : null
          if (detail) {
            issues.push({
              portfolioName: p.name, fundName: goldFund.name_vi, weight: s.weight,
              kind: 'periodic', contribution, lotPrice: detail.lotPrice,
              periodsNeeded: Math.ceil(detail.lotPrice / contribution),
              sinceDate: detail.sinceDate, rangeStart: detail.rangeStart, rangeEnd: detail.rangeEnd,
            })
          }
        }
        if (initialAmount > 0) {
          const contribution = initialAmount * weightFrac
          const detail = contribution > 0 ? evaluateContribution(prices, contribution) : null
          if (detail) {
            issues.push({
              portfolioName: p.name, fundName: goldFund.name_vi, weight: s.weight,
              kind: 'initial', contribution, lotPrice: detail.lotPrice,
              periodsNeeded: Math.ceil(detail.lotPrice / contribution),
              sinceDate: detail.sinceDate, rangeStart: detail.rangeStart, rangeEnd: detail.rangeEnd,
            })
          }
        }
      }
    }
    return { issues, hasGold }
  }, [portfolios, initialAmount, cashflowAmount, purchasePriceData, goldFunds, dateFrom, dateTo])

  if (!hasGold) return null

  const hasWarnings = issues.length > 0

  return (
    <div className={`dq-block ${hasWarnings ? 'dq-block--warn' : 'dq-block--ok'}`}>
      <button
        className="dq-header"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <span className={`dq-dot ${hasWarnings ? 'dq-dot--warn' : 'dq-dot--ok'}`} />
        <span className="dq-header-main">
          {hasWarnings ? (
            <>
              <strong>Có kỳ không đủ tiền mua vàng ngay</strong>
              <span className="dq-header-sub">
                {issues.length} trường hợp có số tiền một kỳ/ban đầu thấp hơn giá 1 lô vàng nhỏ nhất (0,5 chỉ), tính ở cuối giai đoạn mô phỏng.
              </span>
            </>
          ) : (
            <>
              <strong>Mỗi kỳ đều đủ tiền mua vàng ngay</strong>
              <span className="dq-header-sub">
                Số tiền nạp mỗi kỳ (và ban đầu, nếu có) vào phần vàng đều đủ mua ít nhất 1 lô 0,5 chỉ ngay trong kỳ đó.
              </span>
            </>
          )}
        </span>
        <span className="dq-toggle">{expanded ? 'Thu gọn' : 'Xem chi tiết'}</span>
      </button>

      {expanded && (
        <div className="dq-body">
          <p className="dq-intro">
            Vàng miếng/nhẫn SJC không chia nhỏ vô hạn như quỹ mở hay cổ phiếu — ngoài đời bạn chỉ
            mua được theo lô cố định, nhỏ nhất là <strong>0,5 chỉ</strong> (1 lượng = 10 chỉ).{' '}
            <span className="dq-highlight">
              Mô phỏng trong dashboard giả định mỗi kỳ đều mua được đúng lượng vàng tương ứng với
              số tiền đầu tư, kể cả khi số đó chưa đủ 1 lô.
            </span>{' '}
            Ngoài đời, nếu tiền của một kỳ chưa đủ mua 1 lô, kỳ đó bạn chưa mua được vàng ngay —
            phải gộp thêm vài kỳ mới đủ tiền mua 1 lần. Cả hành trình bạn vẫn tích lũy được vàng,
            chỉ là mua thưa hơn (vài kỳ mới mua 1 lần) thay vì đều đặn mỗi kỳ như mô phỏng đang giả
            định. Giá vàng tăng theo thời gian nên đây thường là vấn đề của{' '}
            <strong>hiện tại/gần đây</strong>, không nhất thiết đúng cho toàn bộ giai đoạn mô
            phỏng.
          </p>

          {hasWarnings && (
            <div className="dq-issues">
              <h4 className="dq-issues-title">Chi tiết cảnh báo</h4>
              {issues.map((iss, i) => (
                <div className="dq-issue-card" key={i}>
                  <div className="dq-issue-head">
                    <strong>{iss.portfolioName}</strong> — {iss.fundName} ({iss.weight}%)
                  </div>
                  <ul className="dq-issue-list">
                    <li>
                      {iss.kind === 'periodic' ? (
                        <>Mỗi kỳ nạp vào phần vàng của danh mục này là <strong>{formatVND(iss.contribution)}</strong>, thấp
                        hơn giá 1 lô 0,5 chỉ tại {fmtDate(iss.rangeEnd)} (khoảng{' '}
                        <strong>{formatVND(iss.lotPrice)}</strong>) — nghĩa là kỳ đó bạn chưa mua được vàng ngay.</>
                      ) : (
                        <>Số tiền đầu tư ban đầu vào phần vàng của danh mục này là <strong>{formatVND(iss.contribution)}</strong>, thấp
                        hơn giá 1 lô 0,5 chỉ tại {fmtDate(iss.rangeEnd)} (khoảng{' '}
                        <strong>{formatVND(iss.lotPrice)}</strong>) — nghĩa là bạn chưa mua được vàng ngay từ đầu.</>
                      )}{' '}
                      {iss.sinceDate ? (
                        <>
                          Số tiền này từng đủ mua ngay trong kỳ ở giai đoạn đầu mô phỏng, chỉ mới
                          không đủ nữa kể từ khoảng <strong>{fmtDate(iss.sinceDate)}</strong> do giá
                          vàng tăng.
                        </>
                      ) : (
                        <>
                          Trong suốt giai đoạn mô phỏng ({fmtDate(iss.rangeStart)} →{' '}
                          {fmtDate(iss.rangeEnd)}), số tiền này chưa từng đủ mua ngay trong kỳ.
                        </>
                      )}{' '}
                      Ngoài đời bạn cần gộp ít nhất{' '}
                      <strong>{iss.periodsNeeded}{iss.kind === 'periodic' ? ' kỳ' : ' lần'}</strong>{' '}
                      mới đủ tiền mua 1 lần, ở giá hiện tại.
                    </li>
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
