/**
 * RollingReturnBlock: "Nếu bạn bắt đầu ở thời điểm khác thì sao?"
 *
 * Histogram của CAGR N-năm rolling. Trả lời câu hỏi quan trọng: "Kết quả của
 * tôi có phải do lucky timing không? Nếu bạn tôi bắt đầu trễ/sớm 1-2 năm thì
 * kết quả sẽ khác thế nào?"
 *
 * Mental model: retail VN hay so sánh với người khác đầu tư cùng quỹ nhưng
 * khác thời điểm, rồi buồn/vui vì kết quả lệch nhau. Block này cho thấy
 * phân phối toàn bộ kịch bản có thể xảy ra.
 */
import { useState, useMemo, memo } from 'react'
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, ReferenceLine, Cell,
} from 'recharts'
import { rollingCAGR, histogramBuckets, trailingWindowCagr } from '../utils/dca'
import type { ReturnPoint } from '../types'

export interface RollingPortfolio {
  id: string
  name: string
  color: string
  cumulative: ReturnPoint[]
}

interface Props {
  portfolios: RollingPortfolio[]
}

const WINDOW_OPTIONS = [3, 5, 7, 10]

function RollingReturnBlockImpl({ portfolios }: Props) {
  const [windowYears, setWindowYears] = useState<number>(5)

  if (portfolios.length === 0) return null

  return (
    <div className="dca-rolling-block">
      <h3 className="dca-rolling-title">Nếu bạn bắt đầu ở thời điểm khác thì sao?</h3>
      <p className="dca-rolling-sub">
        Giả sử có rất nhiều người cùng đầu tư vào quỹ này nhưng mỗi người bắt đầu ở một
        tháng khác nhau và giữ đúng <strong>{windowYears} năm</strong>. Kết quả của mỗi
        người sẽ khác nhau rất nhiều, có người trúng đỉnh, có người trúng đáy. Biểu đồ
        dưới đây cho thấy phân phối CAGR của tất cả các chu kỳ {windowYears} năm trong
        lịch sử, và vị trí của bạn nằm ở đâu trong đó.
      </p>

      <div className="dca-rolling-controls">
        <span className="dca-rolling-controls-label">Chu kỳ:</span>
        {WINDOW_OPTIONS.map(w => (
          <button
            key={w}
            className={`dca-rolling-btn${w === windowYears ? ' dca-rolling-btn--active' : ''}`}
            onClick={() => setWindowYears(w)}
          >
            {w} năm
          </button>
        ))}
      </div>

      {portfolios.map(p => (
        <RollingForPortfolio key={p.id} portfolio={p} windowYears={windowYears} />
      ))}
    </div>
  )
}

export const RollingReturnBlock = memo(RollingReturnBlockImpl)

