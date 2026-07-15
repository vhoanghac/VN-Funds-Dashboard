/**
 * Wall of Worry: biểu đồ giá E1VFVN30 đánh dấu các sự kiện bất ổn lớn
 * (thế giới, vĩ mô VN, doanh nghiệp VN) trong suốt lịch sử niêm yết.
 *
 * Ý tưởng từ wallofworry.co. Thông điệp: tin xấu luôn tồn tại, nhưng nhìn
 * lại lịch sử thì thị trường đã leo qua từng bức tường lo âu.
 *
 * Biểu đồ vẽ bằng SVG thuần (không dùng recharts) để đặt được label text
 * đầy đủ cho từng sự kiện kèm đường chỉ dẫn xuống điểm giá, giống phong
 * cách poster của trang gốc. Layout label dùng thuật toán tham lam: đi từ
 * trái sang phải, thử từng "tầng" cách xa dần điểm giá cho đến khi không
 * đè lên label nào đã đặt trước đó.
 */
import { memo, useMemo, useState } from 'react'
import { useFundSeries } from '../hooks/useFundData'
import { WOW_EVENTS, WOW_CATEGORY_META } from '../utils/wallOfWorryEvents'

const FUND_ID = 'E1VFVN30'

// Hệ tọa độ SVG cố định, scale theo chiều rộng container (giữ tỷ lệ)
const VB_W = 1160
const VB_H = 640
const MARGIN_L = 30
const MARGIN_R = 30
const PRICE_TOP = 150   // vùng dao động của đường giá
const PRICE_BOT = 545
const LABEL_MIN_Y = 10
const LABEL_MAX_Y = 560
const YEAR_Y = 606      // baseline chữ năm ở trục hoành

const INK = '#141413'
const LABEL_FONT = 11
const CHAR_W = 5.8      // ước lượng độ rộng ký tự ở font 11px
const LINE_H = 14

interface ChartPoint { ts: number; date: string; price: number }

interface PlacedLabel {
  key: string
  x: number
  dotY: number
  lines: string[]
  boxX: number
  boxTop: number
  boxW: number
  boxH: number
  side: 'above' | 'below'
  color: string
}

