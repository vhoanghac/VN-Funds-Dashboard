/**
 * TacticalAllocationPanel: tab "Chiến thuật phân bổ".
 *
 * Trả lời câu hỏi retail VN hay hỏi: "NAV quỹ X trên/dưới MA200 thì có nên
 * chuyển sang quỹ Y không?" — mô phỏng chuyển đổi giữa 2 danh mục (mỗi danh
 * mục có thể nhiều quỹ, tái dùng PortfolioCard) dựa trên tín hiệu Giá vs
 * SMA(N) của MỘT ticker do người dùng chọn riêng (không nhất thiết là quỹ
 * đang nắm giữ).
 *
 * Cố tình thu hẹp so với công cụ Tactical Allocation của testfol.io: đúng 1
 * kiểu tín hiệu, đúng 2 trạng thái, độ trễ thực thi CỐ ĐỊNH T+1 (không cho
 * chỉnh) — xem utils/tactical.ts để biết lý do.
 */
import { useState, useMemo, useEffect, memo } from 'react'
import Select from 'react-select'
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, ReferenceArea, ReferenceLine, Legend,
} from 'recharts'
import type { FundMeta, PricePoint } from '../types'
import { parseCSV, parseGoldCSV } from '../utils/csvParser'
import { loadAdjustedPrices } from '../utils/dividendAdjust'
import { dcaCagr, dcaMaxDrawdown, derivePortfolioName } from '../utils/dca'
import { runTacticalBacktest, type TacticalBacktestResult, type AllocationId, type IndicatorType } from '../utils/tactical'
import { PortfolioCard, portfolioSelectStyles, PORTFOLIO_COLORS, type PortfolioCardState } from './PortfolioCard'
import { MoneyInput } from './MoneyInput'
import { formatVND } from '../utils/vndFormat'

interface Props {
  funds: FundMeta[]
}

type DateRangeMode = 'all' | 'years'

const INDICATOR_OPTIONS: IndicatorType[] = ['SMA', 'EMA', 'RSI']
const COLOR_A = PORTFOLIO_COLORS[0]!
const COLOR_B = PORTFOLIO_COLORS[1]!

