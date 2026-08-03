import { useState, type CSSProperties } from 'react'
import type { MonthlyReturn } from '../types'

interface MonthlyHeatmapSeries {
  name: string
  color: string
  data: MonthlyReturn[]
}

interface Props {
  series: MonthlyHeatmapSeries[]
}

const MONTH_LABELS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12']

/**
 * Màu nền ô theo lợi nhuận tháng. Đỏ khi âm, xanh khi dương, độ đậm tỉ lệ với
 * độ lớn. Dùng màu pastel để chữ trên ô vẫn đọc được.
 */
function cellStyle(value: number): CSSProperties {
  const maxScale = 0.12 // từ ngưỡng này màu chạm đậm tối đa
  if (value >= 0) {
    const t = Math.min(value / maxScale, 1)
    const r = Math.round(240 - 215 * t)
    const g = Math.round(240 - 55 * t)
    const b = Math.round(240 - 185 * t)
    return { backgroundColor: `rgb(${r}, ${g}, ${b})` }
  }
  const t = Math.min(-value / maxScale, 1)
  const g = Math.round(240 - 205 * t)
  const b = Math.round(240 - 205 * t)
  return { backgroundColor: `rgb(255, ${g}, ${b})` }
}

function textColor(value: number): string {
  return Math.abs(value) >= 0.12 ? '#fff' : '#1f2937'
}

export function MonthlyHeatmap({ series }: Props) {
  // Quỹ đang xem. Mặc định quỹ đầu tiên, bấm legend để đổi.
  const [selected, setSelected] = useState(0)

  if (series.length === 0) return null
  const active = Math.min(selected, series.length - 1)
  const fund = series[active]!
  const { data } = fund

  // Gom theo năm, xếp năm gần nhất lên đầu (mới nhất → cũ nhất)
  const yearMap = new Map<number, MonthlyReturn[]>()
  for (const m of data) {
    const group = yearMap.get(m.year)
    if (group) group.push(m)
    else yearMap.set(m.year, [m])
  }
  const years = Array.from(yearMap.keys()).sort((a, b) => b - a)

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Lợi nhuận theo tháng (heatmap)</h3>
        <span className="chart-tooltip-icon" title="Mỗi ô là lợi nhuận của một tháng dương lịch. Xanh khi lời, đỏ khi lỗ, càng đậm càng mạnh. Bấm tên quỹ để đổi quỹ đang xem.">?</span>
      </div>

      {series.length > 1 && (
        <div className="hm-fund-tabs">
          {series.map((s, i) => (
            <button
              key={s.name}
              className={`hm-fund-tab${i === active ? ' hm-fund-tab--active' : ''}`}
              onClick={() => setSelected(i)}
              style={i === active ? { borderColor: s.color, color: s.color } : undefined}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="hm-scroll">
        <div className="hm-grid" style={{ gridTemplateColumns: '52px repeat(12, 1fr)' }}>
          <div />
          {MONTH_LABELS.map(m => (
            <div key={m} className="hm-col-header">{m}</div>
          ))}
          {years.map(year => (
            <div key={year} style={{ display: 'contents' }}>
              <div className="hm-row-header">{year}</div>
              {MONTH_LABELS.map((_, mi) => {
                const month = data.find(m => m.year === year && m.month === mi + 1)
                if (!month) {
                  return (
                    <div
                      key={mi}
                      className="hm-cell hm-cell--na"
                      title="Không có dữ liệu tháng này: hoặc quỹ chưa ra đời, hoặc nằm ngoài khoảng thời gian đã chọn"
                    >·</div>
                  )
                }
                const style = cellStyle(month.value)
                return (
                  <div
                    key={mi}
                    className={`hm-cell${month.isPartial ? ' hm-cell--partial' : ''}`}
                    style={style}
                    title={`${month.year}/${month.month} → ${(month.value * 100).toFixed(1)}%${month.isPartial ? ' (tháng chưa trọn)' : ''}`}
                  >
                    <span style={{ color: textColor(month.value) }}>
                      {(month.value * 100).toFixed(1)}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="hm-legend">
        <span className="hm-legend-label">Lỗ</span>
        <span className="hm-legend-swatch hm-legend-swatch--neg3" />
        <span className="hm-legend-swatch hm-legend-swatch--neg2" />
        <span className="hm-legend-swatch hm-legend-swatch--neg1" />
        <span className="hm-legend-swatch hm-legend-swatch--zero" />
        <span className="hm-legend-swatch hm-legend-swatch--pos1" />
        <span className="hm-legend-swatch hm-legend-swatch--pos2" />
        <span className="hm-legend-swatch hm-legend-swatch--pos3" />
        <span className="hm-legend-label">Lời</span>
        <span className="hm-legend-unit">(0–12%+ mỗi tháng)</span>
      </div>
    </div>
  )
}
