/**
 * CompareStoryBlock: kể câu chuyện từ bảng số.
 *
 * Người dùng nhìn KPI cards và chart xong thường không biết rút ra điều gì.
 * Block này sắp xếp 5 câu hỏi mà retail VN thực sự quan tâm, rồi trả lời từng
 * câu bằng con số cụ thể và một takeaway ngắn:
 *
 *   1. Ai đang dẫn đầu? (cumulative return + magnitude per 100tr)
 *   2. Được bao nhiêu cho mỗi đơn vị rủi ro? (CAGR / volatility)
 *   3. Đáng tin tới đâu? (% rolling 12m dương)
 *   4. Khi bão đến, mất bao lâu để hồi? (maxDD + recovery weeks)
 *   5. Tóm lại, quỹ nào hợp với bạn? (classify + recommend)
 *
 * Không phải demo kỹ thuật, là 5 lăng kính ra quyết định.
 */
import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import type { FundComparisonData } from '../hooks/useCalculations'
import { formatVND } from '../utils/vndFormat'
import {
  annualizedStdev,
  drawdownStats,
  positiveRollingRate,
  rollingReturns,
} from '../utils/calculations'

interface Props {
  funds: FundComparisonData[]
  colors: string[]
  startDate: string
  endDate: string
}

interface FundStats {
  id: string
  color: string
  cagr: number
  totalReturn: number   // cumulative growth - 1 tại end
  vol: number           // annualized stdev
  efficiency: number    // cagr / vol
  maxDD: number         // âm
  recoveryWeeks: number | null
  underwaterWeeks: number | null
  posRate: number       // % rolling 12m dương
}

export function CompareStoryBlock({ funds, colors, startDate, endDate }: Props) {
  const stats = useMemo<FundStats[]>(() => {
    return funds.map((f, i) => {
      const cagr = f.kpi.cagr ?? 0
      const vol = annualizedStdev(f.returns)
      const last = f.cumulative[f.cumulative.length - 1]
      const totalReturn = last ? last.value : 0
      const dd = drawdownStats(f.returns)
      const roll12 = rollingReturns(f.returns, 12)
      const posRate = positiveRollingRate(roll12) ?? 0
      return {
        id: f.id,
        color: colors[i % colors.length] ?? '#2563EB',
        cagr,
        totalReturn,
        vol,
        efficiency: vol > 0 ? cagr / vol : 0,
        maxDD: dd.maxDrawdown,
        recoveryWeeks: dd.recoveryWeeks,
        underwaterWeeks: dd.underwaterWeeks,
        posRate,
      }
    })
  }, [funds, colors])

  if (stats.length < 2) return null

  const years = yearsBetween(startDate, endDate)

  return (
    <>
    <div className="section-divider">
      <span className="section-divider-label">Kể chuyện so sánh</span>
    </div>
    <div className="cmp-story">
      <header className="cmp-story-header">
        <h2 className="cmp-story-title">Bây giờ, bảng số nói gì?</h2>
        <p className="cmp-story-sub">
          Biểu đồ ở trên cho bạn cái nhìn tổng thể. Phần dưới đây trả lời 5 câu hỏi
          mà nhà đầu tư thực sự cần biết trước khi gửi tiền vào một quỹ. Khoảng thời
          gian đang so sánh: {formatDate(startDate)} tới {formatDate(endDate)},
          tức là {years.toFixed(1)} năm.
        </p>
      </header>

      <WinnerSection stats={stats} />
      <EfficiencySection stats={stats} />
      <ConsistencySection stats={stats} />
      <DrawdownSection stats={stats} />
      <CharacterSection stats={stats} />
    </div>
    </>
  )
}

// ─── 1. Ai đang dẫn đầu? ───────────────────────────────────

