import { memo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { ChartSeries, FundMeta } from '../types'
import { formatVND, formatVNDFull } from '../utils/vndFormat'

interface Props {
  series: ChartSeries[]
  metadata: FundMeta[]
}

/**
 * Giá tuyệt đối của từng tài sản.
 *
 * Một tài sản thì một chart rộng. Từ hai tài sản trở lên thì tách thành các
 * chart nhỏ, MỖI TÀI SẢN MỘT TRỤC RIÊNG, cố ý không vẽ chung.
 *
 * Lý do không gộp: quỹ nào cũng phát hành lần đầu ở mệnh giá 10.000 đ, nên giá
 * một chứng chỉ chỉ nói lên quỹ đó ra đời sớm hay muộn, không nói quỹ nào tốt
 * hơn. Thêm nữa đơn vị khác nhau (đ/CCQ, đ/lượng vàng, đ/BTC) và chênh nhau tới
 * hàng chục nghìn lần, vẽ chung một trục thì mọi đường trừ đường lớn nhất đều
 * nằm bẹp. Muốn so sánh thì đã có chart Lợi nhuận tích lũy, nó quy về phần trăm.
 */
function AssetPriceChartImpl({ series, metadata }: Props) {
  if (series.length === 0) return null

  const single = series.length === 1

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>{single ? 'Giá tài sản' : 'Giá từng tài sản'}</h3>
        <span
          className="chart-tooltip-icon"
          title="Giá thực tế của một đơn vị tài sản (chứng chỉ quỹ, lượng vàng, 1 BTC). Mỗi tài sản một trục riêng vì mệnh giá ban đầu và đơn vị của chúng khác nhau, đặt chung một trục sẽ gây hiểu nhầm. Muốn so sánh hiệu suất thì xem chart Lợi nhuận tích lũy bên dưới."
        >?</span>
      </div>

      {single ? (
        <PricePanel series={series[0]!} metadata={metadata} height={300} />
      ) : (
        <div className="price-chart-grid">
          {series.map(s => (
            <PricePanel key={s.name} series={s} metadata={metadata} height={220} />
          ))}
        </div>
      )}
    </div>
  )
}

export const AssetPriceChart = memo(AssetPriceChartImpl)

function PricePanel({
  series, metadata, height,
}: { series: ChartSeries; metadata: FundMeta[]; height: number }) {
  const meta = metadata.find(m => m.id === series.name)
  const data = series.data.map(p => ({
    timestamp: new Date(p.date).getTime(),
    value: p.value,
  }))

  const last = data[data.length - 1]?.value

  return (
    <div className="price-chart-panel">
      <div className="price-chart-panel-head">
        <span className="price-chart-panel-title" style={{ color: series.color }}>
          {series.name}
        </span>
        <span className="price-chart-panel-unit">
          {last !== undefined && `${formatVNDFull(last)} / ${unitOf(meta)}`}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
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
            domain={['auto', 'auto']}
            tickFormatter={formatVND}
            tick={{ fontSize: 12 }}
            width={58}
          />
          <Tooltip
            formatter={(value: number) => [`${formatVNDFull(value)} / ${unitOf(meta)}`, series.name]}
            labelFormatter={formatTooltipDate}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={series.color}
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Đơn vị của một đơn vị tài sản, để người xem biết con số đang đếm cái gì. */
function unitOf(meta: FundMeta | undefined): string {
  if (meta?.type === 'gold') return 'lượng'
  if (meta?.type === 'crypto') return 'coin'
  return 'CCQ'
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

function formatTooltipDate(ts: number): string {
  const d = new Date(ts)
  const dd = d.getDate().toString().padStart(2, '0')
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}