function RollingForPortfolio({
  portfolio,
  windowYears,
}: {
  portfolio: RollingPortfolio
  windowYears: number
}) {
  const { rolls, buckets, stats, userCagr } = useMemo(() => {
    const rolls = rollingCAGR(portfolio.cumulative, windowYears)
    const values = rolls.map(r => r.cagr)
    const buckets = histogramBuckets(values, 0.02)
    const stats = computeStats(values)
    // Cùng công thức TWRR + cùng độ dài windowYears với `rolls` ở trên (khác
    // CAGR kiểu nhà đầu tư trên toàn bộ kỳ backtest) — để percentile so sánh
    // đúng nghĩa "kết quả windowYears năm gần nhất của bạn nằm ở đâu trong
    // phân phối windowYears năm lịch sử", không lẫn 2 công thức/2 độ dài khác nhau.
    const userCagr = trailingWindowCagr(portfolio.cumulative, windowYears)
    return { rolls, buckets, stats, userCagr }
  }, [portfolio.cumulative, windowYears])

  if (rolls.length < 3) {
    // Lý do thật thường không phải quỹ thiếu lịch sử, mà là khoảng thời gian
    // user chọn (mặc định "5 năm qua") ngắn hơn chu kỳ đang xét. Hiển thị ngày
    // thực tế của chuỗi để người đọc thấy ngay vấn đề ở đâu.
    const start = portfolio.cumulative[0]?.date
    const end = portfolio.cumulative[portfolio.cumulative.length - 1]?.date
    const span =
      start && end
        ? `Khoảng thời gian đang chọn chỉ từ ${formatDate(start)} tới ${formatDate(end)}`
        : 'Khoảng thời gian đang chọn quá ngắn'
    return (
      <div className="dca-rolling-card">
        <div className="dca-rolling-card-header">
          <span style={{ color: portfolio.color, fontWeight: 700 }}>{portfolio.name}</span>
        </div>
        <div className="dca-rolling-insufficient">
          {span}, chưa đủ để tính chu kỳ {windowYears} năm (cần ít nhất {windowYears + 1} năm).
          Không phải quỹ thiếu dữ liệu, mà là khoảng xem ngắn. Kéo rộng khoảng thời gian ở phần Thông số rồi thử lại.
        </div>
      </div>
    )
  }

  const percentile = userCagr !== null ? percentileOf(rolls.map(r => r.cagr), userCagr) : null

  // Chart data
  const chartData = buckets.map(b => ({
    center: b.center * 100,
    centerLabel: `${(b.center * 100).toFixed(0)}%`,
    count: b.count,
    range: `${(b.min * 100).toFixed(1)}% đến ${(b.max * 100).toFixed(1)}%`,
    // Highlight bucket chứa user CAGR
    highlight: userCagr !== null && userCagr >= b.min && userCagr < b.max,
  }))

  return (
    <div className="dca-rolling-card">
      <div className="dca-rolling-card-header">
        <span style={{ color: portfolio.color, fontWeight: 700 }}>{portfolio.name}</span>
        <span className="dca-rolling-card-count">
          {rolls.length} chu kỳ {windowYears} năm
        </span>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="centerLabel"
            tick={{ fontSize: 11, fill: '#6b7280' }}
            interval={Math.max(0, Math.floor(chartData.length / 10) - 1)}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6b7280' }}
            width={36}
            allowDecimals={false}
          />
          <Tooltip
            formatter={(v: number) => [`${v} chu kỳ`, 'Số lượng']}
            labelFormatter={(_, payload) => {
              const p = payload?.[0]?.payload as { range: string } | undefined
              return p ? `CAGR ${p.range}` : ''
            }}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <ReferenceLine
            x={`${Math.round(stats.median * 100)}%`}
            stroke="#6b7280"
            strokeDasharray="3 3"
            label={{ value: `Median ${(stats.median * 100).toFixed(1)}%`, fontSize: 10, fill: '#6b7280', position: 'top' }}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.highlight ? portfolio.color : '#cbd5e1'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="dca-rolling-stats">
        <StatBox label="Thấp nhất" value={fmtPct(stats.min)} />
        <StatBox label="P10" value={fmtPct(stats.p10)} />
        <StatBox label="Median" value={fmtPct(stats.median)} highlight />
        <StatBox label="P90" value={fmtPct(stats.p90)} />
        <StatBox label="Cao nhất" value={fmtPct(stats.max)} />
      </div>

      {userCagr !== null && percentile !== null && (
        <div className="dca-rolling-takeaway">
          CAGR thực tế của bạn trong kỳ này là <strong>{fmtPct(userCagr)}</strong>.
          {' '}{buildPercentileText(percentile)}
          {stats.negCount > 0 && (
            <> Nhưng phải nói thẳng: trong {rolls.length} chu kỳ {windowYears} năm lịch sử,
            có <strong>{stats.negCount}</strong> chu kỳ cho CAGR âm. Thị trường không hứa
            hẹn có lãi kể cả khi bạn giữ dài hạn. Đó là rủi ro thật, không được quên.</>
          )}
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`dca-rolling-stat${highlight ? ' dca-rolling-stat--highlight' : ''}`}>
      <div className="dca-rolling-stat-label">{label}</div>
      <div className="dca-rolling-stat-value">{value}</div>
    </div>
  )
}

function buildPercentileText(pct: number): string {
  if (pct >= 90)
    return `Bạn đang ở top 10%, tốt hơn ${pct.toFixed(0)}% các chu kỳ lịch sử. Bạn đã rất may mắn về thời điểm vào, đừng nhầm may mắn với kỹ năng.`
  if (pct >= 75)
    return `Bạn tốt hơn ${pct.toFixed(0)}% các chu kỳ lịch sử, thời điểm vào của bạn khá thuận lợi.`
  if (pct >= 50)
    return `Bạn đang nằm trên median, tốt hơn ${pct.toFixed(0)}% các chu kỳ lịch sử. Một kết quả tử tế, không quá lung lay.`
  if (pct >= 25)
    return `Bạn đang nằm dưới median, chỉ hơn ${pct.toFixed(0)}% các chu kỳ lịch sử. Đừng vội phản bội chính mình bán ra. Giữ tiếp, trung bình sẽ kéo bạn về gần median.`
  return `Bạn đang ở đáy của phân phối (percentile ${pct.toFixed(0)}). Thời điểm vào của bạn không thuận, nhưng đó không phải lỗi, không ai biết trước được. Điều quan trọng là tiếp tục nạp tiền đều đặn qua từng tháng, lịch sử cho thấy trung bình có xu hướng kéo về median khi giữ đủ lâu.`
}

interface Stats {
  min: number
  max: number
  median: number
  p10: number
  p90: number
  negCount: number
}

function computeStats(values: number[]): Stats {
  if (values.length === 0) {
    return { min: 0, max: 0, median: 0, p10: 0, p90: 0, negCount: 0 }
  }
  const sorted = [...values].sort((a, b) => a - b)
  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    median: sorted[Math.floor(sorted.length / 2)]!,
    p10: sorted[Math.floor(sorted.length * 0.1)]!,
    p90: sorted[Math.floor(sorted.length * 0.9)]!,
    negCount: sorted.filter(v => v < 0).length,
  }
}

function percentileOf(values: number[], x: number): number {
  if (values.length === 0) return 0
  const below = values.filter(v => v < x).length
  return (below / values.length) * 100
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

function formatDate(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}
