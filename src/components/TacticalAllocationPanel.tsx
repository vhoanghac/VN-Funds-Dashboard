/**
 * TacticalAllocationPanel: tab "Chiến thuật phân bổ".
 *
 * Trả lời câu hỏi retail VN hay hỏi: "NAV quỹ X trên/dưới MA200 thì có nên
 * chuyển sang quỹ Y không?". Mô phỏng chuyển đổi giữa 2 danh mục (mỗi danh
 * mục có thể nhiều quỹ, tái dùng PortfolioCard) dựa trên tín hiệu Giá vs
 * SMA(N) của MỘT ticker do người dùng chọn riêng (không nhất thiết là quỹ
 * đang nắm giữ).
 *
 * Cố tình thu hẹp so với công cụ Tactical Allocation của testfol.io: đúng 1
 * kiểu tín hiệu, đúng 2 trạng thái, độ trễ thực thi CỐ ĐỊNH T+1 (không cho
 * chỉnh). Xem utils/tactical.ts để biết lý do.
 */
import { useState, useMemo, memo } from 'react'
import Select from 'react-select'
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, ReferenceArea, ReferenceLine, Legend,
} from 'recharts'
import type { FundMeta, PortfolioCardState, PricePoint } from '../types'
import { useFundSeriesMap } from '../hooks/useFundData'
import { useCommittedRun } from '../hooks/useCommittedRun'
import { dcaCagr, dcaMaxDrawdown, derivePortfolioName } from '../utils/dca'
import { runTacticalBacktest, decomposeAdvantage, type TacticalBacktestResult, type AllocationId, type IndicatorType, type SignalFrequency } from '../utils/tactical'
import { PortfolioCard, portfolioSelectStyles, PORTFOLIO_COLORS } from './PortfolioCard'
import {
  isSavingsAssetId, savingsAssetId,
  SAVINGS_OPTION_LABEL, DEFAULT_SAVINGS_RATE,
} from '../utils/savingsAsset'
import { MoneyInput } from './MoneyInput'
import { formatVND, formatVNDAxis } from '../utils/vndFormat'

interface Props {
  funds: FundMeta[]
}

type DateRangeMode = 'all' | 'years'

const INDICATOR_OPTIONS: IndicatorType[] = ['SMA', 'EMA', 'RSI']

const FREQUENCY_OPTIONS: { value: SignalFrequency; label: string }[] = [
  { value: 'daily', label: 'Mỗi phiên' },
  { value: 'weekly', label: 'Cuối tuần' },
  { value: 'monthly', label: 'Cuối tháng' },
]
const COLOR_A = PORTFOLIO_COLORS[0]!
const COLOR_B = PORTFOLIO_COLORS[1]!

/** Nhãn hiển thị cho 1 cấu hình chỉ báo, vd "SMA200", "RSI14". */
function indicatorLabel(type: IndicatorType, period: number): string {
  return `${type}${period}`
}

/** Toàn bộ thông số chốt lại tại thời điểm bấm "Chạy". Backtest chỉ đọc từ đây. */
interface CommittedParams {
  signalFundId: string
  indicatorType: IndicatorType
  period: number
  toleranceBandPct: number
  signalFrequency: SignalFrequency
  rsiOverbought: number
  rsiOversold: number
  allocationASlots: PortfolioCardState['slots']
  allocationARebalFreq: PortfolioCardState['rebalFreq']
  allocationBSlots: PortfolioCardState['slots']
  allocationBRebalFreq: PortfolioCardState['rebalFreq']
  startValue: number
  switchCostPct: number
  dateFrom: string
  dateTo: string
}

/**
 * Một lần bấm "Chạy" chốt lại đúng một object thế này.
 *
 * `labels` để riêng khỏi `params` vì hai thứ dùng vào hai việc khác nhau: so sánh
 * dirty chỉ nhìn `params`, nên đổi tên danh mục không làm hiện dòng "thông số đã
 * thay đổi", còn kết quả thì luôn hiển thị đúng tên của chính lần chạy đó.
 */
interface CommittedSnapshot {
  params: CommittedParams
  labels: { nameA: string; nameB: string; signalFundName: string }
  data: Map<string, PricePoint[]>
}

/** Gom mọi quỹ mà một snapshot cần tới, kể cả quỹ làm tín hiệu. */
function collectCommittedIds(c: CommittedParams): Set<string> {
  const ids = new Set<string>()
  if (c.signalFundId) ids.add(c.signalFundId)
  for (const s of c.allocationASlots) if (s.fundId) ids.add(s.fundId)
  for (const s of c.allocationBSlots) if (s.fundId) ids.add(s.fundId)
  return ids
}

function makeEmptyAllocation(id: string, fallbackName: string): PortfolioCardState {
  const slots = [{ fundId: '', weight: 100 }]
  return {
    id, num: 1, name: derivePortfolioName(slots, fallbackName), isNameCustom: false,
    slots,
    rebalFreq: 'quarterly',
  }
}