function WinnerSection({ stats }: { stats: FundStats[] }) {
  const sorted = [...stats].sort((a, b) => b.totalReturn - a.totalReturn)
  const winner = sorted[0]!
  const loser = sorted[sorted.length - 1]!
  const gap = winner.totalReturn - loser.totalReturn

  // Magnitude per 100 triệu vốn
  const BASE = 100_000_000
  const winnerFinalAtBase = BASE * (1 + winner.totalReturn)
  const loserFinalAtBase = BASE * (1 + loser.totalReturn)
  const gapVND = winnerFinalAtBase - loserFinalAtBase

  const barData = sorted.map(s => ({
    id: s.id,
    color: s.color,
    value: s.totalReturn * 100,
    final: BASE * (1 + s.totalReturn),
  }))

  return (
    <section className="cmp-sec">
      <h3 className="cmp-sec-title">1. Ai đang dẫn đầu?</h3>
      <p className="cmp-sec-lead">
        Nếu bạn đầu tư vào mỗi quỹ 100 triệu đồng ngay đầu kỳ và không đụng tới, hôm
        nay bạn sẽ có bao nhiêu?
      </p>

      <div className="cmp-chart">
        <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 44)}>
          <BarChart data={barData} layout="vertical" margin={{ top: 8, right: 80, left: 16, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              type="number"
              tick={{ fontSize: 12 }}
              tickFormatter={v => `${v.toFixed(0)}%`}
            />
            <YAxis type="category" dataKey="id" tick={{ fontSize: 12 }} width={axisWidthFor(sorted.map(s => s.id))} />
            <Tooltip
              formatter={(v: number, _n, item) => {
                const p = item?.payload as { final?: number } | undefined
                const finalStr = p?.final !== undefined ? ` (thành ${formatVND(p.final)})` : ''
                return [`${v.toFixed(1)}%${finalStr}`, 'Lợi nhuận cộng dồn']
              }}
            />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} isAnimationActive={false}>
              {barData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="cmp-takeaway">
        Dẫn đầu là <strong>{winner.id}</strong>. 100 triệu ban đầu giờ thành{' '}
        <strong>{formatVND(winnerFinalAtBase)}</strong>, tức là lãi{' '}
        <strong>{(winner.totalReturn * 100).toFixed(1)}%</strong>.{' '}
        {sorted.length > 1 ? (
          <>
            Xếp cuối là <strong>{loser.id}</strong> với{' '}
            <strong>{formatVND(loserFinalAtBase)}</strong>. Chênh lệch{' '}
            <strong>{formatVND(gapVND)}</strong> trên mỗi 100 triệu,
            tương đương {(gap * 100).toFixed(1)} điểm phần trăm.{' '}
          </>
        ) : null}
        Con số ấn tượng, nhưng "dẫn đầu" trong quá khứ chưa kể hết câu chuyện.
        Đọc tiếp 4 phần dưới để thấy bức tranh đầy đủ hơn.
      </p>
    </section>
  )
}

// ─── 2. Được bao nhiêu cho mỗi đơn vị rủi ro? ───────────────

