/**
 * ProjectionBlock: "Nếu bạn tiếp tục DCA thêm X năm nữa?"
 *
 * Chiếu về tương lai dựa trên CAGR lịch sử + lịch nạp tiền hiện tại.
 * 3 scenario: pessimistic (CAGR − 3%), base (CAGR), optimistic (CAGR + 3%).
 *
 * Đây KHÔNG phải dự báo. Là thought experiment để user thấy magnitude của
 * compound interest khi giữ kỷ luật DCA trong nhiều năm. Phải có disclaimer.
 *
 * Mental model: retail VN hay nghĩ "đầu tư 5 năm là dài". Thực tế chứng khoán
 * là trò chơi 20-30 năm. Block này cho user một góc nhìn về thời gian đúng.
 */
import { useState, memo } from 'react'
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, ReferenceLine,
} from 'recharts'
import { formatVND } from '../utils/vndFormat'
import { MoneyInput } from './MoneyInput'

export interface ProjectionPortfolio {
  id: string
  name: string
  color: string
  totalInvested: number
  finalValue: number
  /** CAGR đã quy năm từ backtest, dùng làm base rate cho projection */
  cagr: number | null
  /** Số tiền nạp mỗi tháng (ước lượng từ lịch nạp thực tế) */
  monthlyContribution: number
}

interface Props {
  portfolios: ProjectionPortfolio[]
}

const HORIZON_OPTIONS = [5, 10, 20, 30]

function ProjectionBlockImpl({ portfolios }: Props) {
  const [years, setYears] = useState<number>(10)
  const [contribOverride, setContribOverride] = useState<number | null>(null)

  if (portfolios.length === 0) return null

  // Chỉ project được cho portfolio có CAGR dương và > 0
  const valid = portfolios.filter(p => p.cagr !== null && p.finalValue > 0)
  if (valid.length === 0) return null

  // Mặc định = số tiền đầu tư định kỳ thật (ở phần "Thông số" trên đầu tab).
  // Override ở đây chỉ đổi giả định cho TƯƠNG LAI, không đụng tới lịch sử/giá
  // trị hiện tại của danh mục — trả lời "nếu tôi tăng tiền đầu tư từ nay".
  const defaultContribution = valid[0]?.monthlyContribution ?? 0
  const effectiveContribution = contribOverride ?? defaultContribution

  return (
    <div className="dca-projection-block">
      <h3 className="dca-projection-title">Nếu bạn kiên trì thêm nhiều năm nữa thì sao?</h3>
      <p className="dca-projection-sub">
        Giả sử bạn vẫn đều đặn nạp tiền mỗi tháng như bây giờ, và CAGR tương lai loanh
        quanh mức lịch sử. Đây không phải là dự báo, không ai biết trước thị trường sẽ
        đi đâu. Chỉ là để bạn cảm nhận sức nặng của lãi kép khi chơi đủ lâu.
      </p>

      <div className="dca-projection-controls">
        <span className="dca-projection-controls-label">Chiếu về:</span>
        {HORIZON_OPTIONS.map(h => (
          <button
            key={h}
            className={`dca-projection-btn${h === years ? ' dca-projection-btn--active' : ''}`}
            onClick={() => setYears(h)}
          >
            {h} năm nữa
          </button>
        ))}
      </div>

      <div className="dca-projection-controls">
        <span className="dca-projection-controls-label">Nạp/tháng:</span>
        <MoneyInput
          value={effectiveContribution}
          onChange={setContribOverride}
          className="dca-projection-custom-input"
        />
        {contribOverride !== null && contribOverride !== defaultContribution && (
          <button className="dca-projection-btn" onClick={() => setContribOverride(null)}>
            ↺ Về mặc định ({formatVND(defaultContribution)})
          </button>
        )}
      </div>
      <div className="dca-projection-hint">
        Mặc định đúng bằng số tiền đầu tư định kỳ ở phần "Thông số" phía trên. Chỉnh số ở đây
        chỉ thay đổi giả định cho tương lai — không ảnh hưởng tới lịch sử hay giá trị danh mục
        hiện tại.
      </div>

      {valid.map(p => (
        <ProjectionForPortfolio key={p.id} portfolio={p} years={years} monthlyContribution={effectiveContribution} />
      ))}

      <div className="dca-projection-disclaimer">
        ⚠️ Thị trường không bao giờ đi thẳng như một đường kẻ. Có những năm sập sâu,
        có những năm bùng mạnh. Biểu đồ trên chỉ minh họa lãi kép theo CAGR trung bình.
        Thực tế sẽ dao động lớn hơn nhiều, và kết quả của bạn có thể lệch xa cả ba kịch
        bản này. Hãy xem đây là "nếu thì", không phải "sẽ là".
      </div>
    </div>
  )
}

export const ProjectionBlock = memo(ProjectionBlockImpl)

