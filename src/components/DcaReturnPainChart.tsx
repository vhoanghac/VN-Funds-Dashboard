/**
 * DcaReturnPainChart: "Bản đồ lợi nhuận và rủi ro"
 *
 * Ý tưởng mượn từ các bài backtest kiểu Pramana: một biểu đồ scatter duy
 * nhất, trục ngang là mức sụt giảm tối đa (drawdown, càng sang phải càng
 * đau), trục dọc là tổng lợi nhuận (số lần nhân vốn, log scale). Mỗi danh
 * mục là một chấm. Góc trên-trái là vùng lý tưởng: lợi nhuận cao mà ít đau,
 * thường trống vì không có bữa trưa miễn phí trong đầu tư.
 */
import { useState, memo } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

export interface ReturnPainPortfolio {
  id: string
  name: string
  color: string
  finalValue: number
  totalInvested: number
  /** % sụt giảm tối đa, số âm (vd -42.09) */
  maxDrawdown: number
}

interface Props {
  portfolios: ReturnPainPortfolio[]
}

interface ScatterPoint {
  id: string
  name: string
  color: string
  pain: number
  returnX: number
  returnPct: number
  /** Lợi nhuận (%) đổi lấy mỗi 1% sụt giảm phải chịu, càng cao càng hiệu quả */
  efficiency: number
}

function DcaReturnPainChartImpl({ portfolios }: Props) {
  const [logScale, setLogScale] = useState(true)

  const eligible = portfolios.filter(p => p.totalInvested > 0)
  if (eligible.length === 0) return null

  const data: ScatterPoint[] = eligible.map(p => {
    const pain = Math.abs(p.maxDrawdown)
    const returnX = p.finalValue / p.totalInvested
    const returnPct = (returnX - 1) * 100
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      pain,
      returnX,
      returnPct,
      efficiency: pain > 0 ? returnPct / pain : returnPct,
    }
  })

  const narrative = data.length >= 2 ? buildNarrative(data) : null

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>Bản đồ lợi nhuận và rủi ro</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className={`log-scale-btn${logScale ? ' log-scale-btn-active' : ''}`}
            onClick={() => setLogScale(v => !v)}
            title="Chuyển trục dọc sang logarithmic. Hữu ích khi các danh mục có mức nhân vốn chênh lệch lớn."
          >
            Log
          </button>
          <span
            className="chart-tooltip-icon"
            title="Trục ngang: mức sụt giảm sâu nhất so với đỉnh (drawdown), càng sang phải càng đau. Trục dọc: tổng số lần nhân vốn. Góc trên-trái là vùng lý tưởng: lợi nhuận cao mà ít đau."
          >?</span>
        </div>
      </div>

      <p className="dca-ratio-sub">
        Mỗi chấm là một danh mục, đặt lợi nhuận cạnh cái giá phải trả để có được nó.
        Trục ngang là mức sụt giảm sâu nhất so với đỉnh trong suốt kỳ, càng sang phải
        càng đau. Trục dọc là tổng số lần nhân vốn. Góc trên-trái (lợi nhuận cao, ít
        đau) gần như luôn trống, vì muốn lợi nhuận cao hơn thường phải chịu biến động
        lớn hơn.
      </p>

      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ top: 20, right: 30, left: 10, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            type="number"
            dataKey="pain"
            domain={[0, (max: number) => Math.ceil((max + 5) / 10) * 10]}
            tickFormatter={(v: number) => `-${v.toFixed(0)}%`}
            tick={{ fontSize: 12 }}
            label={{ value: 'Sụt giảm tối đa (sâu hơn →)', position: 'insideBottom', offset: -14, fontSize: 12, fill: '#5e5d59' }}
          />
          <YAxis
            type="number"
            dataKey="returnX"
            scale={logScale ? 'log' : 'auto'}
            domain={logScale ? [(min: number) => Math.max(0.5, min * 0.85), (max: number) => max * 1.15] : ['auto', 'auto']}
            allowDataOverflow={false}
            tickFormatter={(v: number) => formatMultiple(v)}
            tick={{ fontSize: 12 }}
            width={60}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null
              const p = payload[0].payload as ScatterPoint
              return (
                <div style={{ background: '#fff', border: '1px solid #e8e6dc', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
                  <strong style={{ color: p.color }}>{p.name}</strong>
                  <div>Tổng lợi nhuận: {formatMultiple(p.returnX)} (+{((p.returnX - 1) * 100).toFixed(0)}%)</div>
                  <div>Sụt giảm tối đa: -{p.pain.toFixed(1)}%</div>
                </div>
              )
            }}
          />
          <Scatter data={data} shape={renderPoint} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>

      {narrative && (
        <p className="dca-ratio-narrative">
          <strong style={{ color: narrative.bestReturn.color }}>{narrative.bestReturn.name}</strong>{' '}
          đang có lợi nhuận cao nhất trong nhóm, +{narrative.bestReturn.returnPct.toFixed(0)}%, đổi lại
          mức sụt giảm tối đa -{narrative.bestReturn.pain.toFixed(1)}%.
          {' '}
          {narrative.safest.id !== narrative.bestReturn.id && (
            <>
              <strong style={{ color: narrative.safest.color }}>{narrative.safest.name}</strong>{' '}
              là danh mục ít đau nhất, sụt giảm tối đa chỉ -{narrative.safest.pain.toFixed(1)}%, nhưng
              đổi lại lợi nhuận thấp hơn.
              {' '}
            </>
          )}
          {narrative.tradeoff && (
            <>
              So với <strong style={{ color: narrative.bestReturn.color }}>{narrative.bestReturn.name}</strong>,{' '}
              <strong style={{ color: narrative.tradeoff.point.color }}>{narrative.tradeoff.point.name}</strong>{' '}
              giữ được khoảng {narrative.tradeoff.captureUps.toFixed(0)}% lợi nhuận trong khi né được{' '}
              {narrative.tradeoff.painAvoided.toFixed(0)}% mức sụt giảm, một đánh đổi đáng cân nhắc nếu
              bạn ưu tiên sự yên tâm hơn lợi nhuận tối đa.
              {' '}
            </>
          )}
          Giả sử bạn đang phải chọn giữa các danh mục này, câu hỏi không phải "cái nào lời nhất" mà là
          "bạn chịu được mức đau nào". Đã gọi là đầu tư thì sẽ luôn có rủi ro, và quá khứ không đảm bảo
          cho tương lai.
        </p>
      )}
    </div>
  )
}

