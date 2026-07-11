import { memo } from 'react'

interface StatsRow {
  id: string
  name: string
  color: string
  finalValue: number
  totalInvested: number
  cagr: number | null
  mwrr: number | null
  maxDrawdown: number | null
  profitFactor: number | null
}

interface Props {
  portfolios: StatsRow[]
}

/** Bảng thống kê ngang: mỗi danh mục 1 hàng, các chỉ số nằm cạnh nhau để dễ so sánh — bổ sung cho dca-summary-grid (dạng thẻ dọc) ở trên. */
function DCAStatsTableImpl({ portfolios }: Props) {
  if (portfolios.length === 0) return null

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Bảng thống kê</h3>
        <span
          className="chart-tooltip-icon"
          title="Tổng hợp các chỉ số hiệu suất của từng danh mục trên cùng 1 hàng để dễ so sánh."
        >?</span>
      </div>
      <div className="dca-stats-table-scroll">
        <table className="dca-stats-table">
          <thead>
            <tr>
              <th>Danh mục</th>
              <th>Giá trị cuối kỳ</th>
              <th>Tổng đầu tư</th>
              <th>Lợi nhuận tích lũy</th>
              <th>CAGR</th>
              <th>MWRR</th>
              <th>Sụt giảm tối đa</th>
              <th>Profit Factor</th>
            </tr>
          </thead>
          <tbody>
            {portfolios.map(p => {
              const cumReturn = p.totalInvested > 0 ? p.finalValue / p.totalInvested - 1 : null
              return (
                <tr key={p.id}>
                  <td className="dca-stats-td-name">
                    <span className="perf-dot" style={{ background: p.color }} />
                    {p.name}
                  </td>
                  <td>{formatVND(Math.round(p.finalValue))}</td>
                  <td>{formatVND(p.totalInvested)}</td>
                  <td className={signClass(cumReturn)}>{formatSignedPercent(cumReturn)}</td>
                  <td className={signClass(p.cagr)}>{formatSignedPercent(p.cagr)}</td>
                  <td className={signClass(p.mwrr)}>{formatSignedPercent(p.mwrr)}</td>
                  <td className={p.maxDrawdown !== null && p.maxDrawdown < 0 ? 'dca-loss' : ''}>
                    {p.maxDrawdown !== null ? (p.maxDrawdown * 100).toFixed(2) + '%' : '—'}
                  </td>
                  <td className={p.profitFactor !== null ? (p.profitFactor >= 1 ? 'dca-profit' : 'dca-loss') : ''}>
                    {p.profitFactor !== null ? p.profitFactor.toFixed(2) + '×' : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export const DCAStatsTable = memo(DCAStatsTableImpl)

function signClass(v: number | null): string {
  if (v === null) return ''
  return v >= 0 ? 'dca-profit' : 'dca-loss'
}

function formatSignedPercent(v: number | null): string {
  if (v === null) return '—'
  const pct = v * 100
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
}

function formatVND(value: number): string {
  return Math.round(value).toLocaleString('vi-VN') + ' đ'
}
