/**
 * RebalanceSensitivityPanel: tab "Độ nhạy tái cân bằng".
 *
 * Ý tưởng từ công cụ Rebalancing Sensitivity của testfol.io: cố định MỘT
 * danh mục (từ 2 quỹ trở lên), rồi chạy nó qua mọi lịch tái cân bằng được
 * hỗ trợ (8 tần suất × mọi offset trong kỳ, kèm biến thể theo ngưỡng lệch
 * và baseline không tái cân bằng) để trả lời câu hỏi: chọn lịch rebalance
 * nào có thực sự thay đổi kết quả không?
 */
import { useState, useMemo, memo } from 'react'
import Select from 'react-select'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import type { FundMeta, PortfolioCardState, PricePoint } from '../types'
import type { DCASlot } from '../utils/dca'
import { useFundSeriesMap } from '../hooks/useFundData'
import { useCommittedRun } from '../hooks/useCommittedRun'
import { alignFundsToCommonGridDaily } from '../utils/weeklyResample'
import {
  runRebalanceSensitivity, summarize, GROUP_LABELS, SCHEDULES,
  type VariantResult, type VariantGroup, type ScheduleId, type BandSweep,
} from '../utils/rebalanceSensitivity'
import { PortfolioCard, portfolioSelectStyles } from './PortfolioCard'
import {
  savingsAssetId,
  SAVINGS_OPTION_LABEL, DEFAULT_SAVINGS_RATE,
} from '../utils/savingsAsset'

interface Props {
  funds: FundMeta[]
}

const GROUP_COLORS: Record<VariantGroup, string> = {
  daily: '#94a3b8',
  weekly: '#0ea5e9',
  monthly: '#059669',
  bimonthly: '#10b981',
  quarterly: '#2563eb',
  every4months: '#8b5cf6',
  semiannual: '#d97706',
  yearly: '#dc2626',
  'band-abs': '#f59e0b',
  'band-rel': '#ec4899',
  none: '#141413',
}

const SCHEDULE_OPTIONS = SCHEDULES.map(s => ({ value: s.id, label: s.label }))

type DateRangeMode = 'all' | 'years'

interface RebalanceParams {
  slots: DCASlot[]
  dateFrom: string
  dateTo: string
  schedules: ScheduleId[]
  absBand: BandSweep | null
  relBand: BandSweep | null
  feePct: number
}

interface RebalanceSnapshot {
  params: RebalanceParams
  data: Map<string, PricePoint[]>
}

