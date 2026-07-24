import { memo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, LabelList,
} from 'recharts'

export interface RiskContribItem {
  name: string
  btcWeight: number      // 0–1
  btcRiskPct: number     // 0–1
  fundWeight: number     // 0–1
  fundRiskPct: number    // 0–1
}

interface Props {
  data: RiskContribItem[]
  fundId: string
}

const BTC_WEIGHT_COLOR  = '#264653'
const BTC_RISK_COLOR    = '#2a9d8f'
const FUND_WEIGHT_COLOR = '#e9c46a'
const FUND_RISK_COLOR   = '#f4a261'

function RiskContributionChartImpl({ data, fundId }: Props) {
  if (data.length === 0) return null

  const chartData = data.map(d => ({
    name: d.name,
    'Tỷ trọng Bitcoin': +(d.btcWeight * 100).toFixed(2),
    'Đóng góp Bitcoin': +(d.btcRiskPct * 100).toFixed(2),
    [`Tỷ trọng ${fundId}`]: +(d.fundWeight * 100).toFixed(2),
    [`Đóng góp ${fundId}`]: +(d.fundRiskPct * 100).toFixed(2),
  }))

  const fundWeightKey = `Tỷ trọng ${fundId}`
  const fundRiskKey = `Đóng góp ${fundId}`

  // Takeaway: find portfolio with highest BTC weight (non-zero) to compute risk/weight ratio
  const btcPortfolios = data.filter(d => d.btcWeight > 0)
  const highlight = btcPortfolios.length > 0
    ? btcPortfolios.reduce((a, b) => (a.btcWeight > b.btcWeight ? a : b))
    : null
  const riskMultiplier = highlight && highlight.btcWeight > 0
    ? highlight.btcRiskPct / highlight.btcWeight
    : 0

  return (
    <div className="perf-table-container">
      <div className="chart-header">
        <h3>Đóng góp vào biến động danh mục</h3>
        <span
          className="chart-tooltip-icon"
          title="So sánh tỷ trọng vốn với phần trăm đóng góp vào biến động (rủi ro) tổng thể của danh mục. Bitcoin dù chiếm tỷ trọng nhỏ nhưng thường đóng góp phần lớn rủi ro do biến động giá cao. Tính toán dựa trên covariance matrix của lợi nhuận hàng ngày."
        >?</span>
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 20, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis
            tickFormatter={v => v + '%'}
            tick={{ fontSize: 12 }}
            width={50}
            domain={[0, 'auto']}
          />
          <Tooltip formatter={(v: number) => v.toFixed(1) + '%'} />
          <Legend />
          <Bar dataKey="Tỷ trọng Bitcoin" fill={BTC_WEIGHT_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <LabelList
              dataKey="Tỷ trọng Bitcoin"
              position="top"
              formatter={(v: number) => v.toFixed(1) + '%'}
              style={{ fontSize: 10, fill: '#264653', fontWeight: 600 }}
            />
          </Bar>
          <Bar dataKey="Đóng góp Bitcoin" fill={BTC_RISK_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <LabelList
              dataKey="Đóng góp Bitcoin"
              position="top"
              formatter={(v: number) => v.toFixed(1) + '%'}
              style={{ fontSize: 10, fill: '#2a9d8f', fontWeight: 600 }}
            />
          </Bar>
          <Bar dataKey={fundWeightKey} fill={FUND_WEIGHT_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <LabelList
              dataKey={fundWeightKey}
              position="top"
              formatter={(v: number) => v.toFixed(1) + '%'}
              style={{ fontSize: 10, fill: '#c9a227', fontWeight: 600 }}
            />
          </Bar>
          <Bar dataKey={fundRiskKey} fill={FUND_RISK_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <LabelList
              dataKey={fundRiskKey}
              position="top"
              formatter={(v: number) => v.toFixed(1) + '%'}
              style={{ fontSize: 10, fill: '#c07030', fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {highlight && riskMultiplier > 1 && (
        <div className="chart-takeaway chart-takeaway--orange">
          <span className="chart-takeaway-icon">⚠️</span>
          <div className="chart-takeaway-body">
            Ở danh mục <strong>{highlight.name}</strong>, Bitcoin chỉ chiếm
            {' '}<strong>{(highlight.btcWeight * 100).toFixed(1)}%</strong> vốn nhưng
            đóng góp <strong>{(highlight.btcRiskPct * 100).toFixed(1)}%</strong> biến
            động danh mục, <strong>gấp {riskMultiplier.toFixed(1)}×</strong> tỷ trọng vốn.
            {' '}Đây là đánh đổi cần hiểu khi thêm Bitcoin: tỷ trọng nhỏ nhưng "gánh"
            phần lớn rủi ro.
          </div>
        </div>
      )}
    </div>
  )
}

export const RiskContributionChart = memo(RiskContributionChartImpl)
