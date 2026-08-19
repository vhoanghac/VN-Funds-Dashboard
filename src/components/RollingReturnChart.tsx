import { useState, useRef, useLayoutEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import type { ChartSeries, ReturnPoint } from '../types'
import { rollingReturnDistribution } from '../utils/calculations'
import { percentileSorted } from '../utils/stats'
import {
  mergeAllSeries, getYearTicks, formatYear, formatTooltipDate,
  formatPercent, formatPercentFull, BASELINE_COLOR, DIMMED_COLOR,
} from '../utils/chartPlumbing'
import { countIndependentWindows } from '../utils/dateWindow'
import { useDimLegend } from '../hooks/useDimLegend'

interface Props {
  series: ChartSeries[]
  period: number
  availablePeriods?: number[]
  onPeriodChange: (period: number) => void
}

function spanMonths(points: ReturnPoint[]): number {
  if (points.length < 2) return 0
  const first = points[0]!.date.split('-').map(Number)
  const last = points[points.length - 1]!.date.split('-').map(Number)
  return (last[0]! - first[0]!) * 12 + (last[1]! - first[1]!)
}

/** Chu kỳ rolling, đơn vị tháng kèm nhãn hiển thị. */
const PERIODS = [
  { value: 6, label: '6 tháng' },
  { value: 12, label: '1 năm' },
  { value: 24, label: '2 năm' },
  { value: 36, label: '3 năm' },
  { value: 48, label: '4 năm' },
  { value: 60, label: '5 năm' },
  { value: 72, label: '6 năm' },
  { value: 84, label: '7 năm' },
  { value: 96, label: '8 năm' },
  { value: 108, label: '9 năm' },
  { value: 120, label: '10 năm' },
] as const

function periodLabel(months: number): string {
  return PERIODS.find(p => p.value === months)?.label ?? `${months} tháng`
}

interface RollingStats {
  count: number
  independentWindows: number
  mean: number
  median: number
  p10: number
  p90: number
  min: number
  max: number
}

/** Thống kê của một chuỗi rolling return (đơn vị thập phân, 0.05 = 5%). */
function computeRollingStats(data: ReturnPoint[], period: number): RollingStats {
  const values = data.map(p => p.value)
  const sorted = [...values].sort((a, b) => a - b)
  const count = sorted.length
  if (count === 0) {
    return { count: 0, independentWindows: 0, mean: 0, median: 0, p10: 0, p90: 0, min: 0, max: 0 }
  }
  const sum = values.reduce((acc, v) => acc + v, 0)
  return {
    count,
    independentWindows: countIndependentWindows(spanMonths(data) + period, period),
    mean: sum / count,
    median: percentileSorted(sorted, 0.5),
    p10: percentileSorted(sorted, 0.1),
    p90: percentileSorted(sorted, 0.9),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  }
}

function fmtPct(v: number): string {
  return formatPercent(v)
}

export function RollingReturnChart({ series, period, availablePeriods, onPeriodChange }: Props) {
  const seriesKey = series.map(s => s.name).join(',')
  const { handleLegendClick, isDimmed } = useDimLegend(seriesKey)

  const data = mergeAllSeries(series)

  const available = availablePeriods
    ? new Set(availablePeriods)
    : new Set(PERIODS.map(p => p.value))

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Rolling Returns ({periodLabel(period)})</h3>
        <div className="rolling-period-buttons">
          {PERIODS.map(p => {
            const hasData = available.has(p.value)
            return (
              <button
                key={p.value}
                className={`period-btn ${p.value === period ? 'period-btn-active' : ''} ${hasData ? '' : 'period-btn-disabled'}`}
                disabled={!hasData}
                title={hasData ? undefined : `Chưa đủ dữ liệu để tính chu kỳ ${p.label}`}
                onClick={() => onPeriodChange(p.value)}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>
      {data.length === 0 ? (
        <div className="chart-empty">
          Chưa đủ dữ liệu cho chu kỳ {periodLabel(period)}. Hãy chọn chu kỳ ngắn hơn hoặc khoảng thời gian rộng hơn.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              ticks={getYearTicks(data)}
              tickFormatter={ts => formatYear(ts)}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              tickFormatter={v => formatPercent(v, 0)}
              tick={{ fontSize: 12 }}
              width={60}
            />
            <Tooltip
              formatter={(value: number, name: string) => {
                if (isDimmed(name)) return []
                return formatPercentFull(value)
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
              y={0}
              stroke={BASELINE_COLOR}
              strokeDasharray="6 3"
              strokeWidth={1.5}
            />
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
                  isAnimationActive={false}
                />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      )}
      {data.length > 0 && (
        <>
          <RollingStatsTable series={series} period={period} />
          <RollingReturnsNote />
        </>
      )}
    </div>
  )
}

function RollingReturnsNote() {
  return (
    <div className="rolling-note">
      <p>
        Lợi nhuận cuốn chiếu ra đời để làm nổi bật một chuyện: tần suất và biên độ của
        những chu kỳ sinh lời tốt nhất lẫn tệ nhất của một khoản đầu tư. Cách đo này
        mang lại cái nhìn toàn diện về lịch sử hiệu suất của quỹ, không bị các kết quả
        ngắn hạn gần nhất kéo lệch, như thời điểm chốt sổ cuối tháng hay cuối quý.
      </p>
      <p>
        Ví dụ, lợi nhuận cuốn chiếu 5 năm của năm 2015 là kết quả đo từ ngày 1/1/2011
        đến ngày 31/12/2015. Tương tự, lợi nhuận cuốn chiếu 5 năm của năm 2016 là mức
        sinh lời bình quân hàng năm từ 2012 đến hết năm 2016.
      </p>
      <p>
        Nhờ vậy, bạn hiểu rõ hơn hiệu quả thật của quỹ tại từng thời điểm. Một khoản
        đầu tư báo tỷ suất sinh lời 9%/năm suốt 10 năm chỉ có nghĩa: nếu bạn mua vào
        ngày 1/1 năm đầu và bán vào ngày 31/12 năm thứ 10, bạn nhận được mức lãi tương
        đương 9% mỗi năm. Nhưng bức tranh bên trong 10 năm đó có thể rất dữ dội.
      </p>
      <p>
        Khoản đầu tư ấy có thể tăng vọt 35% vào năm thứ 4, rồi sụt 17% vào năm thứ 8.
        Trung bình vẫn là 9% mỗi năm, nhưng con số bình quân ấy che đậy đi rủi ro và
        sự trồi sụt thực tế của tài sản.
      </p>
      <p>
        Thay vì đo máy móc từ ngày 1/1 đến 31/12, lợi nhuận cuốn chiếu trượt khung
        thời gian liên tục: từ 1/2 năm nay đến 31/1 năm sau, rồi từ 1/3 năm nay đến
        28/2 năm sau, và cứ thế. Bằng cách trượt liên tục, lợi nhuận cuốn chiếu 10 năm
        phơi bày trọn vẹn những khoảng thời gian tỏa sáng rực rỡ nhất lẫn tồi tệ nhất
        của khoản đầu tư.
      </p>
    </div>
  )
}

function RollingStatsTable({ series, period }: { series: ChartSeries[]; period: number }) {
  const rows = series.map(s => {
    const stats = computeRollingStats(s.data, period)
    const distribution = rollingReturnDistribution(s.data.map(p => p.value))
    return { name: s.name, color: s.color, stats, distribution }
  })

  // Đo vị trí cột "Âm" (cột đầu của nhóm Phân bổ) để đặt vạch ngăn cách chạy
  // suốt chiều cao bảng, không bị đứt đoạn giữa các hàng.
  const amRef = useRef<HTMLSpanElement>(null)
  const [dividerLeft, setDividerLeft] = useState<number | null>(null)
  useLayoutEffect(() => {
    const am = amRef.current
    if (!am) return
    const update = () => setDividerLeft(am.offsetLeft)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return (
    <div className="cmp-table cmp-table--rolling">
      {dividerLeft !== null && (
        <span className="cmp-table--rolling__divider" style={{ left: dividerLeft }} />
      )}
      <div className="cmp-table-row cmp-table-head cmp-table-group-head">
        <span>Quỹ</span>
        <span className="cmp-group-title">Thống Kê Tỷ Suất Sinh Lợi (%)</span>
        <span className="cmp-group-title">Phân bổ lợi nhuận (% số lần xuất hiện)</span>
      </div>
      <div className="cmp-table-row cmp-table-head cmp-table-head--rolling">
        <span>Quỹ</span>
        <span>Thấp nhất</span>
        <span>P10</span>
        <span>Trung vị</span>
        <span>P90</span>
        <span>Cao nhất</span>
        <span ref={amRef}>Âm</span>
        <span>0–5%</span>
        <span>5–10%</span>
        <span>10–20%</span>
        <span>&gt;20%</span>
      </div>
      {rows.map(r => (
        <div key={r.name} className="cmp-table-row cmp-table-row--rolling">
          <span className="cmp-fund-cell">
            <span className="cmp-swatch" style={{ background: r.color }} />
            <span>
              <strong>{r.name}</strong>
              <small className="rolling-sample-count">
                {r.stats.count} cửa sổ · {r.stats.independentWindows} cửa sổ độc lập
              </small>
            </span>
          </span>
          {r.stats.count === 0 ? (
            <span className="cmp-underwater">Chưa đủ dữ liệu</span>
          ) : (
            <>
              <span className="cmp-num-neg">{fmtPct(r.stats.min)}</span>
              <span>{fmtPct(r.stats.p10)}</span>
              <span className="cmp-num-strong">{fmtPct(r.stats.median)}</span>
              <span>{fmtPct(r.stats.p90)}</span>
              <span>{fmtPct(r.stats.max)}</span>
              <span className={r.distribution[0]! > 0 ? 'cmp-num-neg' : undefined}>
                {fmtPct(r.distribution[0]!)}
              </span>
              <span>{fmtPct(r.distribution[1]!)}</span>
              <span>{fmtPct(r.distribution[2]!)}</span>
              <span>{fmtPct(r.distribution[3]!)}</span>
              <span>{fmtPct(r.distribution[4]!)}</span>
            </>
  )}
        </div>
      ))}
    </div>
  )
}
