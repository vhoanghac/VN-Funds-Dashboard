import { useState, memo } from 'react'
import {
  Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ComposedChart, ReferenceLine,
} from 'recharts'
import { WOW_EVENTS, WOW_CATEGORY_META } from '../utils/wallOfWorryEvents'
import {
  getYearTicks, formatYear, formatTooltipDate, DIMMED_COLOR,
} from '../utils/chartPlumbing'
import { formatVNDFull } from '../utils/vndFormat'
import { useDimLegend } from '../hooks/useDimLegend'

interface ValuePoint {
  date: string
  value: number
}

interface PortfolioSeries {
  name: string
  color: string
  values: ValuePoint[]
  invested: ValuePoint[]
}

interface Props {
  portfolios: PortfolioSeries[]
}

const INVESTED_LINE_NAME = 'Đã đầu tư'

function PortfolioValueChartImpl({ portfolios }: Props) {
  const [logScale, setLogScale] = useState(false)
  const [showEvents, setShowEvents] = useState(false)

  const seriesKey = portfolios.map(p => p.name).join(',')
  const { handleLegendClick, isDimmed } = useDimLegend(seriesKey)

  if (portfolios.length === 0) return null

  const data = mergeData(portfolios)

  // Sự kiện Wall of Worry nằm trong khoảng thời gian của biểu đồ.
  // Đánh số 1..n để marker trên chart gọn, tên đầy đủ nằm ở chú giải dưới.
  const minDate = data.length > 0 ? (data[0]!.date as string) : ''
  const maxDate = data.length > 0 ? (data[data.length - 1]!.date as string) : ''
  const chartEvents = showEvents
    ? WOW_EVENTS
        .filter(ev => ev.date >= minDate && ev.date <= maxDate)
        .map((ev, i) => ({
          num: i + 1,
          ts: new Date(ev.date).getTime(),
          date: ev.date,
          label: ev.shortLabel ?? ev.label,
          color: WOW_CATEGORY_META[ev.category].color,
        }))
    : []

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Giá trị tài sản</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className={`log-scale-btn${showEvents ? ' log-scale-btn-active' : ''}`}
            onClick={() => setShowEvents(v => !v)}
            title="Hiện các sự kiện Wall of Worry (chiến tranh, đại dịch, khủng hoảng...) trên biểu đồ, để thấy giá trị tài sản của bạn đã đi qua những giai đoạn nào."
          >
            Sự kiện
          </button>
          <button
            className={`log-scale-btn${logScale ? ' log-scale-btn-active' : ''}`}
            onClick={() => setLogScale(v => !v)}
            title="Chuyển sang trục logarithmic. Hữu ích khi xem rõ tốc độ tăng trưởng ở giai đoạn đầu, lúc giá trị còn nhỏ so với giai đoạn sau."
          >
            Log
          </button>
          <span
            className="chart-tooltip-icon"
            title="Biểu đồ giá trị tài sản thực tế (MWRR) của nhà đầu tư theo thời gian. Đường nét đứt là tổng chi phí đã đầu tư (cost basis). Bấm vào legend để làm mờ/hiện đường."
          >?</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={getYearTicks(data)}
            tickFormatter={formatYear}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            scale={logScale ? 'log' : 'auto'}
            domain={logScale ? ['auto', 'auto'] : ['auto', 'auto']}
            allowDataOverflow={false}
            tickFormatter={formatVND}
            tick={{ fontSize: 12 }}
            width={80}
          />
          <Tooltip
            formatter={(value: number, name: string) => {
              if (isDimmed(name)) return []
              return [formatVNDFull(value), name]
            }}
            labelFormatter={formatTooltipDate}
          />
          <Legend
            onClick={handleLegendClick}
            formatter={(value: string) => (
              <span style={{
                color: isDimmed(value) ? DIMMED_COLOR : undefined,
                cursor: 'pointer',
                textDecoration: isDimmed(value) ? 'line-through' : undefined,
              }}>
                {value}
              </span>
            )}
          />
          {chartEvents.map(ev => (
            <ReferenceLine
              key={`wow-${ev.date}`}
              x={ev.ts}
              stroke={ev.color}
              strokeDasharray="3 3"
              strokeOpacity={0.4}
              label={renderEventMarker(ev.num, ev.color)}
            />
          ))}
          {portfolios.map(p => {
            const legendName = p.name
            const isDimmedLine = isDimmed(legendName)
            return (
              <Line
                key={`line-${p.name}`}
                type="monotone"
                dataKey={`${p.name}_value`}
                name={legendName}
                stroke={isDimmedLine ? DIMMED_COLOR : p.color}
                strokeWidth={isDimmedLine ? 0.75 : 2}
                opacity={isDimmedLine ? 0.4 : 1}
                dot={false}
                connectNulls={true}
                isAnimationActive={false}
              />
            )
          })}
          {(() => {
            const isDimmedLine = isDimmed(INVESTED_LINE_NAME)
            return (
              <Line
                key="invested-shared"
                type="stepAfter"
                dataKey={`${portfolios[0]!.name}_invested`}
                name={INVESTED_LINE_NAME}
                stroke={isDimmedLine ? DIMMED_COLOR : '#94a3b8'}
                strokeDasharray="6 3"
                strokeWidth={isDimmedLine ? 0.75 : 1.5}
                opacity={isDimmedLine ? 0.3 : 0.7}
                dot={false}
                connectNulls={true}
                isAnimationActive={false}
              />
            )
          })()}
        </ComposedChart>
      </ResponsiveContainer>
      {chartEvents.length > 0 && (
        <div className="pvc-events-legend">
          {chartEvents.map(ev => (
            <span key={ev.date} className="pvc-events-item">
              <span className="pvc-events-num" style={{ background: ev.color }}>{ev.num}</span>
              {formatLegendDate(ev.date)} · {ev.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export const PortfolioValueChart = memo(PortfolioValueChartImpl)

/**
 * Marker số thứ tự trên đầu mỗi đường sự kiện. Recharts truyền viewBox của
 * ReferenceLine (x = vị trí đường, y = mép trên vùng vẽ). Đánh số so le
 * 2 tầng để các sự kiện gần nhau không đè lên nhau.
 */
function renderEventMarker(num: number, color: string) {
  return (props: { viewBox?: { x?: number; y?: number } }) => {
    const x = props.viewBox?.x ?? 0
    const y = (props.viewBox?.y ?? 0) + (num % 2 === 0 ? 26 : 8)
    return (
      <g>
        <circle cx={x} cy={y} r={8} fill={color} opacity={0.9} />
        <text x={x} y={y + 3} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">
          {num}
        </text>
      </g>
    )
  }
}

function formatLegendDate(dateStr: string): string {
  const [y, m] = dateStr.split('-')
  return `${m}/${y}`
}

function mergeData(portfolios: PortfolioSeries[]): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>()

  for (const p of portfolios) {
    for (const pt of p.values) {
      const key = pt.date
      const row = map.get(key) || { date: key, timestamp: new Date(key).getTime() }
      row[`${p.name}_value`] = pt.value
      map.set(key, row)
    }
    for (const pt of p.invested) {
      const key = pt.date
      const row = map.get(key) || { date: key, timestamp: new Date(key).getTime() }
      row[`${p.name}_invested`] = pt.value
      map.set(key, row)
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => (a.timestamp as number) - (b.timestamp as number),
  )
}

/** Trục Y: nén tiền thành M/K để nhãn ngắn (khác formatVND của vndFormat vốn ra "triệu/tỷ"). */
function formatVND(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M'
  if (value >= 1_000) return (value / 1_000).toFixed(0) + 'K'
  return value.toFixed(0)
}