function WallOfWorryPanelImpl() {
  const { prices, loading, error } = useFundSeries(FUND_ID)
  const [logScale, setLogScale] = useState(false)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  // Sự kiện bị ẩn khỏi biểu đồ (nhưng vẫn hiện trong danh sách, chỉ tắt checkbox)
  const [hiddenDates, setHiddenDates] = useState<Set<string>>(new Set())
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())

  const chart = useMemo(() => {
    if (!prices || prices.length < 2) return null

    const pts: ChartPoint[] = prices.map(p => ({
      ts: new Date(p.date).getTime(),
      date: p.date,
      price: p.price,
    }))
    const t0 = pts[0]!.ts
    const t1 = pts[pts.length - 1]!.ts

    let pMin = Infinity
    let pMax = -Infinity
    for (const p of pts) {
      if (p.price < pMin) pMin = p.price
      if (p.price > pMax) pMax = p.price
    }

    const xOf = (ts: number) =>
      MARGIN_L + ((ts - t0) / (t1 - t0)) * (VB_W - MARGIN_L - MARGIN_R)

    const yOf = logScale
      ? (price: number) => {
          const lo = Math.log(pMin * 0.97)
          const hi = Math.log(pMax * 1.03)
          return PRICE_BOT - ((Math.log(price) - lo) / (hi - lo)) * (PRICE_BOT - PRICE_TOP)
        }
      : (price: number) => {
          const lo = pMin * 0.97
          const hi = pMax * 1.03
          return PRICE_BOT - ((price - lo) / (hi - lo)) * (PRICE_BOT - PRICE_TOP)
        }

    const linePath = 'M ' + pts.map(p => `${xOf(p.ts).toFixed(1)},${yOf(p.price).toFixed(1)}`).join(' L ')
    const areaPath = `${linePath} L ${xOf(t1).toFixed(1)},${PRICE_BOT + 30} L ${xOf(t0).toFixed(1)},${PRICE_BOT + 30} Z`

    // Mốc năm trên trục hoành (bỏ mốc quá sát mốc kế tiếp, vd năm niêm yết
    // chỉ có vài tháng dữ liệu cuối năm)
    const allTicks: Array<{ x: number; year: number }> = []
    let seenYear = -1
    for (const p of pts) {
      const y = new Date(p.ts).getFullYear()
      if (y !== seenYear) {
        seenYear = y
        allTicks.push({ x: xOf(p.ts), year: y })
      }
    }
    const yearTicks = allTicks.filter((t, i) =>
      i === allTicks.length - 1 || allTicks[i + 1]!.x - t.x >= 45)

    // Chỉ lấy sự kiện nằm trong vùng dữ liệu giá (sự kiện trước ngày niêm yết tự ẩn).
    // `inRangeEvents` dùng cho danh sách bên dưới (luôn hiện đủ, kể cả khi đã bị
    // tắt checkbox); chỉ những sự kiện KHÔNG bị ẩn mới được vẽ label trên chart.
    const inRangeEvents = WOW_EVENTS
      .map(e => ({ ...e, ts: new Date(e.date).getTime() }))
      .filter(e => e.ts >= t0 && e.ts <= t1)
    const events = inRangeEvents.filter(e => !hiddenDates.has(e.date))

    const placedRects: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
    const labels: PlacedLabel[] = []

    // Label đè lên đường giá thì cũng tính là va chạm, đẩy ra tầng xa hơn
    function hitsCurve(rect: { x1: number; y1: number; x2: number; y2: number }): boolean {
      for (const p of pts) {
        const px = xOf(p.ts)
        if (px < rect.x1) continue
        if (px > rect.x2) break
        const py = yOf(p.price)
        if (py > rect.y1 && py < rect.y2) return true
      }
      return false
    }

    for (const ev of events) {
      const i = nearestIdx(pts, ev.ts)
      const x = xOf(pts[i]!.ts)
      const dotY = yOf(pts[i]!.price)
      const lines = wrapText(ev.shortLabel ?? ev.label, 18)
      const boxW = Math.max(...lines.map(l => l.length)) * CHAR_W + 6
      const boxH = lines.length * LINE_H + 2
      // Điểm giá nằm nửa dưới biểu đồ thì đặt label lên trên (chỗ trống) và ngược lại
      const side: 'above' | 'below' = dotY > (PRICE_TOP + PRICE_BOT) / 2 ? 'above' : 'below'
      const boxX = clamp(x, 10 + boxW / 2, VB_W - 10 - boxW / 2)

      const rectAt = (top: number) => ({
        x1: boxX - boxW / 2 - 3, y1: top - 3,
        x2: boxX + boxW / 2 + 3, y2: top + boxH + 3,
      })
      const isFree = (r: { x1: number; y1: number; x2: number; y2: number }) =>
        !placedRects.some(p => r.x1 < p.x2 && r.x2 > p.x1 && r.y1 < p.y2 && r.y2 > p.y1)
        && !hitsCurve(r)

      let boxTop = 0
      let rect = rectAt(boxTop)
      let placed = false
      for (let lane = 0; lane < 6; lane++) {
        const raw = side === 'above'
          ? dotY - 52 - lane * 52 - boxH
          : dotY + 52 + lane * 52
        boxTop = clamp(raw, LABEL_MIN_Y, LABEL_MAX_Y - boxH)
        rect = rectAt(boxTop)
        if (isFree(rect)) { placed = true; break }
      }
      if (!placed) {
        // Hết tầng ưu tiên: quét toàn trục dọc tìm chỗ trống đầu tiên
        for (let yTry = LABEL_MIN_Y; yTry <= LABEL_MAX_Y - boxH; yTry += 8) {
          rect = rectAt(yTry)
          if (isFree(rect)) { boxTop = yTry; break }
        }
      }
      placedRects.push(rect)
      labels.push({
        key: ev.date, x, dotY, lines, boxX, boxTop, boxW, boxH, side,
        color: WOW_CATEGORY_META[ev.category].color,
      })
    }

    return { pts, t0, t1, xOf, yOf, linePath, areaPath, yearTicks, labels, inRangeEvents }
  }, [prices, logScale, hiddenDates])

  if (loading) return <div className="simulation-panel"><p>Đang tải dữ liệu {FUND_ID}...</p></div>
  if (error || !chart) {
    return <div className="simulation-panel"><p>Không tải được dữ liệu {FUND_ID}.</p></div>
  }

  const { pts, t0, t1, xOf, yOf, linePath, areaPath, yearTicks, labels, inRangeEvents } = chart
  const hiddenCount = WOW_EVENTS.length - inRangeEvents.length
  const shownOnChartCount = inRangeEvents.length - hiddenDates.size
  const allHidden = inRangeEvents.length > 0 && hiddenDates.size === inRangeEvents.length

  const firstPrice = pts[0]!.price
  const lastPrice = pts[pts.length - 1]!.price
  const times = lastPrice / firstPrice
  const firstYear = new Date(t0).getFullYear()
  const numYears = new Date(t1).getFullYear() - firstYear

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - rect.left) * VB_W) / rect.width
    const frac = clamp((vx - MARGIN_L) / (VB_W - MARGIN_L - MARGIN_R), 0, 1)
    setHoverIdx(nearestIdx(pts, t0 + frac * (t1 - t0)))
  }

  function toggleEventVisible(date: string) {
    setHiddenDates(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  function toggleExpanded(date: string) {
    setExpandedDates(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  function toggleHideAll() {
    setHiddenDates(allHidden ? new Set() : new Set(inRangeEvents.map(e => e.date)))
  }

  const hover = hoverIdx !== null ? pts[hoverIdx] : null
  const hoverX = hover ? xOf(hover.ts) : 0
  const hoverY = hover ? yOf(hover.price) : 0
  const tipW = 118
  const tipX = hover ? (hoverX + 14 + tipW > VB_W - 8 ? hoverX - tipW - 14 : hoverX + 14) : 0
  const tipY = hover ? clamp(hoverY - 52, 12, PRICE_BOT - 50) : 0

  return (
    <div className="simulation-panel wow-panel">
      <div className="panel-header">
        <h2>Wall of Worry</h2>
      </div>

      <div className="dca-journey-block">
        <div className="dca-journey-headline">
          Trong suốt hơn {numYears} năm, không năm nào thiếu tin xấu: chiến tranh, đại dịch,
          khủng hoảng trái phiếu, chủ tịch tập đoàn bị bắt... Vậy mà từ ngày niêm yết
          tháng 10/{firstYear}, giá <strong>{FUND_ID}</strong> đã tăng khoảng{' '}
          <strong>{times.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} lần</strong>,
          leo qua {inRangeEvents.length} bức tường lo âu được đánh dấu dưới đây.
        </div>

        <div className="chart-container">
          <div className="chart-header">
            <h3>Giá {FUND_ID} và những bức tường lo âu</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="wow-shown-count">
                {shownOnChartCount}/{inRangeEvents.length} sự kiện
              </span>
              <button
                className={`log-scale-btn${logScale ? ' log-scale-btn-active' : ''}`}
                onClick={() => setLogScale(v => !v)}
                title="Chuyển sang trục logarithmic. Cùng một mức tăng phần trăm sẽ có cùng độ dốc, giúp so sánh biến động ở giai đoạn đầu và giai đoạn sau công bằng hơn."
              >
                Log
              </button>
              <span
                className="chart-tooltip-icon"
                title="Giá chứng chỉ quỹ E1VFVN30 (ETF mô phỏng chỉ số VN30) từ ngày niêm yết. Mỗi chấm là một sự kiện khiến nhà đầu tư lo ngại thị trường sẽ giảm, xem chi tiết ở danh sách bên dưới. Rê chuột lên biểu đồ để xem giá từng ngày."
              >?</span>
            </div>
          </div>

          <svg
            className="wow-chart-svg"
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            onMouseMove={handleMove}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* Nền vùng giá */}
            <defs>
              <linearGradient id="wowArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={INK} stopOpacity="0.07" />
                <stop offset="100%" stopColor={INK} stopOpacity="0" />
              </linearGradient>
            </defs>

            <path d={areaPath} fill="url(#wowArea)" />
            <path d={linePath} fill="none" stroke={INK} strokeWidth={1.6} />

            {/* Trục năm */}
            {yearTicks.map(t => (
              <text
                key={t.year}
                x={t.x}
                y={YEAR_Y}
                textAnchor="middle"
                fontSize={12}
                fill="#7A7574"
              >
                {t.year}
              </text>
            ))}

            {/* Sự kiện: đường chỉ dẫn + chấm + label. Hướng đường chỉ dẫn tính
                theo vị trí thực tế của label (có thể đã bị đẩy sang phía đối
                diện so với `side` ban đầu khi hết chỗ). */}
            {labels.map(l => {
              const labelAbove = l.boxTop + l.boxH < l.dotY
              const lineY1 = labelAbove ? l.boxTop + l.boxH + 3 : l.dotY + 6
              const lineY2 = labelAbove ? l.dotY - 6 : l.boxTop - 4
              return (
                <g key={l.key}>
                  {lineY2 > lineY1 && (
                    <line
                      x1={l.x} y1={lineY1} x2={l.x} y2={lineY2}
                      stroke={l.color} strokeWidth={1} opacity={0.55}
                    />
                  )}
                  <circle cx={l.x} cy={l.dotY} r={3.5} fill={l.color} stroke="#fff" strokeWidth={1.2} />
                  {l.lines.map((line, i) => (
                    <text
                      key={i}
                      x={l.boxX}
                      y={l.boxTop + LINE_H * (i + 1) - 3}
                      textAnchor="middle"
                      fontSize={LABEL_FONT}
                      fill="#3f3f3c"
                      fontWeight={600}
                    >
                      {line}
                    </text>
                  ))}
                </g>
              )
            })}

            {/* Hover: hairline + chấm + tooltip */}
            {hover && (
              <g pointerEvents="none">
                <line
                  x1={hoverX} y1={PRICE_TOP - 40} x2={hoverX} y2={PRICE_BOT + 20}
                  stroke="#b5b1a8" strokeWidth={1} strokeDasharray="3 3"
                />
                <circle cx={hoverX} cy={hoverY} r={4} fill={INK} stroke="#fff" strokeWidth={1.5} />
                <g transform={`translate(${tipX}, ${tipY})`}>
                  <rect width={tipW} height={42} rx={6} fill={INK} opacity={0.92} />
                  <text x={tipW / 2} y={17} textAnchor="middle" fontSize={11} fill="#e8e6e0">
                    {formatDateVN(hover.date)}
                  </text>
                  <text x={tipW / 2} y={34} textAnchor="middle" fontSize={12.5} fontWeight={700} fill="#fff">
                    {Math.round(hover.price).toLocaleString('vi-VN')} đ
                  </text>
                </g>
              </g>
            )}
          </svg>
        </div>

        {/* Chú thích nhóm sự kiện */}
        <div className="wow-legend">
          {(Object.keys(WOW_CATEGORY_META) as Array<keyof typeof WOW_CATEGORY_META>).map(cat => (
            <span key={cat} className="wow-legend-item">
              <span className="wow-legend-dot" style={{ background: WOW_CATEGORY_META[cat].color }} />
              {WOW_CATEGORY_META[cat].name}
            </span>
          ))}
        </div>

        {/* Danh sách sự kiện: mỗi dòng có checkbox bật/tắt hiện trên biểu đồ,
            bấm vào tên để mở/thu gọn mô tả kèm nguồn. Style tham khảo
            wallofworry.co (date + dot + title + checkbox trên 1 hàng). */}
        <div className="wow-events-panel">
          <div className="wow-events-header">
            <span className="wow-events-header-label">Sự kiện</span>
            <button className="wow-hide-all-btn" onClick={toggleHideAll}>
              {allHidden ? 'Hiện tất cả' : 'Ẩn tất cả'}
            </button>
          </div>
          <ul className="wow-events-list">
            {inRangeEvents.map(ev => {
              const isHidden = hiddenDates.has(ev.date)
              const isExpanded = expandedDates.has(ev.date)
              return (
                <li key={ev.date} className="wow-event-row">
                  <div className="wow-event-row-main">
                    <span className="wow-event-date">{formatDateVN(ev.date)}</span>
                    <span
                      className="wow-event-dot"
                      style={{ background: WOW_CATEGORY_META[ev.category].color }}
                    />
                    <button
                      type="button"
                      className="wow-event-title-btn"
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpanded(ev.date)}
                    >
                      {ev.label}
                    </button>
                    <label className="wow-event-checkbox" title="Hiện/ẩn sự kiện này trên biểu đồ">
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        onChange={() => toggleEventVisible(ev.date)}
                      />
                      <span className="wow-event-checkbox-box" />
                    </label>
                  </div>
                  {isExpanded && (
                    <div className="wow-event-desc">
                      {ev.description}
                      {' '}
                      <a
                        className="wow-event-source"
                        href={ev.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Nguồn ↗
                      </a>
                      {ev.extraSources?.map(src => (
                        <a
                          key={src.url}
                          className="wow-event-source"
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {' · '}{src.label} ↗
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
        {hiddenCount > 0 && (
          <p className="wow-hidden-note">
            * Còn {hiddenCount} sự kiện trước ngày {FUND_ID} niêm yết (10/2014) chưa hiển thị
            vì nằm ngoài vùng dữ liệu giá:{' '}
            {WOW_EVENTS
              .filter(e => !inRangeEvents.some(v => v.date === e.date))
              .map(e => `${e.shortLabel ?? e.label} (${e.date.slice(0, 4)})`)
              .join(', ')}.
          </p>
        )}

        {/* About */}
        <div className="section-divider">
          <span className="section-divider-label">Về Wall of Worry</span>
        </div>
        <div className="wow-about">
          <p>
            "Climbing the wall of worry", leo lên bức tường lo âu, là một câu nói kinh điển
            trong giới đầu tư: giá cổ phiếu thường vẫn đi lên trong khi mặt báo toàn tin xấu.
            Năm nào cũng có ít nhất một lý do nghe rất hợp lý để đứng ngoài thị trường:
            chiến tranh, đại dịch, lạm phát, khủng hoảng ngân hàng... Nhưng nhìn lại lịch sử,
            thị trường đã leo qua tất cả những bức tường đó.
          </p>
          <p>
            Biểu đồ trên vẽ giá chứng chỉ quỹ {FUND_ID}, ETF lâu đời nhất mô phỏng chỉ số
            VN30, từ ngày niêm yết tháng 10/2014 đến nay. Mỗi chấm là một sự kiện mà
            tại thời điểm xảy ra, nhiều nhà đầu tư tin rằng thị trường sẽ sụp đổ. Có sự kiện
            đến từ bên kia bán cầu, có sự kiện xảy ra ngay tại Việt Nam, từ vĩ mô đến
            những vụ án doanh nghiệp lớn.
          </p>
          <p>
            Nói đi cũng phải nói lại: leo qua được không có nghĩa là leo nhanh. Bear market
            2018-2019 kéo dài gần 2 năm. Cú sập 2022 cần hơn 3 năm để giá quay về đỉnh cũ.
            Thị trường Việt Nam là thị trường cận biên, từ bull sang bear diễn ra chóng vánh,
            và không ai đảm bảo lần tới sẽ giống những lần trước. Đã gọi là đầu tư thì sẽ
            luôn có rủi ro.
          </p>
          <p>
            Điều biểu đồ này muốn nói không phải là "cứ mua là thắng", mà là: tin xấu luôn
            tồn tại. Nếu chờ đến lúc không còn tin xấu nào mới đầu tư, có thể bạn sẽ chờ mãi
            mãi. Đó là lý do vì sao đầu tư đều đặn qua từng tháng, không cần đoán đỉnh đoán
            đáy thị trường, lại là cách tiếp cận phù hợp với phần lớn chúng ta.
          </p>
          <p className="wow-disclaimer">
            Dữ liệu chỉ mang tính minh họa và giáo dục, không phải lời khuyên đầu tư.
          </p>
        </div>
      </div>
    </div>
  )
}

export const WallOfWorryPanel = memo(WallOfWorryPanelImpl)

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

/** Tìm index điểm dữ liệu gần timestamp nhất (mảng đã sort tăng dần) */
function nearestIdx(pts: ChartPoint[], ts: number): number {
  let lo = 0
  let hi = pts.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid]!.ts < ts) lo = mid
    else hi = mid
  }
  return ts - pts[lo]!.ts < pts[hi]!.ts - ts ? lo : hi
}

/** Bẻ dòng theo từ, mỗi dòng tối đa maxChars ký tự */
function wrapText(s: string, maxChars: number): string[] {
  const words = s.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) {
      lines.push(cur)
      cur = w
    } else {
      cur = cur ? cur + ' ' + w : w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function formatDateVN(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}
