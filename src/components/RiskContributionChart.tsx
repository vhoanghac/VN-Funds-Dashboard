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

const BTC_WEIGHT_COLOR = '#FCD34D'
const BTC_RISK_COLOR   = '#F97316'
const FUND_WEIGHT_COLOR = '#CBD5E1'
const FUND_RISK_COLOR   = '#64748B'

export function RiskContributionChart({ data, fundId }: Props) {
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

  return (
    <div className="perf-table-container">
      <div className="chart-header">
        <h3>Đóng góp vào biến động danh mục</h3>
        <span
          className="chart-tooltip-icon"
          title="So sánh tỷ trọng vốn với phần trăm đóng góp vào biến động (rủi ro) tổng thể của danh mục. Bitcoin dù chiếm tỷ trọng nhỏ nhưng thường đóng góp phần lớn rủi ro do biến động giá cao. Tính toán dựa trên covariance matrix của lợi nhuận tuần."
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
          <Bar dataKey="Tỷ trọng Bitcoin" fill={BTC_WEIGHT_COLOR} radius={[3, 3, 0, 0]}>
            <LabelList
              dataKey="Tỷ trọng Bitcoin"
              position="top"
              formatter={(v: number) => v.toFixed(1) + '%'}
              style={{ fontSize: 10, fill: '#92400E', fontWeight: 600 }}
            />
          </Bar>
          <Bar dataKey="Đóng góp Bitcoin" fill={BTC_RISK_COLOR} radius={[3, 3, 0, 0]}>
            <LabelList
              dataKey="Đóng góp Bitcoin"
              position="top"
              formatter={(v: number) => v.toFixed(1) + '%'}
              style={{ fontSize: 10, fill: '#9A3412', fontWeight: 600 }}
            />
          </Bar>
          <Bar dataKey={fundWeightKey} fill={FUND_WEIGHT_COLOR} radius={[3, 3, 0, 0]}>
            <LabelList
              dataKey={fundWeightKey}
              position="top"
              formatter={(v: number) => v.toFixed(1) + '%'}
              style={{ fontSize: 10, fill: '#64748B', fontWeight: 600 }}
            />
          </Bar>
          <Bar dataKey={fundRiskKey} fill={FUND_RISK_COLOR} radius={[3, 3, 0, 0]}>
            <LabelList
              dataKey={fundRiskKey}
              position="top"
              formatter={(v: number) => v.toFixed(1) + '%'}
              style={{ fontSize: 10, fill: '#334155', fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