function TacticalAllocationPanelImpl({ funds }: Props) {
  // ── Thông số ──
  const [dateMode, setDateMode] = useState<DateRangeMode>('all')
  const [yearsBack, setYearsBack] = useState(5)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [startValue, setStartValue] = useState(100_000_000)
  const [switchCostPct, setSwitchCostPct] = useState(0.5)

  // ── Tín hiệu ──
  const [signalFundId, setSignalFundId] = useState('')
  const [indicatorType, setIndicatorType] = useState<IndicatorType>('SMA')
  const [period, setPeriod] = useState(200)
  const [toleranceBandPct, setToleranceBandPct] = useState(2)
  const [signalFrequency, setSignalFrequency] = useState<SignalFrequency>('monthly')
  const [rsiOverbought, setRsiOverbought] = useState(70)
  const [rsiOversold, setRsiOversold] = useState(30)

  function selectIndicator(t: IndicatorType) {
    setIndicatorType(t)
    if (t === 'RSI') setPeriod(14)
    else { setPeriod(200); setToleranceBandPct(2) }
  }

  // ── 2 Allocation (mỗi cái có thể nhiều quỹ, tái dùng PortfolioCard) ──
  const [allocationA, setAllocationA] = useState<PortfolioCardState>(() => makeEmptyAllocation('tacticalA', 'Danh mục A'))
  const [allocationB, setAllocationB] = useState<PortfolioCardState>(() => makeEmptyAllocation('tacticalB', 'Danh mục B'))

  // Danh sách quỹ thật, không có tiết kiệm ngân hàng.
  const realFundOptions = useMemo(
    () => funds.map(f => ({ value: f.id, label: f.name_vi })),
    [funds],
  )

  // Danh sách đầy đủ, thêm tiết kiệm ngân hàng. Dùng cho CẢ 2 thẻ danh mục lẫn
  // ô chọn tín hiệu.
  //
  // Ở 2 thẻ danh mục thì tiết kiệm hữu ích thật, kiểu "trên MA200 thì giữ ETF,
  // dưới thì rút về gửi tiết kiệm".
  //
  // Ở ô tín hiệu thì nó là một cái bẫy, nên có cảnh báo đi kèm chứ không chặn.
  // Chuỗi lãi suất cố định chỉ tăng, không có ngày nào giảm, nên mọi chỉ báo
  // trên nó kẹt cứng một trạng thái: giá luôn nằm trên SMA/EMA (đo trên 4 năm,
  // 1263 trên 1263 ngày), còn RSI luôn đúng bằng 100 vì mẫu số (trung bình mức
  // giảm) bằng 0. Backtest vẫn chạy ra kết quả, nhưng là kết quả không bao giờ
  // đổi trạng thái. Trước đây ô tín hiệu dùng danh sách riêng để giấu hẳn tiết
  // kiệm đi; user chọn đổi sang cho chọn kèm cảnh báo, xem hồ sơ
  // process/2026-08-05_TietKiemNganHang.md.
  const fundOptions = useMemo(() => [
    ...realFundOptions,
    { value: savingsAssetId(DEFAULT_SAVINGS_RATE), label: SAVINGS_OPTION_LABEL },
  ], [realFundOptions])

  // Tín hiệu đang trỏ vào tiết kiệm thì backtest sẽ đứng im một trạng thái.
  const signalIsSavings = isSavingsAssetId(signalFundId)

  const dualPriceFundIds = useMemo(() => new Set(funds.filter(f => f.type === 'gold').map(f => f.id)), [funds])

  const neededIds = useMemo(() => {
    const ids = new Set<string>()
    if (signalFundId) ids.add(signalFundId)
    for (const s of allocationA.slots) if (s.fundId) ids.add(s.fundId)
    for (const s of allocationB.slots) if (s.fundId) ids.add(s.fundId)
    return ids
  }, [signalFundId, allocationA.slots, allocationB.slots])

  const neededIdList = useMemo(() => Array.from(neededIds), [neededIds])
  const {
    data: fundData,
    loading,
    errors,
  } = useFundSeriesMap(neededIdList, { dualPriceFundIds })
  const dataError = Array.from(errors.values())[0] ?? null

  function getEffectiveDates(): { from: string; to: string } {
    if (dateMode === 'years') {
      const now = new Date()
      const from = new Date(now.getFullYear() - yearsBack, now.getMonth(), now.getDate())
      return { from: from.toISOString().substring(0, 10), to: '' }
    }
    return { from: dateFrom, to: dateTo }
  }

  const validA = allocationA.slots.filter(s => s.fundId && s.weight > 0)
  const validB = allocationB.slots.filter(s => s.fundId && s.weight > 0)
  const totalA = allocationA.slots.reduce((s, x) => s + x.weight, 0)
  const totalB = allocationB.slots.reduce((s, x) => s + x.weight, 0)
  const canRun = !!signalFundId
    && validA.length > 0 && Math.abs(totalA - 100) < 0.01
    && validB.length > 0 && Math.abs(totalB - 100) < 0.01

  function buildParams(): CommittedParams {
    const { from, to } = getEffectiveDates()
    return {
      signalFundId, indicatorType, period, toleranceBandPct, signalFrequency, rsiOverbought, rsiOversold,
      allocationASlots: allocationA.slots.map(s => ({ ...s })),
      allocationARebalFreq: allocationA.rebalFreq,
      allocationBSlots: allocationB.slots.map(s => ({ ...s })),
      allocationBRebalFreq: allocationB.rebalFreq,
      startValue, switchCostPct,
      dateFrom: from, dateTo: to,
    }
  }

  const nameA = allocationA.name || 'Danh mục A'
  const nameB = allocationB.name || 'Danh mục B'
  const signalFundName = fundOptions.find(o => o.value === signalFundId)?.label || signalFundId

  function runBacktest() {
    if (!canRun) return
    runCommitted()
  }

  // Chỉ so `params`, không so `labels`: đổi tên danh mục không phải là đổi thông số.
  const liveParams = buildParams()

  const dataReady = Array.from(collectCommittedIds(liveParams)).every(id => fundData.has(id))
    && !loading
    && errors.size === 0
  const committedRun = useCommittedRun({
    ready: dataReady,
    valid: canRun,
    liveParams,
    captureSnapshot: (): CommittedSnapshot => {
      const params = buildParams()
      const data = new Map<string, PricePoint[]>()
      for (const id of collectCommittedIds(params)) {
        const series = fundData.get(id)
        if (series) data.set(id, series)
      }
      return { params, labels: { nameA, nameB, signalFundName }, data }
    },
    compute: snapshot => {
      const p = snapshot.params
      return runTacticalBacktest({
        rawPrices: snapshot.data,
        signalFundId: p.signalFundId,
        indicatorType: p.indicatorType,
        period: p.period,
        toleranceBandPct: p.toleranceBandPct,
        signalFrequency: p.signalFrequency,
        rsiOverbought: p.rsiOverbought,
        rsiOversold: p.rsiOversold,
        allocationASlots: p.allocationASlots,
        allocationARebalFreq: p.allocationARebalFreq,
        allocationBSlots: p.allocationBSlots,
        allocationBRebalFreq: p.allocationBRebalFreq,
        startValue: p.startValue,
        switchCostPct: p.switchCostPct,
        dateFrom: p.dateFrom || undefined,
        dateTo: p.dateTo || undefined,
      })
    },
  })

  const {
    committed,
    result,
    dirty: isDirty,
    run: runCommitted,
  } = committedRun

  // `useCommittedRun` keeps both the snapshot and the result stable while live
  // controls or unrelated fund data change.

  return (
    <div className="simulation-panel">
      <div className="panel-header">
        <h2>Chiến Thuật Phân Bổ</h2>
      </div>

      <div className="rebal-intro-card">
        <p className="dca-ratio-sub">
          Trả lời câu hỏi: <strong>nếu chuyển đổi giữa 2 danh mục dựa trên tín hiệu từ một chỉ báo
          kỹ thuật (SMA, EMA, hoặc RSI), kết quả thực tế sẽ ra sao?</strong> Chọn 1 quỹ hoặc chỉ số
          làm tín hiệu, không nhất thiết phải là quỹ bạn đang nắm giữ. Rồi chọn 2 danh mục A và B
          tuỳ ý. Tín hiệu chỉ về xu hướng tăng thì chuyển sang danh mục A, chỉ về xu hướng giảm
          thì chuyển sang danh mục B.
        </p>
      </div>

      {/* ── Thông số ── */}
      <div className="dca-params-card">
        <h3 className="dca-section-title">Thông số</h3>

        <div className="dca-param-row">
          <label className="dca-label">Khoảng thời gian</label>
          <div className="dca-date-mode">
            <button className={`dca-mode-btn ${dateMode === 'all' ? 'dca-mode-btn-active' : ''}`} onClick={() => setDateMode('all')}>Tất cả</button>
            <button className={`dca-mode-btn ${dateMode === 'years' ? 'dca-mode-btn-active' : ''}`} onClick={() => setDateMode('years')}>X năm qua</button>
          </div>
        </div>

        {dateMode === 'years' && (
          <div className="dca-param-row dca-years-row">
            <label className="dca-label">Số năm</label>
            <div className="dca-years-selector">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <button key={n} className={`dca-year-btn ${yearsBack === n ? 'dca-year-btn-active' : ''}`} onClick={() => setYearsBack(n)}>{n}</button>
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
          <label className="dca-label">Số tiền đầu tư</label>
          <div className="dca-amount-input">
            <MoneyInput value={startValue} onChange={setStartValue} min={0} />
            <span className="dca-currency">₫</span>
          </div>
        </div>

        <div className="dca-param-row">
          <label className="dca-label">Phí chuyển đổi</label>
          <div className="tactical-pct-input">
            <input
              type="number" min={0} max={10} step={0.1}
              value={switchCostPct}
              onChange={e => { const v = Number(e.target.value); if (!Number.isNaN(v)) setSwitchCostPct(v) }}
              onBlur={e => setSwitchCostPct(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
            />
            <span>%</span>
          </div>
        </div>
        <p className="dca-note">
          * Mỗi lần đổi danh mục, phí này trừ thẳng trên giá trị đang có. Nhiều quỹ mở ở Việt Nam
          phạt phí nếu bán trước một mốc thời gian nhất định. Đặt 0% nếu quỹ bạn chọn không phạt.
        </p>
      </div>

      {/* ── Tín hiệu ── */}
      <div className="dca-params-card">
        <h3 className="dca-section-title">Tín hiệu</h3>
        <div className="dca-param-row">
          <label className="dca-label">Quỹ/chỉ số làm tín hiệu</label>
          <div className="tactical-signal-select">
            <Select
              options={fundOptions}
              value={fundOptions.find(o => o.value === signalFundId) || null}
              onChange={opt => setSignalFundId(opt?.value || '')}
              placeholder="Tìm quỹ..."
              noOptionsMessage={() => 'Không tìm thấy'}
              isSearchable
              styles={portfolioSelectStyles}
            />
          </div>
        </div>

        {signalIsSavings && (
          <p className="tactical-signal-warning">
            Tiết kiệm ngân hàng làm tín hiệu thì backtest sẽ đứng im một trạng thái từ đầu
            tới cuối. Lãi suất cố định nghĩa là không có ngày nào giảm, nên giá luôn nằm
            trên SMA và EMA, còn RSI luôn bằng 100. Kết quả chạy ra vẫn có biểu đồ, nhưng
            nó chỉ nói cho bạn biết danh mục A chạy thế nào, không phải chuyện chuyển đổi
            hai danh mục. Muốn thấy tín hiệu đổi qua đổi lại thì chọn một quỹ hoặc chỉ số
            có lên có xuống.
          </p>
        )}
        <div className="dca-param-row">
          <label className="dca-label">Chốt tín hiệu</label>
          <div className="dca-years-selector">
            {FREQUENCY_OPTIONS.map(f => (
              <button
                key={f.value}
                className={`dca-year-btn tactical-freq-btn ${signalFrequency === f.value ? 'dca-year-btn-active' : ''}`}
                onClick={() => setSignalFrequency(f.value)}
              >{f.label}</button>
            ))}
          </div>
        </div>
        <p className="dca-note">
          * Bao lâu bạn nhìn giá một lần để quyết định chuyển hay giữ. Đây là tham số ăn vào kết
          quả mạnh nhất của cả tab, mạnh hơn hẳn vùng đệm hay phí.
        </p>
        <p className="dca-note">
          Thử trên E1VFVN30 với SMA200 và tiết kiệm 7%, cùng một bộ dữ liệu, chỉ đổi mỗi mục này:
          chốt cuối tháng cho 13,9%/năm với 11 lần chuyển, chốt mỗi phiên cho 8,2%/năm với 27 lần
          chuyển. Mua giữ luôn thì 11,5%/năm. Chốt thưa mỗi năm chỉ nhìn giá 12 lần, dao động
          trong tháng không cách nào làm nó đổi ý. Chốt dày thì ăn trọn từng cú bật giả một.
        </p>
        <div className="dca-param-row">
          <label className="dca-label">Chỉ báo</label>
          <div className="dca-years-selector">
            {INDICATOR_OPTIONS.map(t => (
              <button key={t} className={`dca-year-btn tactical-ma-btn ${indicatorType === t ? 'dca-year-btn-active' : ''}`} onClick={() => selectIndicator(t)}>{t}</button>
            ))}
          </div>
        </div>
        <div className="dca-param-row">
          <label className="dca-label">Số ngày</label>
          <div className="tactical-pct-input">
            <input
              type="number" min={2} max={500} step={1}
              value={period}
              onChange={e => { const v = Number(e.target.value); if (!Number.isNaN(v)) setPeriod(v) }}
              onBlur={e => setPeriod(Math.max(2, Math.min(500, Math.round(Number(e.target.value) || 2))))}
            />
            <span>ngày</span>
          </div>
        </div>
        {indicatorType === 'RSI' ? (
          <>
            <div className="dca-param-row">
              <label className="dca-label">Mốc quá bán</label>
              <div className="tactical-pct-input">
                <input
                  type="number" min={0} max={49} step={1}
                  value={rsiOversold}
                  onChange={e => { const v = Number(e.target.value); if (!Number.isNaN(v)) setRsiOversold(v) }}
                  onBlur={e => setRsiOversold(Math.max(0, Math.min(49, Math.round(Number(e.target.value) || 0))))}
                />
                <span>RSI</span>
              </div>
            </div>
            <div className="dca-param-row">
              <label className="dca-label">Mốc quá mua</label>
              <div className="tactical-pct-input">
                <input
                  type="number" min={51} max={100} step={1}
                  value={rsiOverbought}
                  onChange={e => { const v = Number(e.target.value); if (!Number.isNaN(v)) setRsiOverbought(v) }}
                  onBlur={e => setRsiOverbought(Math.max(51, Math.min(100, Math.round(Number(e.target.value) || 51))))}
                />
                <span>RSI</span>
              </div>
            </div>
            <p className="dca-note">
              * RSI xuống dưới mốc quá bán thì kỳ vọng hồi phục, chuyển sang danh mục A. RSI vượt
              lên trên mốc quá mua thì kỳ vọng điều chỉnh, chuyển sang danh mục B. Nằm giữa 2 mốc
              thì giữ nguyên trạng thái cũ. Chính khoảng cách giữa 2 mốc đã đóng vai trò vùng đệm
              chống nhấp nháy, không cần thêm tham số riêng. Lệnh chuyển luôn thực hiện vào phiên
              giao dịch KẾ TIẾP sau khi có tín hiệu, vì trong phiên đang xét thì bạn chưa nhìn thấy
              giá đóng cửa của chính nó.
            </p>
          </>
        ) : (
          <>
            <div className="dca-param-row">
              <label className="dca-label">Vùng đệm</label>
              <div className="tactical-pct-input">
                <input
                  type="number" min={0} max={50} step={0.5}
                  value={toleranceBandPct}
                  onChange={e => { const v = Number(e.target.value); if (!Number.isNaN(v)) setToleranceBandPct(v) }}
                  onBlur={e => setToleranceBandPct(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
                />
                <span>%</span>
              </div>
            </div>
            <p className="dca-note">
              * Giá dao động sát đường {indicatorType} thì tín hiệu dễ nhấp nháy, chuyển qua chuyển
              lại liên tục mà chẳng được gì. Vùng đệm chặn chuyện đó: chỉ đổi khi giá vượt hẳn ra
              khỏi vùng ± X% quanh đường {indicatorType}. Đặt 0% nếu muốn đổi ngay lúc giá cắt qua.
              Lệnh chuyển luôn thực hiện vào phiên giao dịch KẾ TIẾP sau khi có tín hiệu, vì trong
              phiên đang xét thì bạn chưa nhìn thấy giá đóng cửa của chính nó.
            </p>
          </>
        )}
      </div>

      {/* ── 2 Danh mục ── */}
      <div className="dca-portfolios-card">
        <div className="dca-portfolios-card-header">
          <h3 className="dca-section-title">2 danh mục chuyển đổi qua lại</h3>
        </div>
        <div className="dca-portfolio-grid">
          <PortfolioCard
            portfolio={allocationA} pIdx={0} funds={funds} fundOptions={fundOptions}
            onUpdate={u => setAllocationA(p => ({ ...p, ...u }))}
            onRemove={() => {}}
            onAddSlot={() => setAllocationA(p => {
              const slots = [...p.slots, { fundId: '', weight: 0 }]
              return { ...p, slots, name: p.isNameCustom ? p.name : derivePortfolioName(slots, 'Danh mục A') }
            })}
            onRemoveSlot={idx => setAllocationA(p => {
              const slots = p.slots.length > 1 ? p.slots.filter((_, i) => i !== idx) : p.slots
              return { ...p, slots, name: p.isNameCustom ? p.name : derivePortfolioName(slots, 'Danh mục A') }
            })}
            onUpdateSlot={(idx, u) => setAllocationA(p => {
              const slots = p.slots.map((s, i) => i === idx ? { ...s, ...u } : s)
              return { ...p, slots, name: p.isNameCustom ? p.name : derivePortfolioName(slots, 'Danh mục A') }
            })}
            onSetEqualWeights={() => setAllocationA(p => {
              const n = p.slots.length; const w = Math.floor(100 / n); const rem = 100 - w * n
              return { ...p, slots: p.slots.map((s, i) => ({ ...s, weight: w + (i < rem ? 1 : 0) })) }
            })}
            showRemove={false}
          />
          <PortfolioCard
            portfolio={allocationB} pIdx={1} funds={funds} fundOptions={fundOptions}
            onUpdate={u => setAllocationB(p => ({ ...p, ...u }))}
            onRemove={() => {}}
            onAddSlot={() => setAllocationB(p => {
              const slots = [...p.slots, { fundId: '', weight: 0 }]
              return { ...p, slots, name: p.isNameCustom ? p.name : derivePortfolioName(slots, 'Danh mục B') }
            })}
            onRemoveSlot={idx => setAllocationB(p => {
              const slots = p.slots.length > 1 ? p.slots.filter((_, i) => i !== idx) : p.slots
              return { ...p, slots, name: p.isNameCustom ? p.name : derivePortfolioName(slots, 'Danh mục B') }
            })}
            onUpdateSlot={(idx, u) => setAllocationB(p => {
              const slots = p.slots.map((s, i) => i === idx ? { ...s, ...u } : s)
              return { ...p, slots, name: p.isNameCustom ? p.name : derivePortfolioName(slots, 'Danh mục B') }
            })}
            onSetEqualWeights={() => setAllocationB(p => {
              const n = p.slots.length; const w = Math.floor(100 / n); const rem = 100 - w * n
              return { ...p, slots: p.slots.map((s, i) => ({ ...s, weight: w + (i < rem ? 1 : 0) })) }
            })}
            showRemove={false}
          />
        </div>
        <p className="dca-note">
          {indicatorType === 'RSI' ? (
            <>* RSI xuống dưới mốc quá bán → chuyển sang <strong style={{ color: COLOR_A }}>{nameA}</strong>.
            Vượt lên trên mốc quá mua → chuyển sang <strong style={{ color: COLOR_B }}>{nameB}</strong>.</>
          ) : (
            <>* Giá tín hiệu cắt lên trên {indicatorType} → chuyển sang <strong style={{ color: COLOR_A }}>{nameA}</strong>.
            Cắt xuống dưới → chuyển sang <strong style={{ color: COLOR_B }}>{nameB}</strong>.</>
          )}
        </p>
      </div>

      <div className="btc-run-row">
        <button className="sim-run-btn" onClick={runBacktest} disabled={!canRun}>
          {committed ? 'Chạy lại' : 'Chạy mô phỏng'}
        </button>
        {isDirty && (
          <span className="btc-run-hint">Thông số đã thay đổi, bấm "Chạy lại" để cập nhật kết quả.</span>
        )}
      </div>

      {loading && <div className="loading-indicator">Đang tải dữ liệu...</div>}

      {!loading && dataError && (
        <div className="error-banner">{dataError}</div>
      )}

      {committed && !loading && !result && !dataError && (
        <div className="error-banner">
          Không đủ dữ liệu để mô phỏng. Kiểm tra lại quỹ đã chọn, hoặc cần nhiều lịch sử hơn để
          tính đủ {indicatorLabel(committed.params.indicatorType, committed.params.period)} (~{Math.round(committed.params.period / 21)} tháng
          dữ liệu trước ngày bắt đầu).
        </div>
      )}

      {result && committed && (
        <TacticalResults
          result={result}
          nameA={committed.labels.nameA}
          nameB={committed.labels.nameB}
          signalFundName={committed.labels.signalFundName}
          indicatorType={committed.params.indicatorType}
          period={committed.params.period}
          rsiOverbought={committed.params.rsiOverbought}
          rsiOversold={committed.params.rsiOversold}
        />
      )}
    </div>
  )
}

export const TacticalAllocationPanel = memo(TacticalAllocationPanelImpl)

// ─── Kết quả ──────────────────────────────────────────────────────

/**
 * Khối kết quả BẮT BUỘC bọc memo ở cuối file. Đừng gỡ.
 *
 * Mọi ô nhập trong panel cha (Vùng đệm, Số ngày, Số tiền đầu tư, Phí chuyển đổi)
 * đều giữ state ở cha, nên mỗi phím gõ là một lần cha render lại. Khối này vẽ 3
 * biểu đồ Recharts trên toàn bộ chuỗi ngày, đo được 116ms mỗi lần. Gõ vài phím
 * liên tiếp là trang đứng hình.
 *
 * Props ở đây đều ổn định giữa các lần gõ, và phải giữ nguyên như vậy. `result` cùng
 * mọi thông số đều lấy từ `committed`, tức snapshot chốt lúc bấm "Chạy", nên chỉ
 * đổi khi bấm nút. Kể cả tên danh mục (`nameA`, `nameB`) cũng lấy từ snapshot chứ không
 * lấy tên đang sống, vì tên đổi ngay khi người dùng chọn quỹ khác.
 *
 * Ai thêm prop mới phải lấy từ snapshot, đừng lấy state đang sống của cha. Lấy nhầm
 * một prop là 3 biểu đồ Recharts vẽ lại theo từng phím gõ, trang đứng hình ngay.
 */
function TacticalResultsImpl({
  result, nameA, nameB, signalFundName, indicatorType, period, rsiOverbought, rsiOversold,
}: {
  result: TacticalBacktestResult
  nameA: string
  nameB: string
  signalFundName: string
  indicatorType: IndicatorType
  period: number
  rsiOverbought: number
  rsiOversold: number
}) {
  const { switching, indicatorSeries, strategyCumulative, buyHoldACumulative, buyHoldBCumulative, buyHoldAValue, buyHoldBValue, requestedStartDate, effectiveStartDate } = result
  const label = indicatorLabel(indicatorType, period)

  const nameOf = (id: AllocationId) => id === 'A' ? nameA : nameB
  const colorOf = (id: AllocationId) => id === 'A' ? COLOR_A : COLOR_B

  // ── Phân rã lợi thế: hệ số cuối kỳ so với mua giữ luôn A, tách theo từng đoạn ──
  const advantage = useMemo(
    () => decomposeAdvantage(switching.dates, switching.strategyValue, buyHoldAValue, switching.activeAllocation),
    [switching, buyHoldAValue],
  )
  const topAdvantageIdx = useMemo(() => {
    let idx = -1
    let maxLog = -Infinity
    advantage.segments.forEach((seg, i) => {
      if (seg.factor > 1 && Math.log(seg.factor) > maxLog) { maxLog = Math.log(seg.factor); idx = i }
    })
    return idx
  }, [advantage])

  // ── Gom activeAllocation thành các đoạn liên tục để tô nền ──
  const segments = useMemo(() => {
    const out: { from: string; to: string; allocation: AllocationId }[] = []
    let segStart = 0
    for (let i = 1; i <= switching.dates.length; i++) {
      if (i === switching.dates.length || switching.activeAllocation[i] !== switching.activeAllocation[segStart]) {
        out.push({
          from: switching.dates[segStart]!,
          to: switching.dates[Math.min(i, switching.dates.length - 1)]!,
          allocation: switching.activeAllocation[segStart]!,
        })
        segStart = i
      }
    }
    return out
  }, [switching])

  const chartData = indicatorSeries.map(p => ({
    date: p.date,
    price: p.price,
    indicator: p.value,
  }))

  const compareData = strategyCumulative.map((p, i) => ({
    date: p.date,
    strategy: p.value * 100,
    buyHoldA: buyHoldACumulative[i]!.value * 100,
    buyHoldB: buyHoldBCumulative[i]!.value * 100,
  }))

  const valueData = switching.dates.map((date, i) => ({
    date,
    strategy: switching.strategyValue[i]!,
    buyHoldA: buyHoldAValue[i]!,
    buyHoldB: buyHoldBValue[i]!,
  }))

  const strategyCagr = dcaCagr(strategyCumulative)
  const strategyMaxDD = dcaMaxDrawdown(strategyCumulative)
  const aCagr = dcaCagr(buyHoldACumulative)
  const aMaxDD = dcaMaxDrawdown(buyHoldACumulative)
  const bCagr = dcaCagr(buyHoldBCumulative)
  const bMaxDD = dcaMaxDrawdown(buyHoldBCumulative)

  const totalCost = switching.switches.reduce((s, sw) => s + sw.costPaid, 0)
  const finalValue = switching.strategyValue[switching.strategyValue.length - 1]!
  const currentAllocationName = nameOf(switching.currentSignal)
  const lastDate = switching.dates[switching.dates.length - 1]!

  const warmupNote = requestedStartDate < effectiveStartDate
    ? `Bắt đầu hiệu lực từ ${fmtDate(effectiveStartDate)} (trễ hơn ngày bạn chọn) vì cần đủ ${period} phiên dữ liệu trước đó để tính ${label}.`
    : null

  return (
    <div className="tactical-results">
      <div className="tactical-current-signal">
        Dữ liệu tới <strong>{fmtDate(lastDate)}</strong>. Tín hiệu {label} của{' '}
        <strong>{signalFundName}</strong> đang chỉ về{' '}
        <strong style={{ color: colorOf(switching.currentSignal) }}>{currentAllocationName}</strong>.
        Nếu giữ kỷ luật, danh mục nên nắm giữ tài sản này.
      </div>

      {warmupNote && <p className="dca-note">* {warmupNote}</p>}

      <div className="chart-container">
        <div className="chart-header">
          <h3>{indicatorType === 'RSI' ? `RSI(${period}) của ${signalFundName}` : `Giá ${signalFundName} và đường ${label}`}</h3>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} minTickGap={40} />
            <YAxis
              tick={{ fontSize: 11, fill: '#6b7280' }}
              width={56}
              domain={indicatorType === 'RSI' ? [0, 100] : ['auto', 'auto']}
            />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            {segments.map((seg, i) => (
              <ReferenceArea
                key={i}
                x1={seg.from} x2={seg.to}
                fill={colorOf(seg.allocation)}
                fillOpacity={0.15}
                stroke="none"
              />
            ))}
            {indicatorType === 'RSI' ? (
              <>
                <ReferenceLine y={rsiOverbought} stroke="#dc2626" strokeDasharray="4 2" label={{ value: 'Quá mua', position: 'insideTopRight', fontSize: 11, fill: '#dc2626' }} />
                <ReferenceLine y={rsiOversold} stroke="#16a34a" strokeDasharray="4 2" label={{ value: 'Quá bán', position: 'insideBottomRight', fontSize: 11, fill: '#16a34a' }} />
                <Line type="monotone" dataKey="indicator" stroke="#d97706" strokeWidth={1.5} dot={false} isAnimationActive={false} name="RSI" />
              </>
            ) : (
              <>
                <Line type="monotone" dataKey="price" stroke="#141413" strokeWidth={1.5} dot={false} isAnimationActive={false} name="Giá" />
                <Line type="monotone" dataKey="indicator" stroke="#d97706" strokeWidth={1.5} dot={false} isAnimationActive={false} name={label} strokeDasharray="4 2" />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
        <div className="tactical-chart-legend">
          <span><span className="tactical-swatch" style={{ background: colorOf('A') }} /> Giai đoạn giữ {nameA}</span>
          <span><span className="tactical-swatch" style={{ background: colorOf('B') }} /> Giai đoạn giữ {nameB}</span>
        </div>
      </div>

      <div className="chart-container">
        <div className="chart-header">
          <h3>Giá trị tài sản</h3>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={valueData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} minTickGap={40} />
            <YAxis tickFormatter={formatVNDAxis} tick={{ fontSize: 11, fill: '#6b7280' }} width={62} />
            <Tooltip
              formatter={(v: number) => formatVND(Math.round(v))}
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="strategy" name={`Chiến thuật ${label}`} stroke="#141413" strokeWidth={2.2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="buyHoldA" name={`Mua giữ luôn ${nameA}`} stroke={COLOR_A} strokeWidth={1.5} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="buyHoldB" name={`Mua giữ luôn ${nameB}`} stroke={COLOR_B} strokeWidth={1.5} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-container">
        <div className="chart-header">
          <h3>Lợi nhuận tích lũy: Chiến thuật vs mua-giữ-luôn</h3>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={compareData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} minTickGap={40} />
            <YAxis tickFormatter={v => `${v.toFixed(0)}%`} tick={{ fontSize: 11, fill: '#6b7280' }} width={56} />
            <Tooltip
              formatter={(v: number) => `${v.toFixed(1)}%`}
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="strategy" name={`Chiến thuật ${label}`} stroke="#141413" strokeWidth={2.2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="buyHoldA" name={`Mua giữ luôn ${nameA}`} stroke={COLOR_A} strokeWidth={1.5} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="buyHoldB" name={`Mua giữ luôn ${nameB}`} stroke={COLOR_B} strokeWidth={1.5} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-container">
        <div className="chart-header">
          <h3>Bảng thống kê</h3>
        </div>
        <div className="dca-stats-table-scroll">
          <table className="dca-stats-table">
            <thead>
              <tr>
                <th>Kịch bản</th>
                <th>Giá trị cuối kỳ</th>
                <th>CAGR</th>
                <th>Sụt giảm tối đa</th>
                <th>Số lần chuyển</th>
              </tr>
            </thead>
            <tbody>
              <tr className="tactical-stats-row--highlight">
                <td>Chiến thuật {label}</td>
                <td>{formatVND(Math.round(finalValue))}</td>
                <td className={signClass(strategyCagr)}>{fmtPct(strategyCagr)}</td>
                <td className={strategyMaxDD < 0 ? 'dca-loss' : ''}>{fmtPct(strategyMaxDD)}</td>
                <td>{switching.switches.length} (phí {formatVND(Math.round(totalCost))})</td>
              </tr>
              <tr>
                <td>Mua giữ luôn {nameA}</td>
                <td>{formatVND(Math.round(result.buyHoldAValue[result.buyHoldAValue.length - 1]!))}</td>
                <td className={signClass(aCagr)}>{fmtPct(aCagr)}</td>
                <td className={aMaxDD < 0 ? 'dca-loss' : ''}>{fmtPct(aMaxDD)}</td>
                <td>0</td>
              </tr>
              <tr>
                <td>Mua giữ luôn {nameB}</td>
                <td>{formatVND(Math.round(result.buyHoldBValue[result.buyHoldBValue.length - 1]!))}</td>
                <td className={signClass(bCagr)}>{fmtPct(bCagr)}</td>
                <td className={bMaxDD < 0 ? 'dca-loss' : ''}>{fmtPct(bMaxDD)}</td>
                <td>0</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="tactical-takeaway">
        Sau <strong>{switching.switches.length}</strong> lần chuyển đổi, tổng phí{' '}
        <strong>{formatVND(Math.round(totalCost))}</strong>, chiến thuật {label} kết thúc
        với <strong>{formatVND(Math.round(finalValue))}</strong>, tức {fmtPct(strategyCagr)} mỗi
        năm và sụt giảm tối đa {fmtPct(strategyMaxDD)}. Mua giữ luôn {nameA} thì {fmtPct(aCagr)} mỗi
        năm, sụt {fmtPct(aMaxDD)}. Mua giữ luôn {nameB} thì {fmtPct(bCagr)} mỗi năm, sụt {fmtPct(bMaxDD)}.
        Đọc cả 3 con số cùng lúc. Lãi cao hơn không có nghĩa là tốt hơn, nếu sụt giảm cũng sâu hơn,
        hoặc nếu phần lớn lợi thế chỉ đến từ vài lần chuyển đổi may mắn.
      </div>

      {switching.switches.length > 0 && (
        <div className="chart-container">
          <div className="chart-header">
            <h3>Phân tích từng giai đoạn</h3>
          </div>
          <p className="dca-note">
            Chiến thuật {label} hơn hay kém mua giữ luôn {nameA} bao nhiêu? Phần chênh đó không
            rải đều qua năm tháng. Nó dồn vào vài đoạn.
          </p>
          <p className="dca-note">
            Bảng dưới cắt cả chặng thành từng đoạn. Mỗi đoạn là một lần chiến thuật giữ nguyên
            một danh mục. Cột cuối cho biết đoạn đó đóng góp bao nhiêu: số dương thì kéo chiến
            thuật vượt lên, số âm thì kéo tụt lại. Nhân dồn hết các đoạn lại thì ra đúng chênh
            lệch cuối kỳ, không thiếu chỗ nào.
          </p>
          <div className="dca-stats-table-scroll">
            <table className="dca-stats-table">
              <thead>
                <tr>
                  <th>Đoạn</th>
                  <th>Từ - Đến</th>
                  <th>Danh mục giữ</th>
                  <th>Số phiên</th>
                  <th>Đóng góp</th>
                </tr>
              </thead>
              <tbody>
                {advantage.segments.map((seg, i) => (
                  <tr key={i} className={i === topAdvantageIdx ? 'tactical-stats-row--highlight' : ''}>
                    <td>{i + 1}</td>
                    <td>{fmtDate(seg.from)} → {fmtDate(seg.to)}</td>
                    <td style={{ color: colorOf(seg.allocation) }}>{nameOf(seg.allocation)}</td>
                    <td>{seg.days}</td>
                    <td className={signClass(seg.factor - 1)}>{fmtPct(seg.factor - 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {advantage.topPositiveShare !== null && topAdvantageIdx >= 0 && (
            <p className={advantage.topPositiveShare > 0.5 ? 'tactical-signal-warning' : 'dca-note'}>
              {advantage.topPositiveShare > 0.5 ? (
                <>Nhìn kỹ đoạn {fmtDate(advantage.segments[topAdvantageIdx]!.from)} →{' '}
                {fmtDate(advantage.segments[topAdvantageIdx]!.to)}, lúc đó chiến thuật đang giữ{' '}
                {nameOf(advantage.segments[topAdvantageIdx]!.allocation)}. Riêng nó chiếm{' '}
                <strong>{(advantage.topPositiveShare * 100).toFixed(0)}%</strong> tổng phần đóng góp dương.
                {' '}Nghĩa là bạn tưởng mình đang xem kết quả của {advantage.segments.length} lần quyết định.
                Thật ra gần như chỉ một. Một lần chuyển đúng lúc. Một lần thì chưa đủ để chắc chắn
                điều gì cả.</>
              ) : (
                <>* Đoạn đóng góp nhiều nhất là {fmtDate(advantage.segments[topAdvantageIdx]!.from)} →{' '}
                {fmtDate(advantage.segments[topAdvantageIdx]!.to)}, lúc đó giữ {nameOf(advantage.segments[topAdvantageIdx]!.allocation)},
                chiếm {(advantage.topPositiveShare * 100).toFixed(0)}% tổng phần đóng góp dương. Phần còn
                lại trải ra nhiều đoạn khác, không dồn hết vào một lần.</>
              )}
            </p>
          )}
        </div>
      )}

      {switching.switches.length > 0 && (
        <div className="chart-container">
          <div className="chart-header">
            <h3>Nhật ký chuyển đổi</h3>
          </div>
          <div className="dca-stats-table-scroll">
            <table className="dca-stats-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Từ</th>
                  <th>Sang</th>
                  <th>Phí</th>
                </tr>
              </thead>
              <tbody>
                {switching.switches.map((sw, i) => (
                  <tr key={i}>
                    <td>{fmtDate(sw.date)}</td>
                    <td style={{ color: colorOf(sw.from) }}>{nameOf(sw.from)}</td>
                    <td style={{ color: colorOf(sw.to) }}>{nameOf(sw.to)}</td>
                    <td>{formatVND(Math.round(sw.costPaid))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="tactical-disclaimer">
        <p>⚠️ Đây KHÔNG phải khuyến nghị đầu tư.</p>
        <p>
          Mọi chỉ báo kỹ thuật đều đi sau thị trường. Xu hướng phải chạy một đoạn thì chỉ báo mới
          đổi theo. Lúc bạn nhìn thấy tín hiệu, giá đã đi mất một quãng rồi.
        </p>
        <p>
          Còn một cái bẫy nữa tên là whipsaw. Giá dập dềnh quanh ngưỡng, tín hiệu đổi qua đổi lại
          liên tục, lần nào cũng mất phí mà chẳng được gì.
        </p>
        <p>
          Quá khứ không bảo đảm tương lai. Một chiến thuật thắng mua và giữ suốt 10 năm qua không
          có nghĩa nó thắng tiếp 10 năm tới.
        </p>
      </div>
    </div>
  )
}

const TacticalResults = memo(TacticalResultsImpl)

function signClass(v: number | null): string {
  if (v === null) return ''
  return v >= 0 ? 'dca-profit' : 'dca-loss'
}

function fmtPct(v: number | null): string {
  if (v === null) return '—'
  const pct = v * 100
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
