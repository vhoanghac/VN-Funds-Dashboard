/**
 * DcaRatioChart: "Danh mục nào đang dẫn trước?"
 *
 * Ý tưởng mượn từ các dashboard so sánh sàn giao dịch (kiểu hl.eco):
 * thay vì nhìn 2 đường giá trị chồng lên nhau, vẽ TỶ SỐ giá trị A ÷ B
 * theo thời gian. Đường đi lên = A đang tăng nhanh hơn (hoặc giảm chậm
 * hơn) B trong giai đoạn đó, kể cả khi cả hai cùng tăng hay cùng giảm.
 *
 * Tỷ số này so sánh công bằng vì mọi danh mục trong tab DCA đều nạp
 * cùng dòng tiền vào cùng ngày trên cùng lưới ngày giao dịch.
 */
import { useState, useMemo, useRef, memo } from 'react'
import {
  Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Customized,
} from 'recharts'

interface ValuePoint {
  date: string
  value: number
}

export interface RatioPortfolio {
  id: string
  name: string
  color: string
  values: ValuePoint[]
}

interface Props {
  portfolios: RatioPortfolio[]
}

// Màu theo VÙNG chứ không theo danh mục: trên mốc 1× = xanh lá (A đang thắng),
// dưới mốc 1× = đỏ (B đang thắng) — nhìn vào là biết ngay ai dẫn trước.
const UP_COLOR = '#059669'
const DOWN_COLOR = '#dc2626'

