/**
 * MonteCarloBlock: "Trong 1.000 kịch bản dựa trên lịch sử, bạn đạt mục tiêu bao
 * nhiêu % số lần?"
 *
 * Khác với ProjectionBlock (chiếu tương lai bằng CAGR tĩnh —
 * đúng 3 kịch bản Xấu/Base/Tốt cố định), block này dùng block-bootstrap: xáo
 * trộn ngẫu nhiên các khối 12-tháng lợi nhuận lịch sử THẬT của chính danh mục
 * (giữ nguyên thứ tự bên trong khối để bảo toàn phần nào momentum/tự tương
 * quan thật), nối lại thành 1.000 kịch bản tương lai khác nhau. Kết quả là một
 * PHÂN PHỐI (fan chart + xác suất đạt mục tiêu) thay vì một con số duy nhất —
 * đúng tinh thần "không hứa, chỉ nói xác suất lịch sử" của toàn dashboard.
 *
 * Xem utils/dca.ts: dcaMonthlyReturns() + monteCarloProjection().
 */
import { useMemo, useState, memo } from 'react'
import {
  Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, LineChart, ReferenceLine,
} from 'recharts'
import {
  dcaMonthlyReturns, histogramBuckets, monteCarloProjection, probabilityAtLeast,
  type MonteCarloRepresentativePath, type MonteCarloResult,
} from '../utils/dca'
import { formatVND } from '../utils/vndFormat'
import { MoneyInput } from './MoneyInput'
import type { ReturnPoint } from '../types'

export interface MonteCarloPortfolio {
  id: string
  name: string
  color: string
  finalValue: number
  monthlyContribution: number
  cumulative: ReturnPoint[]
  /** CAGR lịch sử (TWRR) của chính giai đoạn dùng làm pool bootstrap — chỉ để đối chiếu, không dùng trong phép tính Monte Carlo. */
  cagr: number | null
}

interface Props {
  portfolios: MonteCarloPortfolio[]
}

const YEAR_OPTIONS = [5, 10, 15, 20, 25, 30]
const ITERATIONS = 1000
const BLOCK_SIZE = 12

const PRESET_TARGETS = [
  { label: '1 tỷ', value: 1_000_000_000 },
  { label: '2 tỷ', value: 2_000_000_000 },
  { label: '3 tỷ', value: 3_000_000_000 },
]

