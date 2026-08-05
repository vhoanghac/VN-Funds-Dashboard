import { memo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { CompoundInterestPoint } from '../../utils/calculators'
import { formatVNDAxis, formatVNDFull } from '../../utils/vndFormat'

/**
 * Biểu đồ lãi kép: hai lớp chồng lên nhau, dưới là tiền bạn đầu tư, trên là phần
 * lãi sinh ra. Tổng hai lớp là giá trị danh mục.
 *
 * Chồng lớp thay vì vẽ hai đường riêng vì thứ đáng nhìn ở đây là lúc nào phần lãi
 * bắt đầu vượt phần vốn. Nhìn hai đường cắt nhau thì phải tự trừ trong đầu, còn
 * nhìn hai mảng thì thấy ngay mảng nào dày hơn.
 */
const MAU_VON = '#8b8a83'
const MAU_LAI = '#c96442'

interface TooltipProps {
  active?: boolean
  payload?: Array<{ payload: CompoundInterestPoint }>
}

function CustomTooltip({ active, payload }: TooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  const tyLeLai = point.finalValue > 0 ? (point.interestEarned / point.finalValue) * 100 : 0
  return (
    <div className="custom-tooltip">
      <p className="ct-date">Năm thứ {point.year}</p>
      <p style={{ color: MAU_VON }}>Tiền bạn đầu tư: {formatVNDFull(point.contributions)}</p>
      <p style={{ color: MAU_LAI }}>Lãi kép sinh ra: {formatVNDFull(point.interestEarned)}</p>
      <p style={{ fontWeight: 600 }}>Tổng: {formatVNDFull(point.finalValue)}</p>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Lãi chiếm {tyLeLai.toFixed(1).replace('.', ',')}% danh mục
      </p>
    </div>
  )
}

interface Props {
  series: CompoundInterestPoint[]
}

function CompoundInterestChartImpl({ series }: Props) {
  if (series.length < 2) return null

  // Năm đầu tiên phần lãi vượt phần vốn. Không phải lúc nào cũng có, góp thêm
  // hàng tháng nhiều thì vốn luôn dày hơn lãi.
  const namLaiVuotVon = series.find(p => p.interestEarned > p.contributions)?.year

  return (
    <div className="calc-chart">
      <div className="chart-header">
        <h3>Tăng trưởng tài sản</h3>
        <span
          className="chart-tooltip-icon"
          title="Mảng xám phía dưới là tiền chính bạn đầu tư, gồm vốn ban đầu và tiền góp thêm hàng tháng. Mảng cam phía trên là phần lãi kép sinh ra. Càng về sau mảng cam càng dày, đó là lúc tiền tự đẻ ra tiền nhiều hơn phần bạn nạp vào."
        >?</span>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={series} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 11 }}
            tickFormatter={y => (y === 0 ? 'Bắt đầu' : `${y}n`)}
          />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={formatVNDAxis} width={62} />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="contributions"
            stackId="tong"
            stroke={MAU_VON}
            fill={MAU_VON}
            fillOpacity={0.35}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="interestEarned"
            stackId="tong"
            stroke={MAU_LAI}
            fill={MAU_LAI}
            fillOpacity={0.45}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="calc-legend">
        <span className="calc-legend-item">
          <span className="calc-legend-swatch" style={{ background: MAU_VON, opacity: 0.55 }} />
          Tiền bạn đầu tư
        </span>
        <span className="calc-legend-item">
          <span className="calc-legend-swatch" style={{ background: MAU_LAI, opacity: 0.65 }} />
          Lãi kép sinh ra
        </span>
      </div>

      {namLaiVuotVon !== undefined && (
        <p className="calc-note">
          Từ năm thứ <strong>{namLaiVuotVon}</strong> trở đi, phần lãi dày hơn phần vốn bạn đầu tư.
          Trước mốc đó tiền lớn chậm tới mức dễ nản. Lãi kép trả công cho người ngồi yên được lâu,
          không trả công cho người nạp nhiều.
        </p>
      )}
    </div>
  )
}

export const CompoundInterestChart = memo(CompoundInterestChartImpl)