export const DcaReturnPainChart = memo(DcaReturnPainChartImpl)

interface ReturnPainNarrative {
  bestReturn: ScatterPoint
  safest: ScatterPoint
  bestEfficiency: ScatterPoint
  /** Đánh đổi lợi nhuận/rủi ro của danh mục hiệu quả nhất so với danh mục lời nhất */
  tradeoff: { point: ScatterPoint; captureUps: number; painAvoided: number } | null
}

/**
 * Tìm danh mục lời nhất, ít đau nhất, và hiệu quả nhất (lời/đau) để kể chuyện.
 * "Upside capture / pain avoided" mượn từ cách trình bày của Pramana: so
 * bestEfficiency với bestReturn xem giữ được bao nhiêu % lợi nhuận (theo
 * thang log, công bằng hơn % tuyệt đối) và né được bao nhiêu % cú đau.
 * Chỉ tính khi đó là 2 danh mục khác nhau, nếu không sẽ ra 100%/0% vô nghĩa.
 */
function buildNarrative(data: ScatterPoint[]): ReturnPainNarrative {
  const bestReturn = data.reduce((a, b) => (b.returnPct > a.returnPct ? b : a))
  const safest = data.reduce((a, b) => (b.pain < a.pain ? b : a))
  const bestEfficiency = data.reduce((a, b) => (b.efficiency > a.efficiency ? b : a))

  let tradeoff: ReturnPainNarrative['tradeoff'] = null
  if (bestEfficiency.id !== bestReturn.id && bestReturn.returnX > 1 && bestReturn.pain > 0) {
    tradeoff = {
      point: bestEfficiency,
      captureUps: (Math.log(Math.max(bestEfficiency.returnX, 1.0001)) / Math.log(bestReturn.returnX)) * 100,
      painAvoided: (1 - bestEfficiency.pain / bestReturn.pain) * 100,
    }
  }

  return { bestReturn, safest, bestEfficiency, tradeoff }
}

function renderPoint(props: { cx?: number; cy?: number; payload?: ScatterPoint }) {
  const { cx, cy, payload } = props
  if (cx === undefined || cy === undefined || !payload) return <g />
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill={payload.color} stroke="#fff" strokeWidth={1.5} />
      <text
        x={cx}
        y={cy - 13}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fill={payload.color}
        stroke="#fff"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {payload.name}
      </text>
    </g>
  )
}

function formatMultiple(v: number): string {
  return `${v.toFixed(1)}×`
}