function EfficiencySection({ stats }: { stats: FundStats[] }) {
  const sorted = [...stats].sort((a, b) => b.efficiency - a.efficiency)
  const best = sorted[0]!
  const worst = sorted[sorted.length - 1]!

  return (
    <section className="cmp-sec">
      <h3 className="cmp-sec-title">2. Được bao nhiêu lãi cho mỗi đơn vị rủi ro?</h3>
      <p className="cmp-sec-lead">
        Cùng một mức lãi hàng năm, quỹ nào có đường đi ít gập ghềnh hơn thì
        "chất lượng" hơn. Tỉ số CAGR chia cho volatility (biến động quy năm)
        cho bạn một con số gọn để so sánh: số càng lớn nghĩa là mỗi 1% rủi ro
        bạn gánh đang được đền đáp bằng càng nhiều lợi nhuận.
      </p>

      <div className="cmp-table">
        <div className="cmp-table-row cmp-table-head">
          <span>Quỹ</span>
          <span>CAGR</span>
          <span>Biến động (σ)</span>
          <span>Tỉ số</span>
        </div>
        {sorted.map(s => (
          <div key={s.id} className="cmp-table-row">
            <span className="cmp-fund-cell">
              <span className="cmp-swatch" style={{ background: s.color }} />
              <strong>{s.id}</strong>
            </span>
            <span>{(s.cagr * 100).toFixed(1)}%</span>
            <span>{(s.vol * 100).toFixed(1)}%</span>
            <span className="cmp-num-strong">{s.efficiency.toFixed(2)}</span>
          </div>
        ))}
      </div>

      <p className="cmp-takeaway">
        <strong>{best.id}</strong> đạt tỉ số <strong>{best.efficiency.toFixed(2)}</strong>,
        tức là mỗi 1% biến động "đổi lấy" được {best.efficiency.toFixed(2)}%
        lợi nhuận mỗi năm. {sorted.length > 1 ? (
          <>
            Xếp cuối là <strong>{worst.id}</strong> với{' '}
            <strong>{worst.efficiency.toFixed(2)}</strong>.{' '}
          </>
        ) : null}
        Tỉ số này không phải tiêu chí duy nhất. Nhưng nếu hai quỹ lãi xấp xỉ nhau,
        quỹ có tỉ số cao hơn sẽ giúp bạn ngủ ngon hơn trên đường đi.
      </p>
    </section>
  )
}

// ─── 3. Đáng tin tới đâu? ─────────────────────────────────