function MonteCarloBlockImpl({ portfolios }: Props) {
  const [target, setTarget] = useState<number>(1_000_000_000)
  const [years, setYears] = useState<number>(10)
  const [customInput, setCustomInput] = useState<string>('')
  const [customError, setCustomError] = useState<string | null>(null)
  const [contribOverride, setContribOverride] = useState<number | null>(null)
  const [detailPortfolioId, setDetailPortfolioId] = useState<string | null>(null)
  const [resampleVersion, setResampleVersion] = useState(0)

  if (portfolios.length === 0) return null

  const applyCustom = () => {
    if (!customInput.trim()) {
      setCustomError(null)
      return
    }
    const n = parseCustomTarget(customInput)
    if (n === null) {
      setCustomError('Không đọc được số. Thử: 500tr, 1.5 tỷ, 2 tỉ, 1500000000')
      return
    }
    setTarget(n)
    setCustomError(null)
  }

  const activePreset = PRESET_TARGETS.find(p => p.value === target)
  // Mặc định = số tiền đầu tư định kỳ thật (ở phần "Thông số" trên đầu tab).
  // Override ở đây chỉ đổi giả định cho TƯƠNG LAI, không đụng tới lịch sử/giá
  // trị hiện tại của danh mục — trả lời "nếu tôi tăng tiền đầu tư từ nay".
  const defaultContribution = portfolios[0]?.monthlyContribution ?? 0
  const effectiveContribution = contribOverride ?? defaultContribution
  const detailPortfolio = portfolios.find(p => p.id === detailPortfolioId) ?? portfolios[0]!

  return (
    <div className="dca-mc-block">
      <h3 className="dca-mc-title">Dựa trên {ITERATIONS.toLocaleString('vi-VN')} kịch bản trong quá khứ, khả năng bạn đạt mục tiêu là:</h3>
      <p className="dca-mc-sub">
        Thay vì 3 kịch bản Xấu/Base/Tốt cố định ở trên, cách này lấy nguyên các đoạn 12 tháng
        đã từng xảy ra thật trong lịch sử quỹ — ví dụ đúng 12 tháng của một năm khủng hoảng,
        hay 12 tháng của một năm tăng đều — rồi ghép ngẫu nhiên nhiều đoạn như vậy theo thứ tự
        khác nhau, tạo ra <strong>{ITERATIONS.toLocaleString('vi-VN')}</strong> kịch bản tương
        lai khác nhau. Diễn biến thật bên trong mỗi đoạn 12 tháng không đổi, chỉ có thứ tự các
        đoạn ghép lại là xáo trộn ngẫu nhiên.
      </p>

      <div className="dca-mc-current">
        Danh mục <strong style={{ color: detailPortfolio.color }}>{detailPortfolio.name}</strong> hiện có giá trị{' '}
        <strong>{formatVND(Math.round(detailPortfolio.finalValue))}</strong>.
      </div>

      <div className="dca-mc-controls">
        <div className="dca-mc-control-row">
          <span className="dca-mc-control-label">Mục tiêu:</span>
          {PRESET_TARGETS.map(p => (
            <button
              key={p.value}
              className={`dca-mc-btn${target === p.value ? ' dca-mc-btn--active' : ''}`}
              onClick={() => { setTarget(p.value); setCustomInput(''); setCustomError(null) }}
            >
              {p.label}
            </button>
          ))}
          <div className="dca-mc-custom">
            <input
              type="text"
              className="dca-mc-custom-input"
              placeholder="hoặc nhập (vd: 500tr, 1.5 tỷ)"
              value={customInput}
              onChange={(e) => setCustomInput(formatCustomInput(e.target.value))}
              onBlur={applyCustom}
              onKeyDown={(e) => { if (e.key === 'Enter') applyCustom() }}
            />
          </div>
        </div>
        {customError && (
          <div className="dca-mc-custom-error">{customError}</div>
        )}

        <div className="dca-mc-control-row">
          <span className="dca-mc-control-label">Trong:</span>
          {YEAR_OPTIONS.map(y => (
            <button
              key={y}
              className={`dca-mc-btn${years === y ? ' dca-mc-btn--active' : ''}`}
              onClick={() => setYears(y)}
            >
              {y} năm
            </button>
          ))}
        </div>

        <div className="dca-mc-control-row">
          <span className="dca-mc-control-label">Đầu tư/tháng:</span>
          <MoneyInput
            value={effectiveContribution}
            onChange={setContribOverride}
            className="dca-mc-custom-input"
          />
          {contribOverride !== null && contribOverride !== defaultContribution && (
            <button className="dca-mc-btn" onClick={() => setContribOverride(null)}>
              ↺ Về mặc định ({formatVND(defaultContribution)})
            </button>
          )}
        </div>
        <div className="dca-mc-hint">
          Mặc định đúng bằng số tiền đầu tư định kỳ ở phần "Thông số" phía trên. Chỉnh số ở đây
          chỉ thay đổi giả định cho tương lai — không ảnh hưởng tới lịch sử hay giá trị danh mục
          hiện tại.
        </div>

        <div className="dca-mc-current">
          Mục tiêu đang chọn: <strong>{formatVND(target)}</strong>
          {activePreset ? '' : ' (tùy chọn)'} sau <strong>{years} năm</strong>
        </div>

        <div className="dca-mc-detail-control">
          {portfolios.length > 1 && (
            <label>
              Xem chi tiết:
              <select
                value={detailPortfolio.id}
                onChange={e => setDetailPortfolioId(e.target.value)}
              >
                {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <button className="dca-mc-btn" onClick={() => setResampleVersion(v => v + 1)}>
            ↻ Lấy mẫu lại
          </button>
        </div>
      </div>

      <MonteCarloForPortfolio
        portfolio={detailPortfolio}
        target={target}
        years={years}
        monthlyContribution={effectiveContribution}
        resampleVersion={resampleVersion}
      />

      <div className="dca-mc-disclaimer">
        ⚠️ Đây KHÔNG phải dự báo. Thị trường không bao giờ đi thẳng như một đường kẻ — có những
        năm sập sâu, có những năm bùng mạnh. Mỗi kịch bản chỉ là một cách sắp xếp lại các giai
        đoạn 12 tháng đã từng xảy ra trong lịch sử quỹ — tương lai thật có thể tệ hơn mọi kịch
        bản đã thấy (khủng hoảng chưa từng có), hoặc tốt hơn. Quỹ có lịch sử càng ngắn, phân
        phối này càng kém tin cậy vì cùng vài giai đoạn bị lặp lại nhiều lần trong 1.000 kịch
        bản. Hãy xem đây là "nếu thì", không phải "sẽ là".
      </div>
    </div>
  )
}

export const MonteCarloBlock = memo(MonteCarloBlockImpl)

function MonteCarloForPortfolio({
  portfolio,
  target,
  years,
  monthlyContribution,
  resampleVersion,
}: {
  portfolio: MonteCarloPortfolio
  target: number
  years: number
  monthlyContribution: number
  resampleVersion: number
}) {
  const monthlyPool = useMemo(
    () => dcaMonthlyReturns(portfolio.cumulative).map(r => r.value),
    [portfolio.cumulative],
  )

  const result = useMemo(() => {
    if (monthlyPool.length < BLOCK_SIZE) return null
    return monteCarloProjection({
      monthlyReturnPool: monthlyPool,
      startValue: portfolio.finalValue,
      monthlyContribution,
      horizonMonths: years * 12,
      iterations: ITERATIONS,
      blockSize: BLOCK_SIZE,
      rng: seededRandom(`${portfolio.id}:${resampleVersion}`),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthlyPool, portfolio.id, portfolio.finalValue, monthlyContribution, years, resampleVersion])

  if (monthlyPool.length < BLOCK_SIZE) {
    return (
      <div className="dca-mc-card">
        <div className="dca-mc-card-header">
          <span style={{ color: portfolio.color, fontWeight: 700 }}>{portfolio.name}</span>
        </div>
        <div className="dca-mc-insufficient">
          Không đủ lịch sử để mô phỏng Monte Carlo (cần ít nhất {BLOCK_SIZE} tháng dữ liệu,
          hiện có {monthlyPool.length} tháng). Chọn khoảng thời gian dài hơn ở phần "Thông số" phía trên.
        </div>
      </div>
    )
  }

  if (!result) return null

  const prob = probabilityAtLeast(result.finalValues, target) * 100
  // Dùng đúng percentile đã tính ở điểm CUỐI path (percentileSorted, nội suy
  // tuyến tính) thay vì tính lại theo cách khác từ finalValues — đảm bảo số
  // trong stat box khớp chính xác với điểm cuối cùng trên fan chart.
  const { p10, p25, p50, p75, p90 } = result.path[result.path.length - 1]!

  // Stacked-area "band" trick: 3 dải xếp chồng, chỉ 2 dải giữa hiển thị màu.
  // Giữ nguyên p10/p25/p75/p90 trong data để custom tooltip đọc lại giá trị thật.
  const chartData = result.path.map(pt => ({
    year: pt.month / 12,
    base: pt.p10,
    toP25: pt.p25 - pt.p10,
    toP75: pt.p75 - pt.p25,
    toP90: pt.p90 - pt.p75,
    p10: pt.p10,
    p25: pt.p25,
    p50: pt.p50,
    p75: pt.p75,
    p90: pt.p90,
  }))

  const yearTicks = years <= 10
    ? Array.from({ length: years + 1 }, (_, i) => i)
    : Array.from({ length: Math.floor(years / 5) + 1 }, (_, i) => i * 5)

  return (
    <div className="dca-mc-card">
      <div className="dca-mc-card-header">
        <span style={{ color: portfolio.color, fontWeight: 700 }}>{portfolio.name}</span>
        <span className="dca-mc-card-sub">
          {portfolio.cagr !== null && <>CAGR lịch sử: {(portfolio.cagr * 100).toFixed(1)}%/năm · </>}
          {ITERATIONS.toLocaleString('vi-VN')} kịch bản · dựa trên {monthlyPool.length} tháng lịch sử
        </span>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="year"
            tickFormatter={(y) => `${y}y`}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            type="number"
            domain={[0, years]}
            ticks={yearTicks}
          />
          <YAxis
            tickFormatter={(v) => formatMillions(v)}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            width={56}
          />
          <Tooltip content={<MonteCarloTooltip />} />
          <ReferenceLine
            y={target}
            stroke="#6b7280"
            strokeDasharray="4 2"
            label={{ value: `Mục tiêu ${formatMillions(target)}`, fontSize: 10, fill: '#6b7280', position: 'insideTopRight' }}
          />
          <Area dataKey="base" stackId="mc" stroke="none" fill="transparent" isAnimationActive={false} />
          <Area dataKey="toP25" stackId="mc" stroke="none" fill={portfolio.color} fillOpacity={0.12} isAnimationActive={false} />
          <Area dataKey="toP75" stackId="mc" stroke="none" fill={portfolio.color} fillOpacity={0.28} isAnimationActive={false} />
          <Area dataKey="toP90" stackId="mc" stroke="none" fill={portfolio.color} fillOpacity={0.12} isAnimationActive={false} />
          <Line type="monotone" dataKey="p50" stroke={portfolio.color} strokeWidth={2.2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="dca-mc-stats">
        <StatBox label="Xấu" sublabel="P10" value={formatVND(Math.round(p10))} />
        <StatBox label="Hơi xấu" sublabel="P25" value={formatVND(Math.round(p25))} />
        <StatBox label="Trung vị" sublabel="P50" value={formatVND(Math.round(p50))} highlight />
        <StatBox label="Hơi tốt" sublabel="P75" value={formatVND(Math.round(p75))} />
        <StatBox label="Tốt" sublabel="P90" value={formatVND(Math.round(p90))} />
      </div>

      <div className="dca-mc-takeaway">
        Giả sử bạn vẫn đều đặn đầu tư{' '}
        <strong>{formatVND(Math.round(monthlyContribution))}/tháng</strong> như hiện tại,
        sau <strong>{years} năm</strong> nữa: trong {ITERATIONS.toLocaleString('vi-VN')} kịch bản,
        bạn có tỷ lệ <strong>{prob.toFixed(0)}%</strong> đạt được mục tiêu{' '}
        <strong>{formatVND(target)}</strong>. Kịch bản tệ nhất (đáy 10%) chỉ còn{' '}
        <strong>{formatVND(Math.round(p10))}</strong>, kịch bản tốt nhất (đỉnh 90%) lên tới{' '}
        <strong>{formatVND(Math.round(p90))}</strong>.
      </div>

      <MonteCarloDetails portfolio={portfolio} result={result} years={years} />
    </div>
  )
}

const OUTCOME_PERCENTILES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95]

function MonteCarloDetails({
  portfolio,
  result,
  years,
}: {
  portfolio: MonteCarloPortfolio
  result: MonteCarloResult
  years: number
}) {
  const terminalWealthData = OUTCOME_PERCENTILES.map(percentile => ({
    percentile,
    value: percentileValue(result.finalValues, percentile / 100),
  }))

  return (
    <div className="dca-mc-details">
      <div className="dca-mc-detail-heading">
        <h4>Bốn tương lai mẫu</h4>
        <p>
          Mỗi ô là một path thật trong {ITERATIONS.toLocaleString('vi-VN')} kịch bản. P10, P25,
          P50 và P75 lấy theo giá trị tài khoản ở cuối kỳ, không ghép percentile của các tháng khác nhau.
        </p>
      </div>

      <div className="dca-mc-path-grid">
        {result.representativePaths.map(path => (
          <RepresentativePathChart
            key={path.percentile}
            path={path}
            color={portfolio.color}
            years={years}
          />
        ))}
      </div>

      <div className="dca-mc-detail-heading dca-mc-detail-heading--results">
        <h4>Phân phối kết quả</h4>
        <p>
          Ba chart này nhìn toàn bộ {ITERATIONS.toLocaleString('vi-VN')} path. Bốn path ở trên chỉ để xem
          diễn biến cụ thể, không đại diện cho toàn bộ phân phối.
        </p>
      </div>

      <div className="dca-mc-distribution-grid">
        <div className="dca-mc-distribution-card dca-mc-distribution-card--wide">
          <h5>Giá trị tài khoản cuối kỳ theo percentile</h5>
          <p>Số dư sau {years} năm, đã tính khoản nạp đều mỗi tháng.</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={terminalWealthData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis
                dataKey="percentile"
                tickFormatter={v => `P${v}`}
                tick={{ fontSize: 11, fill: '#6b7280' }}
              />
              <YAxis tickFormatter={formatMillions} tick={{ fontSize: 11, fill: '#6b7280' }} width={56} />
              <Tooltip content={<TerminalWealthTooltip />} />
              <Line type="monotone" dataKey="value" stroke={portfolio.color} strokeWidth={2.2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <DistributionChart
          title="Phân phối CAGR"
          description="CAGR đo trên path lợi nhuận. Tiền góp hằng tháng không đi vào công thức này."
          values={result.cagrs}
          color={portfolio.color}
          valueFormatter={formatPercent}
        />

        <DistributionChart
          title="Phân phối mức sụt giảm lớn nhất"
          description="Đo trên path lợi nhuận của danh mục, không phải trên số dư tài khoản."
          values={result.maxDrawdowns}
          color={portfolio.color}
          valueFormatter={formatPercent}
        />
      </div>
    </div>
  )
}

function RepresentativePathChart({
  path,
  color,
  years,
}: {
  path: MonteCarloRepresentativePath
  color: string
  years: number
}) {
  const chartData = path.values.map((value, month) => ({ year: month / 12, value }))
  const labels: Record<number, string> = {
    0.1: 'Xấu',
    0.25: 'Hơi xấu',
    0.5: 'Trung vị',
    0.75: 'Hơi tốt',
  }

  return (
    <div className="dca-mc-path-card">
      <div className="dca-mc-path-header">
        <strong>{labels[path.percentile]} · P{Math.round(path.percentile * 100)}</strong>
        <span>{formatVND(Math.round(path.finalValue))}</span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 2, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="year"
            type="number"
            domain={[0, years]}
            tickFormatter={v => `${v}y`}
            tick={{ fontSize: 10, fill: '#6b7280' }}
            minTickGap={24}
          />
          <YAxis tickFormatter={formatMillions} tick={{ fontSize: 10, fill: '#6b7280' }} width={48} />
          <Tooltip content={<RepresentativePathTooltip />} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="dca-mc-path-metrics">
        <span>CAGR <strong>{formatPercent(path.cagr)}</strong></span>
        <span>Max DD <strong>{formatPercent(path.maxDrawdown)}</strong></span>
      </div>
    </div>
  )
}

function DistributionChart({
  title,
  description,
  values,
  color,
  valueFormatter,
}: {
  title: string
  description: string
  values: number[]
  color: string
  valueFormatter: (value: number) => string
}) {
  const range = Math.max(...values) - Math.min(...values)
  const bucketSize = Math.max(0.02, range / 30)
  const data = histogramBuckets(values, bucketSize).map(bucket => ({
    value: bucket.center,
    share: bucket.count / values.length,
  }))
  const median = percentileValue(values, 0.5)

  return (
    <div className="dca-mc-distribution-card">
      <h5>{title}</h5>
      <p>{description}</p>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="value" tickFormatter={valueFormatter} tick={{ fontSize: 11, fill: '#6b7280' }} minTickGap={28} />
          <YAxis tickFormatter={formatShare} tick={{ fontSize: 11, fill: '#6b7280' }} width={42} />
          <Tooltip content={<DistributionTooltip valueFormatter={valueFormatter} />} />
          <ReferenceLine
            x={median}
            stroke={color}
            strokeDasharray="4 2"
            label={{ value: `Trung vị ${valueFormatter(median)}`, fontSize: 10, fill: color, position: 'insideTopRight' }}
          />
          <Area type="step" dataKey="share" stroke={color} fill={color} fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function StatBox({ label, sublabel, value, highlight }: { label: string; sublabel?: string; value: string; highlight?: boolean }) {
  return (
    <div className={`dca-mc-stat${highlight ? ' dca-mc-stat--highlight' : ''}`}>
      <div className="dca-mc-stat-label">{label}</div>
      {sublabel && <div className="dca-mc-stat-sublabel">{sublabel}</div>}
      <div className="dca-mc-stat-value">{value}</div>
    </div>
  )
}

function formatMillions(v: number): string {
  if (Math.abs(v) >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + 'B'
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(0) + 'M'
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(0) + 'K'
  return v.toString()
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatShare(value: number): string {
  return `${Math.round(value * 100)}%`
}

function percentileValue(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0
  const index = (sortedValues.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sortedValues[lower]!
  const fraction = index - lower
  return sortedValues[lower]! + (sortedValues[upper]! - sortedValues[lower]!) * fraction
}

/** Tạo stream tái lập được: cùng danh mục và lần lấy mẫu luôn ra cùng 1.000 path. */
function seededRandom(key: string): () => number {
  let seed = 2166136261
  for (let i = 0; i < key.length; i++) {
    seed ^= key.charCodeAt(i)
    seed = Math.imul(seed, 16777619)
  }
  return () => {
    seed |= 0
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface McChartRow {
  year: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

/** Tooltip tùy chỉnh: đọc lại p10-p90 thật từ data point thay vì hiện từng dải stacked-area riêng lẻ (vốn vô nghĩa với người dùng). */
function MonteCarloTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { payload: McChartRow }[]
  label?: number
}) {
  if (!active || !payload || payload.length === 0) return null
  const d = payload[0]!.payload
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Năm {label?.toFixed(1)}</div>
      <div>Đáy 10%: {formatVND(Math.round(d.p10))}</div>
      <div>25%: {formatVND(Math.round(d.p25))}</div>
      <div style={{ fontWeight: 700 }}>Trung vị: {formatVND(Math.round(d.p50))}</div>
      <div>75%: {formatVND(Math.round(d.p75))}</div>
      <div>Đỉnh 90%: {formatVND(Math.round(d.p90))}</div>
    </div>
  )
}

function TerminalWealthTooltip({ active, payload }: {
  active?: boolean
  payload?: { payload: { percentile: number; value: number } }[]
}) {
  if (!active || !payload || payload.length === 0) return null
  const data = payload[0]!.payload
  return (
    <div className="dca-mc-tooltip">
      <strong>P{data.percentile}</strong>
      <span>{formatVND(Math.round(data.value))}</span>
    </div>
  )
}

function RepresentativePathTooltip({ active, payload }: {
  active?: boolean
  payload?: { payload: { year: number; value: number } }[]
}) {
  if (!active || !payload || payload.length === 0) return null
  const data = payload[0]!.payload
  return (
    <div className="dca-mc-tooltip">
      <strong>Năm {data.year.toFixed(1)}</strong>
      <span>{formatVND(Math.round(data.value))}</span>
    </div>
  )
}

function DistributionTooltip({
  active,
  payload,
  valueFormatter,
}: {
  active?: boolean
  payload?: { payload: { value: number; share: number } }[]
  valueFormatter: (value: number) => string
}) {
  if (!active || !payload || payload.length === 0) return null
  const data = payload[0]!.payload
  return (
    <div className="dca-mc-tooltip">
      <strong>{valueFormatter(data.value)}</strong>
      <span>{formatShare(data.share)} số path</span>
    </div>
  )
}

/**
 * Tự thêm dấu chấm phân cách hàng nghìn khi người dùng gõ số thuần (vd "5000000"
 * → "5.000.000"), giúp dễ đọc hơn. Nếu chuỗi có chữ (vd "500tr", "1.5 tỷ") thì giữ
 * nguyên — không format, để không phá cú pháp gõ tắt.
 */
function formatCustomInput(raw: string): string {
  const digitsOnly = raw.replace(/\./g, '')
  if (digitsOnly !== '' && /^\d+$/.test(digitsOnly)) {
    return Number(digitsOnly).toLocaleString('de-DE')
  }
  return raw
}

/**
 * Parse free-form input: "500tr", "1.5 tỷ", "2 tỉ", "2000000000", "1,5ty",
 * hoặc số thuần đã tự format dấu chấm hàng nghìn "5.000.000".
 */
function parseCustomTarget(input: string): number | null {
  if (!input) return null
  const s = input.trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '')
  const numMatch = s.match(/([\d.]+)/)
  if (!numMatch) return null
  const hasUnit = /(tỷ|ty|tỉ|ti|triệu|trieu|tr|nghìn|nghin|ngan|ngàn|k|m)/.test(s)
  // Không có đơn vị: dấu chấm là phân cách hàng nghìn (từ auto-format), bỏ hết.
  // Có đơn vị: dấu chấm duy nhất là thập phân (vd "1.5 tỷ"), giữ nguyên.
  const plain = hasUnit ? Number(numMatch[1]!) : Number(numMatch[1]!.replace(/\./g, ''))
  if (isNaN(plain) || plain <= 0) return null

  if (/(tỷ|ty|tỉ|ti)/.test(s)) return plain * 1_000_000_000
  if (/(triệu|trieu|tr|m)/.test(s)) return plain * 1_000_000
  if (/(nghìn|nghin|ngan|ngàn|k)/.test(s)) return plain * 1_000
  return plain
}
