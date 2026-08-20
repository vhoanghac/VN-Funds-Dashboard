import { memo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import type { ChartSeries, FundMeta, ReturnPoint } from '../types'
import { formatVND, formatVNDFull } from '../utils/vndFormat'
import { getYearTicks, formatYear, formatTooltipDate } from '../utils/chartPlumbing'

export interface AssetPriceSeries extends ChartSeries {
  assetId: string
  secondaryData?: ReturnPoint[]
}

interface Props {
  series: AssetPriceSeries[]
  metadata: FundMeta[]
}

const SELL_LINE_COLOR = '#d97706'

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
  const [logScale, setLogScale] = useState(false)
  const [zoomedScale, setZoomedScale] = useState(false)
  const [showSpread, setShowSpread] = useState(false)
  if (series.length === 0) return null

  const single = series.length === 1
  const hasDualPrice = series.some(s => s.secondaryData !== undefined && s.secondaryData.length > 0)

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>{single ? 'Giá tài sản' : 'Giá từng tài sản'}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hasDualPrice && (
            <>
              <button
                className={`log-scale-btn${zoomedScale ? ' log-scale-btn-active' : ''}`}
                onClick={() => setZoomedScale(v => !v)}
                aria-pressed={zoomedScale}
              >
                Giãn trục
              </button>
              <button
                className={`log-scale-btn${showSpread ? ' log-scale-btn-active' : ''}`}
                onClick={() => setShowSpread(v => !v)}
                aria-pressed={showSpread}
              >
                Chênh lệch
              </button>
            </>
          )}
          <button
            className={`log-scale-btn${logScale ? ' log-scale-btn-active' : ''}`}
            onClick={() => setLogScale(v => !v)}
            aria-pressed={logScale}
            title="Log scale"
          >
            Log
          </button>
          <span
            className="chart-tooltip-icon"
            title="Giá thực tế của một đơn vị tài sản (chứng chỉ quỹ, lượng vàng, 1 BTC). Mỗi tài sản một trục riêng vì mệnh giá ban đầu và đơn vị của chúng khác nhau, đặt chung một trục sẽ gây hiểu nhầm. Muốn so sánh hiệu suất thì xem chart Lợi nhuận tích lũy bên dưới."
          >?</span>
        </div>
      </div>

      {single ? (
        <PricePanel
          series={series[0]!}
          metadata={metadata}
          height={300}
          logScale={logScale}
          zoomedScale={zoomedScale}
          showSpread={showSpread}
        />
      ) : (
        <div className="price-chart-grid">
          {series.map(s => (
            <PricePanel
              key={s.name}
              series={s}
              metadata={metadata}
              height={220}
              logScale={logScale}
              zoomedScale={zoomedScale}
              showSpread={showSpread}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export const AssetPriceChart = memo(AssetPriceChartImpl)

function PricePanel({
  series, metadata, height, logScale, zoomedScale, showSpread,
}: {
  series: AssetPriceSeries
  metadata: FundMeta[]
  height: number
  logScale: boolean
  zoomedScale: boolean
  showSpread: boolean
}) {
  const meta = metadata.find(m => m.id === series.assetId)
  const hasSecondary = series.secondaryData !== undefined && series.secondaryData.length > 0
  const secondaryByDate = new Map(series.secondaryData?.map(p => [p.date, p.value]) ?? [])
  const data = series.data.map(p => ({
    timestamp: new Date(p.date).getTime(),
    value: p.value,
    secondaryValue: secondaryByDate.get(p.date),
    spreadValue: secondaryByDate.has(p.date) ? secondaryByDate.get(p.date)! - p.value : undefined,
  }))

  const showSpreadLine = showSpread && hasSecondary
  const last = data[data.length - 1]
  const lastValue = showSpreadLine ? last?.spreadValue : last?.value
  const yDomain = zoomedScale
    ? zoomedYDomain(data, showSpreadLine ? 'spreadValue' : 'all')
    : ['auto', 'auto'] as ['auto', 'auto']

  return (
    <div className="price-chart-panel">
      <div className="price-chart-panel-head">
        <span className="price-chart-panel-title" style={{ color: series.color }}>
          {series.name}
        </span>
        <span className="price-chart-panel-unit">
          {lastValue !== undefined && `${formatVNDFull(lastValue)} / ${unitOf(meta)}`}
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
            scale={logScale ? 'log' : 'auto'}
            domain={yDomain}
            tickFormatter={formatVND}
            tick={{ fontSize: 12 }}
            width={58}
          />
          <Tooltip
            formatter={(value: number, name: string) => [
              `${formatVNDFull(value)} / ${unitOf(meta)}`,
              name,
            ]}
            labelFormatter={formatTooltipDate}
          />
          <Legend />
          {!showSpreadLine && (
            <Line
              type="monotone"
              dataKey="value"
              name={hasSecondary ? 'Giá mua vào' : series.name}
              stroke={series.color}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}
          {hasSecondary && !showSpreadLine && (
            <Line
              type="monotone"
              dataKey="secondaryValue"
              name="Giá bán ra"
              stroke={SELL_LINE_COLOR}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}
          {showSpreadLine && (
            <Line
              type="monotone"
              dataKey="spreadValue"
              name="Chênh lệch (bán - mua)"
              stroke={series.color}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function zoomedYDomain(
  data: Array<{ value: number; secondaryValue?: number; spreadValue?: number }>,
  mode: 'all' | 'spreadValue',
): [number, number] {
  const values = data.flatMap(point => {
    if (mode === 'spreadValue') return point.spreadValue === undefined ? [] : [point.spreadValue]
    return [point.value, point.secondaryValue].filter((value): value is number => value !== undefined)
  })
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]

  const span = max - min
  const padding = span > 0 ? span * 0.02 : Math.max(max * 0.01, 1)
  return [Math.max(0, min - padding), max + padding]
}

/** Đơn vị của một đơn vị tài sản, để người xem biết con số đang đếm cái gì. */
function unitOf(meta: FundMeta | undefined): string {
  if (meta?.type === 'gold') return 'lượng'
  if (meta?.type === 'crypto') return 'coin'
  return 'CCQ'
}
