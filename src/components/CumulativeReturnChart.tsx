import { memo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import type { ChartSeries } from '../types'
import type { BtcEvent } from '../utils/btcEvents'
import {
  mergeAllSeries, getYearTicks, formatYear, formatTooltipDate,
  formatPercent, BASELINE_COLOR, DIMMED_COLOR,
} from '../utils/chartPlumbing'
import { useDimLegend } from '../hooks/useDimLegend'

interface Props {
  series: ChartSeries[]
  events?: BtcEvent[]
}

function CumulativeReturnChartImpl({ series, events }: Props) {
  const [logScale, setLogScale] = useState(false)
  const [showEvents, setShowEvents] = useState(true)

  const seriesKey = series.map(s => s.name).join(',')
  const { handleLegendClick, isDimmed } = useDimLegend(seriesKey)

  const rawData = mergeAllSeries(series)
  const data = logScale ? toGrowthFactor(rawData, series) : rawData

  const yDomain = getCumulativeReturnDomain(series)

  // Filter events within chart date range
  const firstTs = data[0]?.timestamp as number | undefined
  const lastTs = data[data.length - 1]?.timestamp as number | undefined
  const visibleEvents = events && showEvents && firstTs !== undefined && lastTs !== undefined
    ? events
        .map(e => ({ ...e, ts: new Date(e.date).getTime() }))
        .filter(e => e.ts >= firstTs && e.ts <= lastTs)
    : []

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Lợi nhuận tích lũy</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {events && events.length > 0 && (
            <button
              className={`log-scale-btn${showEvents ? ' log-scale-btn-active' : ''}`}
              onClick={() => setShowEvents(v => !v)}
              title="Bật/tắt các mốc sự kiện quan trọng: Covid, đỉnh BTC, FTX, BTC ETF, và các kỳ bầu cử Mỹ. Nhãn giữa kỳ ghi viện nào đổi tay: CH là Cộng hoà, DC là Dân chủ. Mốc chính trị để màu xám vì chưa biết tốt hay xấu."
            >
              Sự kiện
            </button>
          )}
          <button
            className={`log-scale-btn${logScale ? ' log-scale-btn-active' : ''}`}
            onClick={() => setLogScale(v => !v)}
            title="Chuyển sang trục logarithmic. Hữu ích khi so sánh tài sản có mức tăng trưởng rất khác nhau (ví dụ: quỹ cổ phiếu vs Bitcoin)"
          >
            Log
          </button>
          <span className="chart-tooltip-icon" title="Biểu đồ thể hiện hiệu suất tích lũy từ thời điểm bắt đầu (0%). Nếu đường ở mức 50% nghĩa là quỹ đã tăng 50% so với ban đầu. Bấm vào legend để làm mờ/hiện đường.">?</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={data} margin={{ top: 47, right: 20, left: 10, bottom: 5 }}>
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
            domain={logScale ? ['auto', 'auto'] : yDomain}
            allowDataOverflow={false}
            tickFormatter={logScale ? formatGrowthFactor : (v: number) => formatPercent(v)}
            tick={{ fontSize: 12 }}
            width={60}
          />
          <Tooltip
            formatter={(value: number, name: string) => {
              if (isDimmed(name)) return []   // hide tooltip row for dimmed lines
              return logScale ? formatGrowthFactorFull(value) : formatPercent(value)
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
          <ReferenceLine
            y={logScale ? 1 : 0}
            stroke={BASELINE_COLOR}
            strokeDasharray="6 3"
            strokeWidth={1.5}
          />
          {visibleEvents.map(ev => (
            <ReferenceLine
              key={ev.date}
              x={ev.ts}
              stroke={ev.color}
              strokeDasharray="3 3"
              strokeWidth={1.5}
              label={{
                value: ev.label,
                position: 'top',
                fill: ev.color,
                fontSize: 10,
                fontWeight: 600,
                // Mỗi hàng đẩy nhãn lên 13px để mốc gần nhau khỏi đè chữ.
                offset: 6 + (ev.labelRow ?? 0) * 13,
              }}
              ifOverflow="extendDomain"
            />
          ))}
          {series.map(s => {
            const isDimmedLine = isDimmed(s.name)
            return (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={isDimmedLine ? DIMMED_COLOR : s.color}
                strokeWidth={isDimmedLine ? 1 : 2}
                opacity={isDimmedLine ? 0.4 : 1}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export const CumulativeReturnChart = memo(CumulativeReturnChartImpl)

/**
 * Keep the numeric domain tight enough for small return differences while
 * leaving a little room around observed extremes. Keep zero as an edge when
 * all returns are on the same side of the baseline.
 */
export function getCumulativeReturnDomain(series: ChartSeries[]): [number, number] {
  let min = 0
  let max = 0
  for (const s of series) {
    for (const p of s.data) {
      if (p.value < min) min = p.value
      if (p.value > max) max = p.value
    }
  }

  const range = max - min
  if (range === 0) return [-0.01, 0.01]

  const padding = range * 0.1
  const lower = min < 0 ? Math.max(min - padding, -1) : 0
  const upper = max > 0 ? max + padding : 0
  return [lower, upper]
}

/** Convert merged data from decimal returns to growth factors (1 + return) for log scale */
function toGrowthFactor(
  rawData: Record<string, unknown>[],
  allSeries: ChartSeries[],
): Record<string, unknown>[] {
  return rawData.map(row => {
    const next: Record<string, unknown> = { date: row.date, timestamp: row.timestamp }
    for (const s of allSeries) {
      const v = row[s.name]
      if (typeof v === 'number') {
        const growth = 1 + v
        // Clamp to a small positive value to avoid log(0) or log(<0)
        next[s.name] = Math.max(growth, 0.001)
      }
    }
    return next
  })
}

/** Y-axis tick: growth factor → show as % gain/loss. e.g. 2 → "+100%", 0.5 → "-50%" */
function formatGrowthFactor(value: number): string {
  const pct = (value - 1) * 100
  return (pct >= 0 ? '+' : '') + pct.toFixed(0) + '%'
}

/** Tooltip: same but with 1 decimal */
function formatGrowthFactorFull(value: number): string {
  const pct = (value - 1) * 100
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
}