function ConsistencySection({ stats }: { stats: FundStats[] }) {
  const sorted = [...stats].sort((a, b) => b.posRate - a.posRate)
  const best = sorted[0]!
  const worst = sorted[sorted.length - 1]!

  const barData = sorted.map(s => ({
    id: s.id,
    color: s.color,
    value: s.posRate * 100,
  }))

  return (
    <section className="cmp-sec">
      <h3 className="cmp-sec-title">3. Nếu bạn giữ 12 tháng, xác suất có lãi là bao nhiêu?</h3>
      <p className="cmp-sec-lead">
        Giả sử bạn xét tất cả các khoảng 12 tháng liên tiếp trong lịch sử quỹ:
        trong bao nhiêu phần trăm số đó, bạn kết thúc với lợi nhuận dương? Đây
        là thước đo "mức độ tin cậy" dễ cảm nhận nhất cho nhà đầu tư giữ dài hạn.
      </p>

      <div className="cmp-chart">
        <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 44)}>
          <BarChart data={barData} layout="vertical" margin={{ top: 8, right: 60, left: 16, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              type="number"
              domain={[0, 100]}
              tick={{ fontSize: 12 }}
              tickFormatter={v => `${v.toFixed(0)}%`}
            />
            <YAxis type="category" dataKey="id" tick={{ fontSize: 12 }} width={axisWidthFor(sorted.map(s => s.id))} />
            <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Rolling 12m dương']} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} isAnimationActive={false}>
              {barData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="cmp-takeaway">
        <strong>{best.id}</strong> đạt {(best.posRate * 100).toFixed(0)}% khoảng
        12 tháng có lãi. Nói cách khác, cứ 10 lần bạn mua và giữ tròn năm,
        khoảng {Math.round(best.posRate * 10)} lần kết thúc với tiền nhiều hơn
        lúc vào.
        {sorted.length > 1 ? (
          <>
            {' '}Thấp nhất là <strong>{worst.id}</strong> với{' '}
            {(worst.posRate * 100).toFixed(0)}%.{' '}
          </>
        ) : null}
        Con số cao không đảm bảo tương lai sẽ giống, nhưng nó cho bạn biết
        trong quá khứ quỹ có thường xuyên đi lên trong vòng 1 năm hay không.
        Nếu bạn là nhà đầu tư mới, con số này quan trọng hơn CAGR.
      </p>
    </section>
  )
}

// ─── 4. Khi bão đến, mất bao lâu để hồi? ───────────────────

function DrawdownSection({ stats }: { stats: FundStats[] }) {
  const sorted = [...stats].sort((a, b) => a.maxDD - b.maxDD) // sâu nhất ở đầu
  const worst = sorted[0]!
  const best = sorted[sorted.length - 1]!

  return (
    <section className="cmp-sec">
      <h3 className="cmp-sec-title">4. Khi bão đến, mất bao lâu để hồi phục?</h3>
      <p className="cmp-sec-lead">
        Đáy sâu nhất trong lịch sử là một con số. Nhưng đáng sợ hơn nhiều là
        câu hỏi: sau khi rơi xuống đó, bao lâu quỹ mới về lại đỉnh cũ? Đây là
        khoảng thời gian bạn phải sống với tài khoản âm.
      </p>

      <div className="cmp-table">
        <div className="cmp-table-row cmp-table-head cmp-table-head--dd">
          <span>Quỹ</span>
          <span>Đáy sâu nhất</span>
          <span>Thời gian hồi phục</span>
        </div>
        {sorted.map(s => (
          <div key={s.id} className="cmp-table-row cmp-table-row--dd">
            <span className="cmp-fund-cell">
              <span className="cmp-swatch" style={{ background: s.color }} />
              <strong>{s.id}</strong>
            </span>
            <span className="cmp-num-neg">{(s.maxDD * 100).toFixed(1)}%</span>
            <span>
              {s.recoveryWeeks !== null
                ? formatRecovery(s.recoveryWeeks)
                : s.underwaterWeeks !== null
                  ? <span className="cmp-underwater">Chưa hồi phục, đã {formatRecovery(s.underwaterWeeks)}</span>
                  : '—'}
            </span>
          </div>
        ))}
      </div>

      <p className="cmp-takeaway">
        <strong>{worst.id}</strong> từng rơi sâu nhất ở mức{' '}
        <strong>{(worst.maxDD * 100).toFixed(1)}%</strong>
        {worst.recoveryWeeks !== null ? (
          <>
            {' '}và cần <strong>{formatRecovery(worst.recoveryWeeks)}</strong> để
            về lại đỉnh cũ.
          </>
        ) : (
          <>
            {' '}và tới nay <strong>vẫn chưa</strong> về lại đỉnh cũ. Nghĩa là
            nếu bạn mua đúng đỉnh cũ đó, tới hôm nay tài khoản vẫn đang âm.
          </>
        )}
        {' '}Đỡ nhất là <strong>{best.id}</strong>{' '}
        ({(best.maxDD * 100).toFixed(1)}%
        {best.recoveryWeeks !== null ? `, hồi trong ${formatRecovery(best.recoveryWeeks)}` : ''}).
        {' '}Trước khi quyết định, hãy tự hỏi: liệu bạn có chịu nổi mức lỗ tạm
        thời như vậy mà không bán tháo?
      </p>
    </section>
  )
}

// ─── 5. Quỹ nào hợp với bạn? ──────────────────────────────

type Character = 'aggressive' | 'stable' | 'balanced' | 'weak'

interface Classified extends FundStats {
  character: Character
  label: string
  tagline: string
}

function classify(s: FundStats, allStats: FundStats[]): Classified {
  const avgCagr = allStats.reduce((a, x) => a + x.cagr, 0) / allStats.length
  const avgVol = allStats.reduce((a, x) => a + x.vol, 0) / allStats.length

  const highReturn = s.cagr > avgCagr
  const highVol = s.vol > avgVol

  let character: Character
  let label: string
  let tagline: string

  if (highReturn && !highVol) {
    character = 'balanced'
    label = 'Hiệu quả'
    tagline = 'Lãi cao hơn trung bình mà biến động thấp hơn trung bình. Kiểu quỹ ai cũng muốn có trong danh mục.'
  } else if (highReturn && highVol) {
    character = 'aggressive'
    label = 'Tăng trưởng cao, đổi lại dao động mạnh'
    tagline = 'Lãi khá hơn nhóm nhưng đường đi gập ghềnh. Hợp với người trẻ, thu nhập ổn, có thể gồng 3-5 năm.'
  } else if (!highReturn && !highVol) {
    character = 'stable'
    label = 'Ổn định, ít rung lắc'
    tagline = 'Lãi chưa bằng nhóm dẫn đầu nhưng bù lại ít biến động. Hợp với người đã có gia đình, gần hưu, hoặc mới bước vào đầu tư.'
  } else {
    character = 'weak'
    label = 'Cần xem lại'
    tagline = 'Lãi dưới trung bình mà biến động lại cao hơn. Nếu không có lý do chiến lược rõ ràng để giữ, có thể cân nhắc thay thế.'
  }

  return { ...s, character, label, tagline }
}

function CharacterSection({ stats }: { stats: FundStats[] }) {
  const classified = stats.map(s => classify(s, stats))

  return (
    <section className="cmp-sec cmp-sec--verdict">
      <h3 className="cmp-sec-title">5. Tóm lại, quỹ nào hợp với bạn?</h3>
      <p className="cmp-sec-lead">
        Không có quỹ "tốt nhất" cho mọi người. Chỉ có quỹ hợp với tính cách đầu
        tư và khung thời gian của bạn. Dựa trên CAGR và biến động trong kỳ đang
        so sánh, mỗi quỹ được gán một đặc tính.
      </p>

      <div className="cmp-verdict-grid">
        {classified.map(c => (
          <div key={c.id} className={`cmp-verdict-card cmp-verdict--${c.character}`}>
            <div className="cmp-verdict-head">
              <span className="cmp-swatch" style={{ background: c.color }} />
              <strong>{c.id}</strong>
              <span className={`cmp-verdict-badge cmp-verdict-badge--${c.character}`}>
                {c.label}
              </span>
            </div>
            <div className="cmp-verdict-kpis">
              <span>CAGR <strong>{(c.cagr * 100).toFixed(1)}%</strong></span>
              <span>σ <strong>{(c.vol * 100).toFixed(1)}%</strong></span>
              <span>Đáy <strong className="cmp-num-neg">{(c.maxDD * 100).toFixed(0)}%</strong></span>
            </div>
            <p className="cmp-verdict-tagline">{c.tagline}</p>
          </div>
        ))}
      </div>

      <p className="cmp-takeaway">
        Một cách đọc nhanh. Nếu bạn còn trẻ, ngân sách đầu tư chỉ là một phần
        thu nhập, và bạn có thể nhắm mắt đi qua một đợt giảm 30%, quỹ "Tăng
        trưởng cao" thường đem lại kết quả tốt nhất trong dài hạn. Nếu bạn đang
        tiết kiệm cho một mục tiêu 3-5 năm (mua nhà, cho con đi học), quỹ "Ổn
        định" hoặc "Hiệu quả" phù hợp hơn. Cuối cùng, đừng chỉ nhìn một quỹ,
        hãy sang tab DCA để xem nếu bạn đều đặn nạp tiền mỗi tháng, kết quả
        thay đổi ra sao.
      </p>
    </section>
  )
}

// ─── Utils ────────────────────────────────────────────────

/** Chiều rộng trục Y (px) đủ chứa tên dài nhất. 12px font ≈ 6.5px/ký tự. */
function axisWidthFor(ids: string[]): number {
  const longest = ids.reduce((max, id) => Math.max(max, id.length), 0)
  return Math.max(80, Math.ceil(longest * 6.8) + 14)
}

function yearsBetween(start: string, end: string): number {
  const a = new Date(start).getTime()
  const b = new Date(end).getTime()
  return (b - a) / (365.25 * 24 * 60 * 60 * 1000)
}

function formatDate(d: string): string {
  const parts = d.split('-')
  if (parts.length !== 3) return d
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

function formatRecovery(weeks: number): string {
  if (weeks < 4) return `${weeks} tuần`
  const months = weeks / 4.345
  if (months < 12) return `${months.toFixed(months < 3 ? 1 : 0)} tháng`
  const years = months / 12
  return `${years.toFixed(1)} năm`
}