/** Nhãn hiển thị cho 1 cấu hình chỉ báo, vd "SMA200", "RSI14". */
function indicatorLabel(type: IndicatorType, period: number): string {
  return `${type}${period}`
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

  const [fundData, setFundData] = useState<Map<string, PricePoint[]>>(new Map())
  const [loading, setLoading] = useState(false)

  const [committed, setCommitted] = useState<{
    signalFundId: string
    indicatorType: IndicatorType
    period: number
    toleranceBandPct: number
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
  } | null>(null)

  const fundOptions = useMemo(() => funds.map(f => ({ value: f.id, label: f.name_vi })), [funds])
  const dualPriceFundIds = useMemo(() => new Set(funds.filter(f => f.type === 'gold').map(f => f.id)), [funds])

  const neededIds = useMemo(() => {
    const ids = new Set<string>()
    if (signalFundId) ids.add(signalFundId)
    for (const s of allocationA.slots) if (s.fundId) ids.add(s.fundId)
    for (const s of allocationB.slots) if (s.fundId) ids.add(s.fundId)
    return ids
  }, [signalFundId, allocationA.slots, allocationB.slots])

  useEffect(() => {
    let cancelled = false
    const toFetch = Array.from(neededIds).filter(id => !fundData.has(id))
    if (toFetch.length === 0) return

    setLoading(true)
    Promise.all(
      toFetch.map(async id => {
        const resp = await fetch(`/data/${id}.csv`)
        if (!resp.ok) return null
        const text = await resp.text()
        if (dualPriceFundIds.has(id)) {
          const { buy } = parseGoldCSV(text)
          return { id, adjusted: buy }
        }
        const rawDaily = parseCSV(text)
        const adjustedDaily = await loadAdjustedPrices(id, rawDaily)
        return { id, adjusted: adjustedDaily }
      }),
    ).then(results => {
      if (cancelled) return
      setFundData(prev => {
        const next = new Map(prev)
        for (const r of results) if (r) next.set(r.id, r.adjusted)
        return next
      })
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [neededIds]) // eslint-disable-line react-hooks/exhaustive-deps

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

  function buildSnapshot() {
    const { from, to } = getEffectiveDates()
    return {
      signalFundId, indicatorType, period, toleranceBandPct, rsiOverbought, rsiOversold,
      allocationASlots: allocationA.slots.map(s => ({ ...s })),
      allocationARebalFreq: allocationA.rebalFreq,
      allocationBSlots: allocationB.slots.map(s => ({ ...s })),
      allocationBRebalFreq: allocationB.rebalFreq,
      startValue, switchCostPct,
      dateFrom: from, dateTo: to,
    }
  }

  function runBacktest() {
    if (!canRun) return
    setCommitted(buildSnapshot())
  }

  const isDirty = !!committed && JSON.stringify(committed) !== JSON.stringify(buildSnapshot())

  const result = useMemo(() => {
    if (!committed) return null
    if (!fundData.has(committed.signalFundId)) return null
    for (const s of committed.allocationASlots) if (s.fundId && !fundData.has(s.fundId)) return null
    for (const s of committed.allocationBSlots) if (s.fundId && !fundData.has(s.fundId)) return null

    return runTacticalBacktest({
      rawPrices: fundData,
      signalFundId: committed.signalFundId,
      indicatorType: committed.indicatorType,
      period: committed.period,
      toleranceBandPct: committed.toleranceBandPct,
      rsiOverbought: committed.rsiOverbought,
      rsiOversold: committed.rsiOversold,
      allocationASlots: committed.allocationASlots,
      allocationARebalFreq: committed.allocationARebalFreq,
      allocationBSlots: committed.allocationBSlots,
      allocationBRebalFreq: committed.allocationBRebalFreq,
      startValue: committed.startValue,
      switchCostPct: committed.switchCostPct,
      dateFrom: committed.dateFrom || undefined,
      dateTo: committed.dateTo || undefined,
    })
  }, [committed, fundData])

  const nameA = allocationA.name || 'Danh mục A'
  const nameB = allocationB.name || 'Danh mục B'
  const signalFundName = fundOptions.find(o => o.value === signalFundId)?.label || signalFundId

  return (
    <div className="simulation-panel">
      <div className="panel-header">
        <h2>Chiến Thuật Phân Bổ</h2>
      </div>

      <div className="rebal-intro-card">
        <p className="dca-ratio-sub">
          Trả lời câu hỏi: <strong>nếu chuyển đổi giữa 2 danh mục dựa trên tín hiệu từ một chỉ báo
          kỹ thuật (SMA, EMA, hoặc RSI), kết quả thực tế sẽ ra sao?</strong> Chọn 1 quỹ/chỉ số làm
          tín hiệu (không nhất thiết là quỹ bạn nắm giữ), 2 danh mục A/B tuỳ ý — khi tín hiệu chỉ
          về xu hướng tăng, chuyển sang danh mục A; khi chỉ về xu hướng giảm, chuyển sang danh
          mục B.
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
          * Phí chuyển đổi trừ trên giá trị danh mục mỗi lần đổi allocation — nhiều quỹ mở VN
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
              * RSI xuống dưới mốc quá bán → kỳ vọng hồi phục, chuyển sang danh mục A. RSI vượt lên
              trên mốc quá mua → kỳ vọng điều chỉnh, chuyển sang danh mục B. Ở giữa 2 mốc: giữ
              nguyên trạng thái trước đó — chính khoảng cách giữa 2 mốc đã đóng vai trò "vùng đệm"
              chống nhấp nháy, không cần thêm tham số riêng. Lệnh chuyển luôn thực hiện vào phiên
              giao dịch KẾ TIẾP sau khi có tín hiệu (không thể phản ứng ngay trong phiên đang xét).
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
              * Vùng đệm quanh đường {indicatorType} giúp tín hiệu không "nhấp nháy" (chuyển qua
              chuyển lại liên tục) khi giá dao động sát đường trung bình — chỉ đổi khi giá vượt hẳn
              ra khỏi vùng ± X% quanh đường {indicatorType}. Đặt 0% nếu muốn đổi ngay khi giá cắt
              qua. Lệnh chuyển luôn thực hiện vào phiên giao dịch KẾ TIẾP sau khi có tín hiệu (không
              thể phản ứng ngay trong phiên đang xét).
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

      {committed && !loading && !result && (
        <div className="error-banner">
          Không đủ dữ liệu để mô phỏng — kiểm tra lại quỹ đã chọn, hoặc cần nhiều lịch sử hơn để
          tính đủ {indicatorLabel(committed.indicatorType, committed.period)} (~{Math.round(committed.period / 21)} tháng
          dữ liệu trước ngày bắt đầu).
        </div>
      )}

      {result && (
        <TacticalResults
          result={result}
          nameA={nameA}
          nameB={nameB}
          signalFundName={signalFundName}
          indicatorType={committed!.indicatorType}
          period={committed!.period}
          rsiOverbought={committed!.rsiOverbought}
          rsiOversold={committed!.rsiOversold}
        />
      )}
    </div>
  )
}

export const TacticalAllocationPanel = memo(TacticalAllocationPanelImpl)

// ─── Kết quả ──────────────────────────────────────────────────────

function TacticalResults({
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
  const { switching, indicatorSeries, strategyCumulative, buyHoldACumulative, buyHoldBCumulative, requestedStartDate, effectiveStartDate } = result
  const label = indicatorLabel(indicatorType, period)

  const nameOf = (id: AllocationId) => id === 'A' ? nameA : nameB
  const colorOf = (id: AllocationId) => id === 'A' ? COLOR_A : COLOR_B

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
        Dựa trên dữ liệu tới <strong>{fmtDate(lastDate)}</strong>: giá <strong>{signalFundName}</strong>{' '}
        đang ở vị trí khiến tín hiệu {label} chỉ về{' '}
        <strong style={{ color: colorOf(switching.currentSignal) }}>{currentAllocationName}</strong> —
        nếu giữ kỷ luật, phiên giao dịch kế tiếp nên đang nắm giữ danh mục này.
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

      <div className="tactical-takeaway">
        Sau <strong>{switching.switches.length}</strong> lần chuyển đổi (tổng phí{' '}
        <strong>{formatVND(Math.round(totalCost))}</strong>), chiến thuật {label} kết thúc
        với <strong>{formatVND(Math.round(finalValue))}</strong> ({fmtPct(strategyCagr)} CAGR, sụt
        giảm tối đa {fmtPct(strategyMaxDD)}) — so với nếu chỉ mua giữ luôn {nameA} ({fmtPct(aCagr)}{' '}
        CAGR, sụt {fmtPct(aMaxDD)}) hoặc luôn {nameB} ({fmtPct(bCagr)} CAGR, sụt {fmtPct(bMaxDD)}).
        Đọc cả 3 con số cùng lúc — CAGR cao hơn không có nghĩa chiến thuật tốt hơn nếu sụt giảm
        cũng sâu hơn, hoặc nếu phần lớn lợi thế chỉ đến từ vài lần chuyển đổi may mắn.
      </div>

      {switching.switches.length > 0 && (
        <div className="tactical-switch-log">
          <h4 className="tactical-switch-log-title">Nhật ký chuyển đổi</h4>
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
        ⚠️ Đây KHÔNG phải khuyến nghị đầu tư. Tín hiệu kỹ thuật (SMA/EMA/RSI) có độ trễ tự nhiên
        (chỉ nhận ra xu hướng SAU KHI nó đã bắt đầu) và dễ gặp "whipsaw" — giá trị dao động qua lại
        quanh ngưỡng khiến chiến thuật chuyển đổi liên tục, mỗi lần đều mất phí mà không thu được
        gì. Quá khứ không đảm bảo
        tương lai; một chiến thuật thắng buy-and-hold trong quá khứ không chắc sẽ thắng tiếp.
      </div>
    </div>
  )
}

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