function RebalanceSensitivityPanelImpl({ funds }: Props) {
  // ── Thông số ──
  const [dateMode, setDateMode] = useState<DateRangeMode>('all')
  const [yearsBack, setYearsBack] = useState(5)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedSchedules, setSelectedSchedules] = useState<ScheduleId[]>(
    SCHEDULES.map(s => s.id),
  )
  const [includeAbsBands, setIncludeAbsBands] = useState(false)
  const [absSweep, setAbsSweep] = useState<BandSweep>({ start: 1, step: 1, end: 20 })
  const [includeRelBands, setIncludeRelBands] = useState(false)
  const [relSweep, setRelSweep] = useState<BandSweep>({ start: 1, step: 1, end: 20 })
  // Phí giao dịch mỗi lần tái cân bằng, đơn vị % (mặc định 0,1%).
  const [feePct, setFeePct] = useState(0.1)

  // ── Danh mục (đúng 1, tối thiểu 2 quỹ) ──
  const [portfolio, setPortfolio] = useState<PortfolioCardState>(() => ({
    id: 'rebal1',
    num: 1,
    name: 'Danh mục',
    isNameCustom: false,
    slots: [
      { fundId: '', weight: 50 },
      { fundId: '', weight: 50 },
    ],
    rebalFreq: 'quarterly',
  }))

  const fundOptions = useMemo(() => [
    ...funds.map(f => ({ value: f.id, label: f.name_vi })),
    { value: savingsAssetId(DEFAULT_SAVINGS_RATE), label: SAVINGS_OPTION_LABEL },
  ], [funds])

  // Fetch CSV cho các quỹ đã chọn (cùng pipeline adjusted-prices với các tab khác)
  const neededIds = useMemo(() => {
    const ids = new Set<string>()
    for (const s of portfolio.slots) {
      if (s.fundId && s.weight > 0) ids.add(s.fundId)
    }
    return ids
  }, [portfolio.slots])

  const neededIdList = useMemo(() => Array.from(neededIds), [neededIds])
  const { data: fundData, loading, errors } = useFundSeriesMap(neededIdList)

  // ── Validation ──
  const nonZeroSlots = portfolio.slots.filter(s => s.fundId && s.weight > 0)
  const totalWeight = portfolio.slots.reduce((s, f) => s + f.weight, 0)
  const hasVariantSource = selectedSchedules.length > 0 || includeAbsBands || includeRelBands
  const canRun = nonZeroSlots.length >= 2
    && Math.abs(totalWeight - 100) < 0.01
    && hasVariantSource

  // "X năm qua" quy về from/to cụ thể tại thời điểm chạy — cùng cách với tab DCA
  function getEffectiveDates(): { from: string; to: string } {
    if (dateMode === 'years') {
      const now = new Date()
      const from = new Date(now.getFullYear() - yearsBack, now.getMonth(), now.getDate())
      return { from: from.toISOString().substring(0, 10), to: '' }
    }
    return { from: dateFrom, to: dateTo }
  }

  function buildParams(): RebalanceParams {
    const { from, to } = getEffectiveDates()
    return {
      slots: portfolio.slots.map(s => ({ ...s })),
      dateFrom: from,
      dateTo: to,
      schedules: [...selectedSchedules],
      absBand: includeAbsBands ? { ...absSweep } : null,
      relBand: includeRelBands ? { ...relSweep } : null,
      feePct,
    }
  }

  function runAnalysis() {
    if (!canRun) return
    runCommitted()
  }

  // ── Chạy mô phỏng ──
  const liveParams = buildParams()
  const dataReady = Array.from(neededIds).every(id => fundData.has(id))
    && !loading
    && errors.size === 0
  const committedRun = useCommittedRun({
    ready: dataReady,
    valid: canRun,
    liveParams,
    captureSnapshot: (): RebalanceSnapshot => ({
      params: buildParams(),
      data: new Map(fundData),
    }),
    compute: snapshot => {
      const committed = snapshot.params
      const fundData = snapshot.data
      const slots = committed.slots.filter(s => s.fundId && s.weight > 0)
    if (slots.length < 2) return null

    // Cửa sổ chung: bắt đầu muộn nhất, kết thúc sớm nhất giữa các quỹ,
    // sau đó áp thêm khoảng ngày người dùng chọn (nếu có)
    let start = committed.dateFrom || ''
    let end = committed.dateTo || '9999-12-31'
    for (const s of slots) {
      const prices = fundData.get(s.fundId)
      if (!prices || prices.length === 0) return null
      if (prices[0]!.date > start) start = prices[0]!.date
      const last = prices[prices.length - 1]!.date
      if (last < end) end = last
    }
    if (start >= end) return null

    const filtered = new Map<string, PricePoint[]>()
    for (const s of slots) {
      filtered.set(
        s.fundId,
        fundData.get(s.fundId)!.filter(pt => pt.date >= start && pt.date <= end),
      )
    }
    const aligned = alignFundsToCommonGridDaily(filtered)

    return runRebalanceSensitivity({
      alignedPrices: aligned,
      slots,
      schedules: committed.schedules,
      absBand: committed.absBand,
      relBand: committed.relBand,
      feePct: committed.feePct,
    })
    },
  })

  const {
    committed,
    result,
    dirty: isDirty,
    run: runCommitted,
  } = committedRun
  const dataError = Array.from(errors.values())[0] ?? null

  return (
    <div className="simulation-panel">
      <div className="panel-header">
        <h2>Độ Nhạy Tái Cân Bằng</h2>
      </div>

      <div className="rebal-intro-card">
      <p className="dca-ratio-sub">
        Giả sử danh mục của bạn là 50% quỹ A, 50% quỹ B. Theo thời gian, giá 2 quỹ tăng
        khác nhau nên tỷ trọng thực tế sẽ lệch dần khỏi 50/50 (vd 58/42), và "tái cân bằng"
        là hành động bán bớt quỹ đang nhiều, mua thêm quỹ đang ít để đưa về lại đúng mục
        tiêu. Câu hỏi công cụ này trả lời: <strong>tái cân bằng vào lúc nào thì tốt hơn?</strong>{' '}
        Mỗi cách chọn "khi nào tái cân bằng" (vd: cứ mỗi quý một lần, hoặc chỉ khi lệch quá
        5%) gọi là một <strong>biến thể</strong>. Công cụ tự động thử hàng trăm biến thể
        khác nhau trên cùng một danh mục, để xem chọn biến thể nào cũng cho kết quả gần
        giống nhau, hay có biến thể vượt trội hẳn.
      </p>
      </div>

      {/* ── Thông số ── */}
      <div className="dca-params-card">
        <h3 className="dca-section-title">Thông số</h3>

        <div className="dca-param-row">
          <label className="dca-label">Khoảng thời gian</label>
          <div className="dca-date-mode">
            <button
              className={`dca-mode-btn ${dateMode === 'all' ? 'dca-mode-btn-active' : ''}`}
              onClick={() => setDateMode('all')}
            >
              Tất cả
            </button>
            <button
              className={`dca-mode-btn ${dateMode === 'years' ? 'dca-mode-btn-active' : ''}`}
              onClick={() => setDateMode('years')}
            >
              X năm qua
            </button>
          </div>
        </div>

        {dateMode === 'years' && (
          <div className="dca-param-row dca-years-row">
            <label className="dca-label">Số năm</label>
            <div className="dca-years-selector">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <button
                  key={n}
                  className={`dca-year-btn ${yearsBack === n ? 'dca-year-btn-active' : ''}`}
                  onClick={() => setYearsBack(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {dateMode === 'all' && (
          <div className="dca-param-row">
            <label className="dca-label">Từ ngày đến ngày</label>
            <div className="dca-date-inputs">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span className="dca-date-sep">→</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          </div>
        )}

        <div className="dca-param-row">
          <label className="dca-label">Tần suất phân tích</label>
          <div className="rebal-schedule-select">
            <Select
              isMulti
              options={SCHEDULE_OPTIONS}
              value={SCHEDULE_OPTIONS.filter(o => selectedSchedules.includes(o.value))}
              onChange={opts => setSelectedSchedules(opts.map(o => o.value))}
              placeholder="Chọn tần suất..."
              noOptionsMessage={() => 'Không còn tần suất nào'}
              closeMenuOnSelect={false}
              styles={portfolioSelectStyles}
            />
          </div>
        </div>
        <p className="rebal-inline-note">
          Với mỗi tần suất, công cụ không chỉ thử đúng 1 cách mà thử luôn{' '}
          <strong>mọi ngày có thể tái cân bằng trong kỳ</strong>. Ví dụ "Hàng quý" không chỉ
          nghĩa là cân lại đúng ngày cuối quý, mà còn thử cân lại sớm hơn vài ngày, sớm hơn
          vài tuần... mỗi ngày thử là 1 biến thể riêng, để xem chọn đúng ngày trong kỳ có
          quan trọng không.
        </p>

        <div className="dca-param-row">
          <label className="dca-label">Biến thể theo ngưỡng lệch</label>
          <div className="rebal-band-config">
            <div className="rebal-band-row">
              <label className="rebal-check">
                <input
                  type="checkbox"
                  checked={includeAbsBands}
                  onChange={e => setIncludeAbsBands(e.target.checked)}
                />
                Lệch tuyệt đối
              </label>
              <BandSweepInputs
                sweep={absSweep}
                onChange={setAbsSweep}
                disabled={!includeAbsBands}
              />
            </div>
            <p className="rebal-inline-note">
              Bỏ qua lịch cố định, chỉ tái cân bằng khi tỷ trọng một quỹ lệch khỏi mục tiêu
              quá X <strong>điểm phần trăm</strong>. Ví dụ mục tiêu 50%, ngưỡng 5%: chờ đến
              khi tỷ trọng vượt 55% hoặc tụt dưới 45% mới cân lại.
            </p>
            <div className="rebal-band-row">
              <label className="rebal-check">
                <input
                  type="checkbox"
                  checked={includeRelBands}
                  onChange={e => setIncludeRelBands(e.target.checked)}
                />
                Lệch tương đối
              </label>
              <BandSweepInputs
                sweep={relSweep}
                onChange={setRelSweep}
                disabled={!includeRelBands}
              />
            </div>
            <p className="rebal-inline-note">
              Giống lệch tuyệt đối, nhưng ngưỡng tính theo % <strong>CỦA</strong> tỷ trọng
              mục tiêu, không phải điểm phần trăm. Ví dụ mục tiêu 50%, ngưỡng 10%: 10% của
              50% là 5 điểm %, nên cũng chờ đến khi vượt 55% hoặc tụt dưới 45%. Với quỹ có
              tỷ trọng mục tiêu nhỏ (vd 10%), 2 cách này sẽ ra ngưỡng rất khác nhau.
            </p>
          </div>
        </div>

        <div className="dca-param-row">
          <label className="dca-label">Phí giao dịch mỗi lần cân</label>
          <div className="rebal-fee-row">
            <input
              type="range"
              className="scnpath-slider"
              min={0}
              max={3}
              step={0.1}
              value={feePct}
              onChange={e => setFeePct(Number(e.target.value))}
            />
            <span className="rebal-fee-value">{feePct.toFixed(1).replace('.', ',')}%</span>
          </div>
        </div>

        <p className="dca-note">
          * Không cần chọn ngày nếu muốn dùng toàn bộ lịch sử chung của các quỹ. Mô phỏng
          mua một lần, giá đã điều chỉnh cổ tức, chưa tính thuế. Phí giao dịch (nếu đặt lớn
          hơn 0%) trừ trên CẢ chiều mua lẫn bán của phần tài sản lệch tỷ trọng mỗi lần cân,
          và chỉ áp cho các lần tái cân bằng — không tính cho lần mua ban đầu.
        </p>
      </div>

      {/* ── Danh mục ── */}
      <div className="dca-portfolios-card">
        <div className="dca-portfolios-card-header">
          <h3 className="dca-section-title">Danh mục</h3>
        </div>
        <div className="dca-portfolio-grid">
          <PortfolioCard
            portfolio={portfolio}
            pIdx={0}
            funds={funds}
            fundOptions={fundOptions}
            onUpdate={update => setPortfolio(p => ({ ...p, ...update }))}
            onRemove={() => {}}
            onAddSlot={() => setPortfolio(p => ({
              ...p,
              slots: [...p.slots, { fundId: '', weight: 0 }],
            }))}
            onRemoveSlot={idx => setPortfolio(p => ({
              ...p,
              slots: p.slots.length > 2 ? p.slots.filter((_, i) => i !== idx) : p.slots,
            }))}
            onUpdateSlot={(idx, update) => setPortfolio(p => ({
              ...p,
              slots: p.slots.map((s, i) => i === idx ? { ...s, ...update } : s),
            }))}
            onSetEqualWeights={() => setPortfolio(p => {
              const n = p.slots.length
              const w = Math.floor(100 / n)
              const remainder = 100 - w * n
              return {
                ...p,
                slots: p.slots.map((s, i) => ({ ...s, weight: w + (i < remainder ? 1 : 0) })),
              }
            })}
            showRebal={false}
            showRemove={false}
          />
        </div>
        {nonZeroSlots.length < 2 && (
          <p className="dca-note">* Cần ít nhất 2 quỹ có tỷ trọng lớn hơn 0.</p>
        )}
        {!hasVariantSource && (
          <p className="dca-note">
            * Cần chọn ít nhất 1 tần suất phân tích hoặc bật 1 dải ngưỡng lệch.
          </p>
        )}
      </div>

      <div className="btc-run-row">
        <button className="sim-run-btn" onClick={runAnalysis} disabled={!canRun}>
          {committed ? 'Phân tích lại' : 'Phân tích'}
        </button>
        {isDirty && (
          <span className="btc-run-hint">
            Thông số đã thay đổi, bấm "Phân tích lại" để cập nhật kết quả.
          </span>
        )}
      </div>

      {loading && <div className="loading-indicator">Đang tải dữ liệu...</div>}

      {!loading && dataError && (
        <div className="error-banner">{dataError}</div>
      )}

      {committed && !loading && !result && !dataError && (
        <div className="error-banner">
          Không đủ dữ liệu để phân tích. Kiểm tra lại quỹ đã chọn hoặc khoảng thời gian.
        </div>
      )}

      {result && <SensitivityResults result={result} />}
    </div>
  )
}

export const RebalanceSensitivityPanel = memo(RebalanceSensitivityPanelImpl)

/** Chấm nhỏ, mờ nhẹ — hàng trăm biến thể chồng lên nhau nên chấm to sẽ rối mắt. */
function renderSmallDot(props: { cx?: number; cy?: number; fill?: string }) {
  const { cx, cy, fill } = props
  if (cx === undefined || cy === undefined) return <g />
  return <circle cx={cx} cy={cy} r={3.5} fill={fill} fillOpacity={0.75} />
}

/** Bộ 3 ô nhập Từ / Bước / Đến (%) cho một dải ngưỡng band. */
function BandSweepInputs({
  sweep,
  onChange,
  disabled,
}: {
  sweep: BandSweep
  onChange: (s: BandSweep) => void
  disabled: boolean
}) {
  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, isNaN(v) ? min : v))
  return (
    <div className={`rebal-sweep-inputs${disabled ? ' rebal-sweep-inputs--disabled' : ''}`}>
      <label>
        Từ
        <input
          type="number" min={0.5} max={50} step={0.5}
          value={sweep.start}
          disabled={disabled}
          onChange={e => onChange({ ...sweep, start: clamp(Number(e.target.value), 0.5, 50) })}
        />
        %
      </label>
      <label>
        Bước
        <input
          type="number" min={0.5} max={10} step={0.5}
          value={sweep.step}
          disabled={disabled}
          onChange={e => onChange({ ...sweep, step: clamp(Number(e.target.value), 0.5, 10) })}
        />
        %
      </label>
      <label>
        Đến
        <input
          type="number" min={0.5} max={50} step={0.5}
          value={sweep.end}
          disabled={disabled}
          onChange={e => onChange({ ...sweep, end: clamp(Number(e.target.value), 0.5, 50) })}
        />
        %
      </label>
    </div>
  )
}

// ─── Kết quả ─────────────────────────────────────────────

function SensitivityResults({ result }: { result: NonNullable<ReturnType<typeof runRebalanceSensitivity>> }) {
  const { variants, startDate, endDate, years } = result

  const cagrs = variants.map(v => v.cagr)
  const best = variants.reduce((a, b) => (b.cagr > a.cagr ? b : a))
  const worst = variants.reduce((a, b) => (b.cagr < a.cagr ? b : a))
  const spread = (best.cagr - worst.cagr) * 100
  const none = variants.find(v => v.group === 'none')

  // Gom nhóm cho bảng
  const groupOrder: VariantGroup[] = [
    ...SCHEDULES.map(s => s.id),
    'band-abs', 'band-rel', 'none',
  ]
  const groups = groupOrder
    .map(g => ({ group: g, items: variants.filter(v => v.group === g) }))
    .filter(g => g.items.length > 0)

  // Scatter: một series mỗi nhóm để có legend màu
  const scatterSeries = groups.map(g => ({
    group: g.group,
    color: GROUP_COLORS[g.group],
    data: g.items.map(v => ({
      ...v,
      pain: Math.abs(v.maxDrawdown * 100),
      cagrPct: v.cagr * 100,
    })),
  }))

  return (
    <>
      <div className="section-divider">
        <span className="section-divider-label">Kết quả</span>
      </div>

      <div className="comparison-period" style={{ marginBottom: 16 }}>
        Phân tích {variants.length} biến thể tái cân bằng, từ {formatDate(startDate)} đến{' '}
        {formatDate(endDate)} ({years.toFixed(1).replace('.', ',')} năm)
      </div>

      {/* Stat cards */}
      <div className="dca-storm-grid">
        <div className="dca-storm-stat">
          <div className="dca-storm-stat-label">Biến thể tốt nhất</div>
          <div className="dca-storm-stat-value">{(best.cagr * 100).toFixed(2)}%/năm</div>
          <div className="dca-storm-stat-sub">{best.label}</div>
        </div>
        <div className="dca-storm-stat">
          <div className="dca-storm-stat-label">Biến thể tệ nhất</div>
          <div className="dca-storm-stat-value">{(worst.cagr * 100).toFixed(2)}%/năm</div>
          <div className="dca-storm-stat-sub">{worst.label}</div>
        </div>
        <div className="dca-storm-stat">
          <div className="dca-storm-stat-label">Chênh lệch tốt nhất − tệ nhất</div>
          <div className="dca-storm-stat-value">{spread.toFixed(2)} điểm %</div>
          <div className="dca-storm-stat-sub">CAGR mỗi năm</div>
        </div>
      </div>

      {/* Scatter */}
      <div className="chart-container">
        <div className="chart-header">
          <h3>Mỗi chấm là một biến thể</h3>
          <span
            className="chart-tooltip-icon"
            title="Trục ngang: mức sụt giảm tối đa của biến thể đó. Trục dọc: CAGR (lợi nhuận quy năm). Mỗi chấm là một biến thể (một cách chọn lịch tái cân bằng cụ thể)."
          >?</span>
        </div>
        <p className="rebal-inline-note">
          Càng lên cao = lợi nhuận càng cao. Càng qua phải = từng mất giá càng sâu (rủi ro
          càng lớn). Nếu các chấm nằm co cụm gần nhau như bên dưới, nghĩa là chọn biến thể
          nào cũng cho kết quả gần giống nhau, không cần lăn tăn quá nhiều về lịch tái cân
          bằng.
        </p>
        <ResponsiveContainer width="100%" height={360}>
          <ScatterChart margin={{ top: 10, right: 30, left: 10, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis
              type="number"
              dataKey="pain"
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => `-${v.toFixed(0)}%`}
              tick={{ fontSize: 12 }}
              label={{ value: 'Sụt giảm tối đa (sâu hơn →)', position: 'insideBottom', offset: -14, fontSize: 12, fill: '#5e5d59' }}
            />
            <YAxis
              type="number"
              dataKey="cagrPct"
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => `${v.toFixed(1)}%`}
              tick={{ fontSize: 12 }}
              width={60}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null
                const p = payload[0].payload as VariantResult & { pain: number; cagrPct: number }
                return (
                  <div style={{ background: '#fff', border: '1px solid #e8e6dc', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
                    <strong style={{ color: GROUP_COLORS[p.group] }}>{p.label}</strong>
                    <div>CAGR: {p.cagrPct.toFixed(2)}%/năm</div>
                    <div>Sụt giảm tối đa: -{p.pain.toFixed(1)}%</div>
                    <div>Số lần tái cân bằng: {p.rebalCount}</div>
                  </div>
                )
              }}
            />
            {scatterSeries.map(s => (
              <Scatter
                key={s.group}
                name={s.group}
                data={s.data}
                fill={s.color}
                isAnimationActive={false}
                shape={renderSmallDot}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
        <div className="rebal-scatter-legend">
          {scatterSeries.map(s => (
            <span key={s.group} className="rebal-scatter-legend-item">
              <span className="rebal-scatter-legend-dot" style={{ background: s.color }} />
              {GROUP_LABELS[s.group]}
            </span>
          ))}
        </div>
      </div>

      {/* Bảng theo nhóm */}
      <div className="chart-container">
        <div className="chart-header">
          <h3>Thống kê theo lịch</h3>
          <span
            className="chart-tooltip-icon"
            title="Mỗi tần suất được chạy với mọi ngày có thể tái cân bằng trong kỳ. Cột CAGR hiện median, kèm khoảng [thấp nhất – cao nhất] giữa các ngày đó: khoảng này chính là phần 'may rủi' do chọn đúng ngày nào để cân lại. Sharpe trong bảng là Sharpe 'thuần', không trừ lãi suất phi rủi ro (risk-free)."
          >?</span>
        </div>
        <div className="dca-stats-table-scroll">
          <table className="dca-stats-table">
            <thead>
              <tr>
                <th>Lịch</th>
                <th>Số biến thể</th>
                <th>CAGR (median)</th>
                <th>CAGR [min – max]</th>
                <th>Sụt giảm tối đa</th>
                <th>Biến động</th>
                <th>Sharpe</th>
                <th>Số lần cân lại</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const c = summarize(g.items.map(v => v.cagr))
                const dd = summarize(g.items.map(v => v.maxDrawdown))
                const sd = summarize(g.items.map(v => v.stdev))
                const sh = summarize(g.items.map(v => v.sharpe))
                const rc = summarize(g.items.map(v => v.rebalCount))
                return (
                  <tr key={g.group}>
                    <td>
                      <span className="perf-dot" style={{ background: GROUP_COLORS[g.group] }} />
                      {GROUP_LABELS[g.group]}
                    </td>
                    <td>{g.items.length}</td>
                    <td style={{ fontWeight: 600 }}>{(c.median * 100).toFixed(2)}%</td>
                    <td>
                      {g.items.length > 1
                        ? `${(c.min * 100).toFixed(2)}% – ${(c.max * 100).toFixed(2)}%`
                        : '—'}
                    </td>
                    <td className="dca-loss">{(dd.median * 100).toFixed(1)}%</td>
                    <td>{(sd.median * 100).toFixed(1)}%</td>
                    <td>{sh.median.toFixed(2)}</td>
                    <td>{Math.round(rc.median)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <SensitivityNarrative
          spread={spread}
          best={best}
          worst={worst}
          none={none}
          cagrs={cagrs}
        />
      </div>
    </>
  )
}

function SensitivityNarrative({
  spread, best, worst, none, cagrs,
}: {
  spread: number
  best: VariantResult
  worst: VariantResult
  none: VariantResult | undefined
  cagrs: number[]
}) {
  const median = summarize(cagrs).median
  const noneVsMedian = none ? (none.cagr - median) * 100 : null

  const small = spread < 1.5
  const variant = small ? 'blue' : 'orange'
  const icon = small ? '🎯' : '⚖️'

  return (
    <div className={`chart-takeaway chart-takeaway--${variant}`}>
      <span className="chart-takeaway-icon">{icon}</span>
      <div className="chart-takeaway-body">
        Chênh lệch CAGR giữa lịch tốt nhất ({best.label}, {(best.cagr * 100).toFixed(2)}%/năm)
        {' '}và tệ nhất ({worst.label}, {(worst.cagr * 100).toFixed(2)}%/năm) là{' '}
        <strong>{spread.toFixed(2)} điểm %</strong> mỗi năm.{' '}
        {small
          ? 'Chọn tần suất hay ngày cân lại nào cũng gần như không đổi kết quả, quan trọng hơn là giữ đúng tỷ trọng mục tiêu qua thời gian.'
          : 'Đừng vội chọn biến thể tốt nhất của quá khứ, thứ hạng có thể đổi trong tương lai (xem khoảng [min – max] ở bảng trên).'}
        {none && noneVsMedian !== null && (
          <>
            {' '}Riêng <strong>không tái cân bằng</strong> đạt {(none.cagr * 100).toFixed(2)}%/năm,{' '}
            {noneVsMedian >= 0 ? 'cao hơn' : 'thấp hơn'} median {Math.abs(noneVsMedian).toFixed(2)} điểm %:
            tỷ trọng trôi dần về quỹ tăng mạnh nhất nên rủi ro tập trung cũng tăng theo.
          </>
        )}
      </div>
    </div>
  )
}

function formatDate(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}