function DcaRatioChartImpl({ portfolios }: Props) {
  const [idA, setIdA] = useState<string>('')
  const [idB, setIdB] = useState<string>('')

  // Khi kết quả DCA đổi (chạy lại với danh mục khác), reset lựa chọn nếu
  // id cũ không còn tồn tại — cùng pattern với PortfolioValueChart.
  const idsKey = portfolios.map(p => p.id).join(',')
  const prevKeyRef = useRef(idsKey)
  if (prevKeyRef.current !== idsKey) {
    prevKeyRef.current = idsKey
    if (idA && !portfolios.some(p => p.id === idA)) setIdA('')
    if (idB && !portfolios.some(p => p.id === idB)) setIdB('')
  }

  const effectiveA = portfolios.find(p => p.id === idA) ?? portfolios[0]
  const effectiveB = portfolios.find(p => p.id === idB && p.id !== effectiveA?.id)
    ?? portfolios.find(p => p.id !== effectiveA?.id)

  const ratioData = useMemo(() => {
    if (!effectiveA || !effectiveB) return []
    const bByDate = new Map(effectiveB.values.map(pt => [pt.date, pt.value]))
    const out: { timestamp: number; ratio: number }[] = []
    for (const pt of effectiveA.values) {
      const b = bByDate.get(pt.date)
      if (b === undefined || b <= 0) continue
      out.push({ timestamp: new Date(pt.date).getTime(), ratio: pt.value / b })
    }
    return out
  }, [effectiveA, effectiveB])

  if (portfolios.length < 2 || !effectiveA || !effectiveB) return null
  if (ratioData.length < 2) return null

  const lastRatio = ratioData[ratioData.length - 1]!.ratio

  // Vị trí mốc 1× trong bounding box của đường (0 = đỉnh, 1 = đáy) — dùng làm
  // điểm chuyển màu gradient: trên 1× xanh lá (A thắng), dưới 1× đỏ (B thắng).
  // Gradient mặc định tính theo bbox của chính đường line, tức đúng khoảng
  // [minRatio, maxRatio], không phụ thuộc domain trục Y.
  let minRatio = Infinity
  let maxRatio = -Infinity
  for (const d of ratioData) {
    if (d.ratio < minRatio) minRatio = d.ratio
    if (d.ratio > maxRatio) maxRatio = d.ratio
  }
  const splitOffset = maxRatio === minRatio
    ? 0.5
    : Math.max(0, Math.min(1, (maxRatio - 1) / (maxRatio - minRatio)))

  const narrative = buildRatioNarrative(ratioData)

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Danh mục nào đang dẫn trước?</h3>
        <span
          className="chart-tooltip-icon"
          title="Tỷ số giá trị giữa 2 danh mục theo thời gian. Đường đi lên nghĩa là danh mục thứ nhất đang tăng nhanh hơn (hoặc giảm chậm hơn) danh mục thứ hai, kể cả khi cả hai cùng tăng hay cùng giảm."
        >?</span>
      </div>

      <p className="dca-ratio-sub">
        Hai đường giá trị chồng lên nhau rất khó nhìn ra giai đoạn nào danh mục nào
        mạnh hơn. Biểu đồ này lấy giá trị{' '}
        <strong style={{ color: effectiveA.color }}>{effectiveA.name}</strong> chia cho{' '}
        <strong style={{ color: effectiveB.color }}>{effectiveB.name}</strong>: đường
        đi lên là danh mục thứ nhất đang mạnh hơn trong giai đoạn đó, đi xuống là
        ngược lại.
      </p>

      {portfolios.length > 2 && (
        <div className="dca-ratio-controls">
          <select
            className="dca-freq-select"
            value={effectiveA.id}
            onChange={e => setIdA(e.target.value)}
          >
            {portfolios.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="dca-ratio-vs">so với</span>
          <select
            className="dca-freq-select"
            value={effectiveB.id}
            onChange={e => setIdB(e.target.value)}
          >
            {portfolios.filter(p => p.id !== effectiveA.id).map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="dca-ratio-headline">
        <span className="dca-ratio-value" style={{ color: lastRatio >= 1 ? UP_COLOR : DOWN_COLOR }}>
          {formatRatio(lastRatio)}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={ratioData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={getYearTicks(ratioData)}
            tickFormatter={formatYear}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            domain={['auto', 'auto']}
            tickFormatter={formatRatio}
            tick={{ fontSize: 12 }}
            width={60}
          />
          <Tooltip
            formatter={(value: number) => [formatRatioFull(value), 'Tỷ số giá trị']}
            labelFormatter={formatTooltipDate}
          />
          <ReferenceLine
            y={1}
            stroke="#94a3b8"
            strokeDasharray="6 3"
          />
          <Customized
            component={renderZoneLabels(effectiveA.name, effectiveB.name)}
          />
          <defs>
            <linearGradient id="dcaRatioSplit" x1="0" y1="0" x2="0" y2="1">
              <stop offset={splitOffset} stopColor={UP_COLOR} />
              <stop offset={splitOffset} stopColor={DOWN_COLOR} />
            </linearGradient>
          </defs>
          <Line
            type="monotone"
            dataKey="ratio"
            name="Tỷ số giá trị"
            stroke="url(#dcaRatioSplit)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {narrative && (
        <p className="dca-ratio-narrative">
          Nhìn suốt cả giai đoạn, <strong style={{ color: UP_COLOR }}>{effectiveA.name}</strong>{' '}
          chiến thắng {narrative.pctA}% thời gian, <strong style={{ color: DOWN_COLOR }}>{effectiveB.name}</strong>{' '}
          chiến thắng {narrative.pctB}% thời gian còn lại.
          {' '}
          Giai đoạn chiến thắng dài nhất thuộc về{' '}
          <strong style={{ color: narrative.longestSide === 'A' ? UP_COLOR : DOWN_COLOR }}>
            {narrative.longestSide === 'A' ? effectiveA.name : effectiveB.name}
          </strong>, kéo dài liên tục khoảng {narrative.longestDurationText} (từ{' '}
          {formatDate(narrative.longestRun.startTs)} đến {formatDate(narrative.longestRun.endTs)}).
          {' '}
          Hiện tại{' '}
          <strong style={{ color: narrative.currentSide === 'A' ? UP_COLOR : DOWN_COLOR }}>
            {narrative.currentSide === 'A' ? effectiveA.name : effectiveB.name}
          </strong>{' '}
          đang chiến thắng, giữ vững từ {formatDate(narrative.currentRun.startTs)} đến nay.
          {' '}
          Không có gì đảm bảo thứ tự này sẽ giữ nguyên. Thị trường cận biên như Việt Nam có thể đổi
          ngôi chóng vánh, nên đừng neo quá chặt vào con số dẫn đầu hiện tại.
        </p>
      )}
    </div>
  )
}

export const DcaRatioChart = memo(DcaRatioChartImpl)

/**
 * Nhãn "▲ A thắng" / "▼ B thắng" ở góc phải trên/dưới VÙNG VẼ (không bám
 * đường mốc 1×, vì dữ liệu luôn xuất phát từ 1 và hay quay về gần 1 ở cuối
 * kỳ nên line dễ đè lên chữ). Dữ liệu DCA luôn chứa mốc 1 trong domain, nên
 * góc trên luôn thuộc vùng "A thắng" và góc dưới luôn thuộc vùng "B thắng".
 * paintOrder=stroke tạo viền trắng quanh chữ, đọc được cả khi line cắt qua.
 */
function renderZoneLabels(nameA: string, nameB: string) {
  return (props: { offset?: { top: number; left: number; width: number; height: number } }) => {
    const o = props.offset
    if (!o) return <g />
    const x = o.left + o.width - 8
    const common = {
      x, textAnchor: 'end' as const, fontSize: 11, fontWeight: 600,
      stroke: '#fff', strokeWidth: 3.5, paintOrder: 'stroke' as const,
    }
    return (
      <g style={{ pointerEvents: 'none' }}>
        <text {...common} y={o.top + 16} fill={UP_COLOR}>▲ {nameA} thắng</text>
        <text {...common} y={o.top + o.height - 8} fill={DOWN_COLOR}>▼ {nameB} thắng</text>
      </g>
    )
  }
}

interface RatioRun {
  side: 'A' | 'B'
  startTs: number
  endTs: number
}

interface RatioNarrative {
  pctA: number
  pctB: number
  longestRun: RatioRun
  longestSide: 'A' | 'B'
  longestDurationText: string
  currentRun: RatioRun
  currentSide: 'A' | 'B'
}

/**
 * Tính các con số kể chuyện: % thời gian mỗi bên dẫn trước, giai đoạn dẫn
 * trước dài nhất, và ai đang dẫn trước liên tục từ khi nào. Dùng point count
 * (~daily) làm proxy cho số ngày, đủ chính xác vì simulationInputs chạy trên
 * lưới ngày giao dịch hàng ngày.
 */
function buildRatioNarrative(
  ratioData: { timestamp: number; ratio: number }[],
): RatioNarrative | null {
  if (ratioData.length < 2) return null

  let countA = 0
  const runs: RatioRun[] = []
  let side: 'A' | 'B' = ratioData[0]!.ratio >= 1 ? 'A' : 'B'
  let startTs = ratioData[0]!.timestamp

  for (const d of ratioData) {
    if (d.ratio >= 1) countA++
    const pointSide: 'A' | 'B' = d.ratio >= 1 ? 'A' : 'B'
    if (pointSide !== side) {
      runs.push({ side, startTs, endTs: d.timestamp })
      side = pointSide
      startTs = d.timestamp
    }
  }
  runs.push({ side, startTs, endTs: ratioData[ratioData.length - 1]!.timestamp })

  const pctA = Math.round((countA / ratioData.length) * 100)
  const longestRun = runs.reduce((a, b) => (b.endTs - b.startTs > a.endTs - a.startTs ? b : a))
  const currentRun = runs[runs.length - 1]!

  return {
    pctA,
    pctB: 100 - pctA,
    longestRun,
    longestSide: longestRun.side,
    longestDurationText: formatDuration(longestRun.endTs - longestRun.startTs),
    currentRun,
    currentSide: currentRun.side,
  }
}

function formatDuration(ms: number): string {
  const days = ms / (24 * 60 * 60 * 1000)
  if (days < 45) return `${Math.round(days)} ngày`
  const months = days / 30.44
  if (months < 18) return `${Math.round(months)} tháng`
  return `${(days / 365.25).toFixed(1).replace('.', ',')} năm`
}

function formatRatio(v: number): string {
  return v.toFixed(2).replace('.', ',') + '×'
}

function formatRatioFull(v: number): string {
  return v.toFixed(3).replace('.', ',') + '×'
}

function getYearTicks(data: { timestamp: number }[]): number[] {
  const seen = new Set<number>()
  const ticks: number[] = []
  for (const d of data) {
    const year = new Date(d.timestamp).getFullYear()
    if (!seen.has(year)) {
      seen.add(year)
      ticks.push(d.timestamp)
    }
  }
  return ticks
}

function formatYear(ts: number): string {
  return new Date(ts).getFullYear().toString()
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const dd = d.getDate().toString().padStart(2, '0')
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

function formatTooltipDate(ts: number): string {
  return formatDate(ts)
}
