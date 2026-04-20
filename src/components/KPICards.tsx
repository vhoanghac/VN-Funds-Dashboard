import type { KPIData } from '../types'

interface FundKPI {
  name: string
  color: string
  kpi: KPIData
}

interface Props {
  funds: FundKPI[]
  dcaMode?: boolean
}

const TOOLTIPS: Record<string, string | undefined> = {
  cagr: 'Lợi nhuận bình quân hằng năm (CAGR): tốc độ tăng trưởng trung bình mỗi năm nếu giữ quỹ trong suốt khoảng thời gian.',
  maxDrawdown: 'Mức sụt giảm tối đa: mức giảm lớn nhất tính từ đỉnh, cho thấy rủi ro lớn nhất khi đầu tư.',
  rollingAvg: 'Trung bình lợi nhuận quy năm theo chu kỳ 12 tháng: hiệu suất trung bình nếu giữ quỹ bất kỳ 12 tháng liên tục nào.',
  winRate: 'Tỷ lệ thắng: phần trăm số năm đầy đủ mà quỹ có lợi nhuận cao nhất trong nhóm so sánh.',
}

const DCA_TOOLTIPS: Record<string, string | undefined> = {
  cagr: 'CAGR (TWRR): tốc độ tăng trưởng trung bình mỗi năm của quỹ, bỏ qua dòng tiền DCA. Đây là hiệu suất thuần của quỹ, không phải lợi nhuận thực tế trên tiền bạn đầu tư.',
  maxDrawdown: 'Mức sụt giảm tối đa (TWRR): mức giảm lớn nhất tính từ đỉnh dựa trên hiệu suất thuần của quỹ.',
  rollingAvg: 'TB Rolling 12T (TWRR): hiệu suất trung bình quy năm nếu giữ quỹ bất kỳ 12 tháng liên tục nào, bỏ qua dòng tiền DCA.',
  winRate: 'Tỷ lệ thắng: phần trăm số năm đầy đủ mà quỹ có lợi nhuận cao nhất trong nhóm so sánh.',
}

export function KPICards({ funds, dcaMode }: Props) {
  const tips = dcaMode ? DCA_TOOLTIPS : TOOLTIPS

  return (
    <div className="kpi-grid">
      <KPICard
        title={dcaMode ? 'CAGR (TWRR)' : 'CAGR'}
        tooltip={tips.cagr}
        funds={funds}
        getValue={f => f.kpi.cagr}
        format={formatPercent}
        higherIsBetter
      />
      <KPICard
        title="Sụt giảm tối đa"
        tooltip={tips.maxDrawdown}
        funds={funds}
        getValue={f => f.kpi.maxDrawdown}
        format={formatPercent}
        higherIsBetter={false}
      />
      <KPICard
        title="TB Rolling 12T"
        tooltip={tips.rollingAvg}
        funds={funds}
        getValue={f => f.kpi.rollingAvg12M}
        format={formatPercent}
        higherIsBetter
      />
      <KPICard
        title="Tỷ lệ thắng (năm)"
        tooltip={tips.winRate}
        funds={funds}
        getValue={f => f.kpi.winRate}
        format={formatPercent}
        higherIsBetter
      />
    </div>
  )
}

interface CardProps {
  title: string
  tooltip: string | undefined
  funds: FundKPI[]
  getValue: (f: FundKPI) => number | null
  format: (v: number) => string
  higherIsBetter: boolean
}

function KPICard({
  title,
  tooltip,
  funds,
  getValue,
  format,
  higherIsBetter,
}: CardProps) {
  // Find the best value
  const values = funds.map(f => getValue(f))
  let bestIdx = -1

  if (values.every(v => v !== null)) {
    // For drawdown: higher (closer to 0) is better
    const isDrawdown = title === 'Sụt giảm tối đa'
    const better = isDrawdown || higherIsBetter
      ? Math.max(...(values as number[]))
      : Math.min(...(values as number[]))
    bestIdx = values.indexOf(better)
  }

  return (
    <div className="kpi-card">
      <div className="kpi-title">
        {title}
        <span className="kpi-tooltip" title={tooltip}>?</span>
      </div>
      <div className="kpi-values">
        {funds.map((f, i) => (
          <div key={f.name} className={`kpi-value ${i === bestIdx ? 'kpi-winner' : ''}`}>
            <span className="kpi-fund-name" style={{ color: f.color }}>{f.name}</span>
            <span className="kpi-number">
              {values[i] !== null ? format(values[i]!) : 'N/A'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatPercent(value: number): string {
  return (value * 100).toFixed(2) + '%'
}