function ProjectionForPortfolio({
  portfolio,
  years,
  monthlyContribution,
}: {
  portfolio: ProjectionPortfolio
  years: number
  monthlyContribution: number
}) {
  const cagr = portfolio.cagr ?? 0
  const baseRate = cagr
  const pessRate = cagr - 0.03
  const optRate = cagr + 0.03

  const monthlyContrib = monthlyContribution
  const months = years * 12

  // Simulate month by month: value_next = value_now * (1 + monthly_rate) + monthly_contrib
  function project(annualRate: number): { month: number; value: number }[] {
    const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1
    const series: { month: number; value: number }[] = []
    let v = portfolio.finalValue
    series.push({ month: 0, value: v })
    for (let m = 1; m <= months; m++) {
      v = v * (1 + monthlyRate) + monthlyContrib
      series.push({ month: m, value: v })
    }
    return series
  }

  const basePts = project(baseRate)
  const pessPts = project(pessRate)
  const optPts = project(optRate)

  const data = basePts.map((b, i) => ({
    month: b.month,
    base: b.value,
    pess: pessPts[i]!.value,
    opt: optPts[i]!.value,
  }))

  const finalBase = basePts[basePts.length - 1]!.value
  const finalPess = pessPts[pessPts.length - 1]!.value
  const finalOpt = optPts[optPts.length - 1]!.value
  const totalContribFuture = monthlyContrib * months
  const totalInvestedEnd = portfolio.totalInvested + totalContribFuture
  const growthBase = finalBase - totalInvestedEnd

  return (
    <div className="dca-projection-card">
      <div className="dca-projection-card-header">
        <span style={{ color: portfolio.color, fontWeight: 700 }}>{portfolio.name}</span>
        <span className="dca-projection-card-cagr">
          CAGR lịch sử: {(cagr * 100).toFixed(1)}%/năm
        </span>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={(m) => `${Math.round(m / 12)}y`}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            ticks={[0, 12, 24, 36, 48, 60, 120, 180, 240, 300, 360].filter(t => t <= months)}
          />
          <YAxis
            tickFormatter={(v) => formatMillions(v)}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            width={56}
          />
          <Tooltip
            labelFormatter={(m: number) => `Tháng ${m} (năm ${(m / 12).toFixed(1)})`}
            formatter={(v: number, name: string) => [formatVND(Math.round(v)), renderScenario(name)]}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <ReferenceLine x={0} stroke="#9ca3af" strokeDasharray="2 2" label={{ value: 'Hiện tại', fontSize: 10, fill: '#6b7280', position: 'top' }} />
          <Line type="monotone" dataKey="opt" stroke="#10b981" strokeWidth={1.5} dot={false} strokeDasharray="4 2" isAnimationActive={false} />
          <Line type="monotone" dataKey="base" stroke={portfolio.color} strokeWidth={2.2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="pess" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 2" isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>

      <div className="dca-projection-legend">
        <span className="dca-projection-legend-item">
          <span className="dca-projection-swatch" style={{ background: '#10b981' }} />
          Tốt ({((cagr + 0.03) * 100).toFixed(1)}%/năm): {formatVND(Math.round(finalOpt))}
        </span>
        <span className="dca-projection-legend-item">
          <span className="dca-projection-swatch" style={{ background: portfolio.color }} />
          Base ({(cagr * 100).toFixed(1)}%/năm): <strong>{formatVND(Math.round(finalBase))}</strong>
        </span>
        <span className="dca-projection-legend-item">
          <span className="dca-projection-swatch" style={{ background: '#ef4444' }} />
          Xấu ({((cagr - 0.03) * 100).toFixed(1)}%/năm): {formatVND(Math.round(finalPess))}
        </span>
      </div>

      <div className="dca-projection-takeaway">
        Danh mục <strong>{portfolio.name}</strong> hiện có giá trị{' '}
        <strong>{formatVND(Math.round(portfolio.finalValue))}</strong> — đây là điểm xuất phát,
        không phải bắt đầu từ 0 đồng. Nếu CAGR giữ được mức lịch sử{' '}
        <strong>{(cagr * 100).toFixed(1)}%/năm</strong> và
        bạn vẫn đều đặn nạp <strong>{formatVND(Math.round(monthlyContrib))}/tháng</strong>,
        sau <strong>{years} năm nữa</strong> danh mục có thể chạm{' '}
        <strong>{formatVND(Math.round(finalBase))}</strong>. Trong đó bạn chỉ nạp thêm{' '}
        {formatVND(Math.round(totalContribFuture))}, phần còn lại{' '}
        {formatVND(Math.round(growthBase))} là tiền đẻ tiền nhờ lãi kép. Đó là lý do vì
        sao đầu tư là cuộc chơi của thời gian, không phải của canh đỉnh canh đáy.
      </div>
    </div>
  )
}

function renderScenario(key: string): string {
  if (key === 'base') return 'Base'
  if (key === 'opt') return 'Tốt'
  if (key === 'pess') return 'Xấu'
  return key
}

function formatMillions(v: number): string {
  if (Math.abs(v) >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + 'B'
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(0) + 'M'
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(0) + 'K'
  return v.toString()
}
