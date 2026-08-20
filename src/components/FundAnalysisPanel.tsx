import { useState, useEffect, useMemo, memo } from 'react'
import Select from 'react-select'
import {
  AreaChart, Area, BarChart, Bar, Cell, LineChart, Line, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts'
import type { FundMeta, PricePoint, ReturnPoint } from '../types'
import { loadLS, saveLS } from '../utils/localStorage'
import { formatVND, formatVNDAxis } from '../utils/vndFormat'
import { maxDrawdown, drawdownSeries } from '../utils/calculations'
import {
  parseTidyPortfolio, parseTidyAssets, parseTidyIncome, parseTidyIndicators, fundReportPeriods, resolveReportPeriod,
  type FundPeriodSummary, type FundAssetsSnapshot, type FundIncomeSummary, type FundFlowSummary,
} from '../utils/fundReport'
import { RedFlagDetectors } from './RedFlagSection'

/**
 * Tab "Phân Tích Quỹ" — đọc báo cáo tài chính tháng chính thức (Thông tư
 * 98/2020/TT-BTC) của quỹ, hiện tại chỉ DCDS có dữ liệu tidy (92 kỳ).
 *
 * Bố cục:
 *   1. Tổng tài sản — pie phân bổ 4 loại tài sản + chi tiết bên phải.
 *   2. Tổng tài sản qua các tháng — cột, luôn hiện toàn bộ lịch sử.
 *   3. Tiền mặt qua các tháng — cột, luôn hiện toàn bộ lịch sử.
 *   4. Danh mục quỹ — bảng cổ phiếu.
 * Input "Kỳ báo cáo" đặt RIÊNG trong block 1 và block 4 (độc lập nhau,
 * mặc định "Mới nhất"). Hai biểu đồ cột là xu hướng nên không có input.
 */

interface Props {
  funds: FundMeta[]
}

interface FundOption {
  value: string
  label: string
}

/** Quỹ có báo cáo tài chính tidy. Chỉ DCDS hiện tại; thêm khi quỹ khác có report. */
const REPORT_FUNDS = ['DCDS']

/** Màu tài sản theo bảng màu digiinvest (donut + cards phân bổ).
 *  Cổ phiếu + tổng tài sản dùng màu chủ đạo dashboard (--color-primary)
 *  để khớp tone button tab. */
const ASSET_COLORS = {
  stock: 'var(--color-primary)',
  bond: '#818cf8',
  cash: '#34d399',
  other: '#94a3b8',
} as const

/** Màu bar biểu đồ xu hướng + màu highlight tháng đang chọn. */
const SERIES_COLOR = '#3b82f6'
const CASH_SERIES_COLOR = '#16a34a'
const BANK_DEPOSIT_COLOR = '#0d9488'

/** Màu chart NAV/CCQ (giá quỹ) + xanh/đỏ cho lợi nhuận & dòng tiền. */
const NAV_CCQ_COLOR = '#0ea5e9'
const PROFIT_POS = '#059669'
const PROFIT_NEG = '#dc2626'
const FLOW_POS = '#059669'
const FLOW_NEG = '#dc2626'

/** Màu chart thu nhập / chi phí / lãi-lỗ (từ báo cáo kết quả hoạt động). */
const DIVIDEND_COLOR = '#059669'
const INTEREST_COLOR = '#0ea5e9'
const MGMT_FEE_COLOR = '#f59e0b'
const BROKERAGE_COLOR = '#f97316'
/** Màu chart mới: quy mô / dòng tiền / turnover / nhà đầu tư. */
const UNITS_COLOR = '#64748b'
const INVEST_COLOR = '#3b82f6'
const FLOW_NAV_COLOR = '#f97316'
const TURNOVER_COLOR = '#3b82f6'
const INVESTOR_COLOR = '#8b5cf6'
const OWNERSHIP_FMC_COLOR = '#6366f1'
const TOP10_COLOR = '#e11d48'
const FOREIGN_COLOR = '#0ea5e9'
const TOTAL_COST_COLOR = '#0ea5e9'

/** Màu chart: drawdown / red flags. */
const DRAWDOWN_COLOR = '#dc2626'
const LIAB_COLOR = '#b45309'
const SETTLE_COLOR = '#f97316'
const AUM_AXIS_COLOR = '#3b82f6'
const FLOW_AXIS_COLOR = '#f97316'

/** Palette cho donut phân bổ ngành. */
const INDUSTRY_COLORS = ['#3b82f6', '#f59e0b', '#059669', '#8b5cf6', '#ef4444', '#0ea5e9', '#f97316', '#64748b']

/** Các section kết quả (kiểu tab DCA): bấm pill để chỉ hiện section đó. */
const ANALYSIS_SECTIONS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'allocation', label: 'Cấu trúc & Phân bổ' },
  { id: 'perf', label: 'Hiệu suất & Rủi ro' },
  { id: 'size', label: 'Quy mô & Dòng tiền' },
  { id: 'cost', label: 'Chi phí & Hiệu quả' },
  { id: 'redflags', label: 'Red Flags' },
] as const
type AnalysisSectionId = typeof ANALYSIS_SECTIONS[number]['id']

/** Các loại tài sản cho stacked bar cơ cấu (khớp ASSET_COLORS). */
const ALLOC_KEYS = ['Cổ phiếu', 'Trái phiếu', 'Tiền mặt', 'Tài sản khác'] as const
const ALLOC_FIELDS = ['stockValue', 'bondValue', 'cashValue', 'otherValue'] as const

interface PeriodOption {
  value: string | null
  label: string
}

const selectStyles = {
  control: (base: Record<string, unknown>) => ({
    ...base,
    minHeight: 38,
    borderColor: '#e5e7eb',
    boxShadow: 'none',
    '&:hover': { borderColor: '#2563EB' },
    fontSize: '0.95rem',
  }),
  menu: (base: Record<string, unknown>) => ({ ...base, zIndex: 20 }),
  option: (base: Record<string, unknown>, state: { isFocused: boolean; isSelected: boolean }) => ({
    ...base,
    fontSize: '0.9rem',
    backgroundColor: state.isSelected ? '#2563EB' : state.isFocused ? '#eff6ff' : undefined,
    color: state.isSelected ? 'white' : '#1a1a1a',
  }),
}

/** "2026-07-31" → "Tháng 7/2026" */
function formatPeriodLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split('-')
  if (!y || !m) return periodEnd
  return `Tháng ${Number(m)}/${y}`
}

/** "2026-07-31" → "7/26" (nhãn trục X gọn cho 92 bar). */
function formatAxisTick(periodEnd: string): string {
  const [y, m] = periodEnd.split('-')
  if (!y || !m) return periodEnd
  return `${Number(m)}/${y.slice(2)}`
}

/**
 * Định dạng tiền kiểu digiinvest: "5.971,7 tỷ" — nhóm nghìn bằng dấu chấm,
 * dấu phẩy thập phân, 1 số lẻ từ 10 tỷ trở lên, 2 số lẻ dưới 10 tỷ.
 */
function formatVNDLocale(value: number): string {
  const sign = value < 0 ? '-' : ''
  const ty = Math.abs(value) / 1_000_000_000
  const decimals = ty >= 10 ? 1 : 2
  const [int = '0', frac = '0'] = ty.toFixed(decimals).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${sign}${grouped},${frac} tỷ`
}

/** Chữ ký delta có dấu, vd "+16,3%" / "-17,2%". value = phân số (0.163). */
function signedPct(value: number): string {
  const sign = value >= 0 ? '+' : '-'
  return `${sign}${(Math.abs(value) * 100).toFixed(1)}%`
}

export function top10StocksForPeriod(
  portfolio: Map<string, FundPeriodSummary> | null,
  period: string | null,
) {
  return (period ? portfolio?.get(period)?.stocks : null)?.slice(0, 10) ?? []
}

export function industryAllocationForPeriod(
  portfolio: Map<string, FundPeriodSummary> | null,
  period: string | null,
  industryMap: Record<string, string>,
) {
  const stocks = period ? portfolio?.get(period)?.stocks : null
  if (!stocks) return []

  const byIndustry = new Map<string, number>()
  for (const stock of stocks) {
    const industry = industryMap[stock.ticker] ?? 'Khác'
    byIndustry.set(industry, (byIndustry.get(industry) ?? 0) + stock.weightPct)
  }

  return [...byIndustry.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
}

function FundAnalysisPanelImpl({ funds }: Props) {
  const [fundId, setFundId] = useState<string>(() => {
    const saved = loadLS<string>('fund_analysis_fund', REPORT_FUNDS[0]!)
    return REPORT_FUNDS.includes(saved) ? saved : REPORT_FUNDS[0]!
  })
  const [piePeriod, setPiePeriod] = useState<string | null>(() => loadLS<string | null>('fund_analysis_pie_period', null))
  const [tablePeriod, setTablePeriod] = useState<string | null>(() => loadLS<string | null>('fund_analysis_table_period', null))

  const [portfolio, setPortfolio] = useState<Map<string, FundPeriodSummary> | null>(null)
  const [assets, setAssets] = useState<Map<string, FundAssetsSnapshot> | null>(null)
  const [income, setIncome] = useState<Map<string, FundIncomeSummary> | null>(null)
  const [flow, setFlow] = useState<Map<string, FundFlowSummary> | null>(null)
  const [industryMap, setIndustryMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<AnalysisSectionId>('all')

  useEffect(() => { saveLS('fund_analysis_fund', fundId) }, [fundId])
  useEffect(() => { saveLS('fund_analysis_pie_period', piePeriod) }, [piePeriod])
  useEffect(() => { saveLS('fund_analysis_table_period', tablePeriod) }, [tablePeriod])

  const showSection = (id: AnalysisSectionId) =>
    activeSection === 'all' || activeSection === id ? undefined : 'none'

  // Load dữ liệu báo cáo của quỹ đang chọn (static, chỉ fetch 1 lần mỗi fund).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const load = async () => {
      const [pfResp, asResp, icResp, flResp, indResp] = await Promise.all([
        fetch(`/data/${fundId}/tidied/tidy_portfolio.csv`),
        fetch(`/data/${fundId}/tidied/tidy_assets.csv`),
        fetch(`/data/${fundId}/tidied/tidy_income.csv`),
        fetch(`/data/${fundId}/tidied/tidy_indicators.csv`),
        fetch('/data/industry_map.json'),
      ])
      if (cancelled) return
      const pf = pfResp.ok ? await pfResp.text() : ''
      const as = asResp.ok ? await asResp.text() : ''
      const ic = icResp.ok ? await icResp.text() : ''
      const fl = flResp.ok ? await flResp.text() : ''
      const ind = indResp.ok ? (await indResp.json()) as Record<string, string> : {}
      if (!pf) {
        setError('Quỹ này chưa có dữ liệu báo cáo tài chính.')
      }
      setPortfolio(parseTidyPortfolio(pf))
      setAssets(parseTidyAssets(as))
      setIncome(parseTidyIncome(ic))
      setFlow(parseTidyIndicators(fl))
      setIndustryMap(ind)
      setLoading(false)
    }

    load().catch(() => {
      if (!cancelled) {
        setError('Không tải được dữ liệu báo cáo.')
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [fundId])

  const periods = useMemo(
    () => portfolio ? fundReportPeriods(portfolio) : [],
    [portfolio],
  )

  const pieResolved = useMemo(
    () => portfolio ? resolveReportPeriod(periods, piePeriod) : null,
    [portfolio, periods, piePeriod],
  )
  const tableResolved = useMemo(
    () => portfolio ? resolveReportPeriod(periods, tablePeriod) : null,
    [portfolio, periods, tablePeriod],
  )

  const fundOptions: FundOption[] = useMemo(
    () => REPORT_FUNDS
      .map(id => {
        const meta = funds.find(f => f.id === id)
        return { value: id, label: meta ? meta.name_vi : id }
      }),
    [funds],
  )
  const selectedFund = fundOptions.find(o => o.value === fundId) ?? fundOptions[0]

  const periodOptions: PeriodOption[] = useMemo(
    () => [
      { value: null, label: 'Mới nhất' },
      ...periods.map(p => ({ value: p, label: formatPeriodLabel(p) })),
    ],
    [periods],
  )

  // ── Block 1: Tổng tài sản (donut + cards phân bổ) ──
  const piePeriodSummary = pieResolved ? portfolio?.get(pieResolved) : null
  const pieIndex = pieResolved ? periods.indexOf(pieResolved) : -1
  // Kỳ trước (chronological) để so delta "so với kỳ trước" — kỳ cũ nhất không có.
  const prevPeriod = pieIndex >= 0 && pieIndex < periods.length - 1 ? periods[pieIndex + 1] : null
  const prevSummary = prevPeriod ? portfolio?.get(prevPeriod) : null

  const pieData = useMemo(() => {
    const a = piePeriodSummary?.allocation
    if (!a) return []
    const items = [
      { name: 'Cổ phiếu', value: a.stockValue, field: 'stockValue' as const, color: ASSET_COLORS.stock },
      { name: 'Trái phiếu', value: a.bondValue, field: 'bondValue' as const, color: ASSET_COLORS.bond },
      { name: 'Tiền mặt', value: a.cashValue, field: 'cashValue' as const, color: ASSET_COLORS.cash },
      { name: 'Tài sản khác', value: a.otherValue, field: 'otherValue' as const, color: ASSET_COLORS.other },
    ]
    return items.filter(d => d.value > 0)
  }, [piePeriodSummary])

  // Conic-gradient 4 slice, mỗi slice một cặp stop (màu từ → màu đến theo phần trăm).
  const donutGradient = useMemo(() => {
    const a = piePeriodSummary?.allocation
    if (!a || a.totalValue <= 0) return null
    let acc = 0
    const stops: string[] = []
    for (const d of pieData) {
      const from = (acc / a.totalValue) * 100
      acc += d.value
      const to = (acc / a.totalValue) * 100
      stops.push(`${d.color} ${from.toFixed(2)}%, ${d.color} ${to.toFixed(2)}%`)
    }
    return `conic-gradient(${stops.join(', ')})`
  }, [piePeriodSummary, pieData])

  const pieTotal = piePeriodSummary?.allocation.totalValue ?? 0
  const pieAssets = pieResolved ? assets?.get(pieResolved) : null

  // Delta so kỳ trước cho header + từng loại tài sản.
  const headerDelta = useMemo(() => {
    const prevTotal = prevSummary?.allocation.totalValue
    if (prevTotal == null || prevTotal <= 0 || !prevPeriod) return null
    const delta = pieTotal - prevTotal
    return {
      label: formatPeriodLabel(prevPeriod),
      absLabel: formatVNDLocale(Math.abs(delta)),
      pctLabel: signedPct(delta / prevTotal),
      positive: delta >= 0,
    }
  }, [prevSummary, prevPeriod, pieTotal])

  const categoryDelta = (field: 'stockValue' | 'bondValue' | 'cashValue' | 'otherValue', value: number) => {
    const prevVal = prevSummary?.allocation[field]
    if (prevVal == null || !prevPeriod) return null
    const delta = value - prevVal
    // Kỳ trước = 0 (vd trái phiếu mới xuất hiện) thì không có % — chỉ ghi số tuyệt đối.
    const pctLabel = prevVal > 0 ? ` (${signedPct(delta / prevVal)})` : ''
    return {
      label: `${formatVNDLocale(Math.abs(delta))}${pctLabel}`,
      positive: delta >= 0,
      show: delta !== 0,
    }
  }

  // ── Block 2 & 3: chuỗi tổng tài sản / tiền mặt qua các tháng ──
  // periods xếp GIẢM dần (cho dropdown); biểu đồ cột phải chạy tăng dần theo
  // thời gian (cũ nhất trái → mới nhất phải), nên đảo ngược riêng cho chart.
  const chartPeriods = useMemo(() => [...periods].reverse(), [periods])
  // ── Chart B: quy mô quỹ = tài sản RÒNG (NAV cuối kỳ, 2217) ──
  // Dùng NAV thay vì tổng tài sản gộp (2212): AUM chuẩn ngành là tài sản
  // thuộc về nhà đầu tư, không pha nợ phải trả. Khớp 2243 trong báo cáo.
  const aumSeries = useMemo(
    () => chartPeriods.map(p => ({
      period: p,
      value: assets?.get(p)?.nav ?? 0,
    })),
    [assets, chartPeriods],
  )

  // ── Chart A: NAV/CCQ (giá quỹ) theo tháng — từ tidy_assets 2219 ──
  const navCcqSeries = useMemo(
    () => chartPeriods.map(p => ({
      period: p,
      value: assets?.get(p)?.navPerUnit ?? 0,
    })),
    [assets, chartPeriods],
  )

  // ── Chart B: cơ cấu tài sản theo tháng (100% stacked) ──
  const allocationSeries = useMemo(
    () => chartPeriods.map(p => {
      const a = portfolio?.get(p)?.allocation
      const tot = a && a.totalValue > 0 ? a.totalValue : 0
      const pct = (v: number) => (tot ? (v / tot) * 100 : 0)
      return {
        period: p,
        'Cổ phiếu': pct(a?.stockValue ?? 0),
        'Trái phiếu': pct(a?.bondValue ?? 0),
        'Tiền mặt': pct(a?.cashValue ?? 0),
        'Tài sản khác': pct(a?.otherValue ?? 0),
      }
    }),
    [portfolio, chartPeriods],
  )

  // ── Tiền mặt (tiền và tương đương tiền) tuyệt đối theo tháng ──
  const cashSeries = useMemo(
    () => chartPeriods.map(p => ({
      period: p,
      value: portfolio?.get(p)?.allocation.cashValue ?? 0,
    })),
    [portfolio, chartPeriods],
  )

  // ── Chart C: Lợi nhuận quỹ THẬT theo tháng — 2237 (đổi NAV do đầu tư) ──
  const profitSeries = useMemo(
    () => chartPeriods.map(p => ({
      period: p,
      value: income?.get(p)?.investmentProfit ?? 0,
    })),
    [income, chartPeriods],
  )

  // ── Chart C2: Phân rã lãi/lỗ đầu tư — thực hiện (2235) + chưa thực hiện (2236) ──
  const gainSeries = useMemo(
    () => chartPeriods.map(p => {
      const s = income?.get(p)
      return {
        period: p,
        'Thực hiện': s?.realizedGain ?? 0,
        'Chưa thực hiện': s?.unrealizedGain ?? 0,
      }
    }),
    [income, chartPeriods],
  )

  // ── Chart D: Thu nhập theo tháng — cổ tức (2221.1) + lãi tiền gửi (2222) ──
  const incomeSrcSeries = useMemo(
    () => chartPeriods.map(p => {
      const s = income?.get(p)
      return {
        period: p,
        'Cổ tức': s?.dividends ?? 0,
        'Lãi tiền gửi': s?.interestIncome ?? 0,
      }
    }),
    [income, chartPeriods],
  )

  // ── Chart D2: Chi phí theo tháng — phí quản lý (2225) + phí giao dịch (2231) ──
  const costSeries = useMemo(
    () => chartPeriods.map(p => {
      const s = income?.get(p)
      return {
        period: p,
        'Phí quản lý': s?.managementFee ?? 0,
        'Phí giao dịch': s?.brokerageFee ?? 0,
      }
    }),
    [income, chartPeriods],
  )

  // ── Chart E: dòng tiền ròng (2239.3) — thay đổi NAV do phát hành/mua lại ──
  // Dùng con số chính xác từ báo cáo thay vì (số CCQ 2277−22781) × NAV/CCQ cuối kỳ
  // vốn là ước tính (lệch ~2% vì mua/bán diễn ra ở NAV khác nhau trong tháng).
  const flowSeries = useMemo(
    () => chartPeriods.map(p => ({
      period: p,
      value: income?.get(p)?.navChangeByFlow ?? 0,
    })),
    [income, chartPeriods],
  )

  // ── Phát hành (2239.3.1) / mua lại (2239.3.2) CCQ theo tháng ──
  // 25 kỳ đầu (trước 12/2020) báo cáo không tách mục này → null để vẽ khoảng trống.
  const subRedSeries = useMemo(
    () => chartPeriods.map(p => {
      const s = income?.get(p)
      return {
        period: p,
        'Phát hành': s?.subscriptionFlow ?? null,
        'Mua lại': s?.redemptionFlow ?? null,
      }
    }),
    [income, chartPeriods],
  )

  // ── Chart mới: số chứng chỉ quỹ lưu hành (2281) ──
  const unitsSeries = useMemo(
    () => chartPeriods.map(p => ({
      period: p,
      value: flow?.get(p)?.outstandingUnits ?? 0,
    })),
    [flow, chartPeriods],
  )

  // ── Chart mới: thay đổi tổng NAV — đầu tư (2237) vs dòng tiền (2239.3) ──
  const navChangeSeries = useMemo(
    () => chartPeriods.map(p => {
      const s = income?.get(p)
      return {
        period: p,
        'Đầu tư': s?.investmentProfit ?? 0,
        'Dòng tiền': s?.navChangeByFlow ?? 0,
      }
    }),
    [income, chartPeriods],
  )

  // ── Chart mới: lợi nhuận theo tháng (% NAV/CCQ) — hiệu quả thật trên 1 đơn vị ──
  const navCcqReturnSeries = useMemo(() => {
    const out: { period: string; value: number }[] = []
    for (let i = 0; i < chartPeriods.length; i++) {
      const p = chartPeriods[i]!
      const cur = assets?.get(p)?.navPerUnit ?? 0
      const prev = i > 0 ? assets?.get(chartPeriods[i - 1]!)?.navPerUnit ?? 0 : 0
      out.push({ period: p, value: prev > 0 ? ((cur - prev) / prev) * 100 : 0 })
    }
    return out
  }, [assets, chartPeriods])

  // ── Chart mới: portfolio turnover rate (2270) ──
  // CSV lưu tỉ lệ thô (6,8399 = 6,84 lần = 683,99%). Báo cáo công bố theo phần trăm
  // nên ×100 trước khi vẽ để khớp con số công bố.
  const turnoverSeries = useMemo(
    () => chartPeriods.map(p => ({
      period: p,
      value: (flow?.get(p)?.turnoverRate ?? 0) * 100,
    })),
    [flow, chartPeriods],
  )

  // ── Chart mới: số nhà đầu tư (22841) ──
  const investorSeries = useMemo(
    () => chartPeriods.map(p => ({
      period: p,
      value: flow?.get(p)?.investorCount ?? 0,
    })),
    [flow, chartPeriods],
  )

  // ── Cơ cấu sở hữu: 2282 (công ty quản lý + bên liên quan), 2283 (top 10), 2284 (nước ngoài) ──
  const relatedPartySeries = useMemo(
    () => chartPeriods.map(p => ({ period: p, value: flow?.get(p)?.relatedPartyOwnership ?? null })),
    [flow, chartPeriods],
  )
  const top10Series = useMemo(
    () => chartPeriods.map(p => ({ period: p, value: flow?.get(p)?.top10Ownership ?? null })),
    [flow, chartPeriods],
  )
  const foreignSeries = useMemo(
    () => chartPeriods.map(p => ({ period: p, value: flow?.get(p)?.foreignOwnership ?? null })),
    [flow, chartPeriods],
  )

  // ── Chart mới: chi phí/NAV (%) — phí quản lý (2265) + tổng chi phí (2269) ──
  const feeRatioSeries = useMemo(
    () => chartPeriods.map(p => {
      const s = flow?.get(p)
      return {
        period: p,
        'Phí quản lý': s?.mgmtFeeRatio ?? 0,
        'Tổng chi phí': s?.expenseRatio ?? 0,
      }
    }),
    [flow, chartPeriods],
  )

  // ── Chuỗi NAV/CCQ theo tháng (PricePoint) — đầu vào cho các công thức có sẵn ──
  const navCcqPoints: PricePoint[] = useMemo(
    () => chartPeriods
      .map(p => ({ date: p, price: assets?.get(p)?.navPerUnit ?? 0 }))
      .filter(x => x.price > 0),
    [assets, chartPeriods],
  )
  const navCcqReturns: ReturnPoint[] = useMemo(() => {
    const out: ReturnPoint[] = []
    for (let i = 0; i < navCcqPoints.length; i++) {
      const prev = navCcqPoints[i - 1]?.price ?? 0
      out.push({ date: navCcqPoints[i]!.date, value: prev > 0 ? navCcqPoints[i]!.price / prev - 1 : 0 })
    }
    return out
  }, [navCcqPoints])

  // ── Max drawdown (Area, dùng drawdownSeries có sẵn) ──
  const drawdownSeriesData = useMemo(
    () => drawdownSeries(navCcqReturns).map(p => ({ period: p.date, value: p.value * 100 })),
    [navCcqReturns],
  )
  const maxDD = useMemo(() => maxDrawdown(navCcqReturns), [navCcqReturns])

  // ── Nhóm 3: phân bổ ngành theo kỳ đang chọn (donut) ──
  const industryAlloc = useMemo(() => {
    return industryAllocationForPeriod(portfolio, pieResolved, industryMap)
  }, [portfolio, pieResolved, industryMap])

  // Top 6 ngành + "Còn lại", kèm màu cho donut.
  const industryPie = useMemo(() => {
    const top = industryAlloc.slice(0, 6).map(d => ({ ...d }))
    const rest = industryAlloc.slice(6).reduce((s, x) => s + x.value, 0)
    if (rest > 0.01) top.push({ name: 'Còn lại', value: rest })
    return top.map((d, i) => ({ ...d, color: INDUSTRY_COLORS[i % INDUSTRY_COLORS.length]! }))
  }, [industryAlloc])

  // ── Nhóm 3: danh mục kỳ đang chọn (bảng) ──
  const tableStocks = useMemo(
    () => (tableResolved ? portfolio?.get(tableResolved)?.stocks : null) ?? [],
    [portfolio, tableResolved],
  )

  // Top 10 nằm cùng snapshot với Tổng tài sản, không dùng kỳ của bảng.
  const top10Stocks = useMemo(
    () => top10StocksForPeriod(portfolio, pieResolved),
    [portfolio, pieResolved],
  )

  // ── Nhóm 3: mức độ tập trung top-5 qua các kỳ ──
  const top5Concentration = useMemo(
    () => chartPeriods.map(p => {
      const stocks = portfolio?.get(p)?.stocks ?? []
      const top5 = stocks.slice(0, 5).reduce((s, x) => s + x.weightPct, 0)
      return { period: p, value: top5 }
    }),
    [portfolio, chartPeriods],
  )

  // ── Nhóm 5: nợ phải trả (2216) + phải thu bán CK chưa về (2208) ──
  const liabilitySeries = useMemo(
    () => chartPeriods.map(p => ({ period: p, value: assets?.get(p)?.liabilities ?? 0 })),
    [assets, chartPeriods],
  )
  const settlementSeries = useMemo(
    () => chartPeriods.map(p => ({ period: p, value: assets?.get(p)?.settlementReceivables ?? 0 })),
    [assets, chartPeriods],
  )
  const bankDepositSeries = useMemo(
    () => chartPeriods.map(p => ({ period: p, value: assets?.get(p)?.cashAtBank ?? 0 })),
    [assets, chartPeriods],
  )
  const cashAumSeries = useMemo(
    () => chartPeriods.map(p => {
      const cash = portfolio?.get(p)?.allocation.cashValue ?? null
      const nav = assets?.get(p)?.nav ?? null
      return {
        period: p,
        value: cash !== null && nav !== null && nav > 0 ? (cash / nav) * 100 : null,
      }
    }),
    [portfolio, assets, chartPeriods],
  )

  // ── Nhóm 5: độ lệch pha AUM vs dòng tiền (dual-axis) ──
  // AUM = NAV (tài sản ròng), nhất quán với chart "Quy mô quỹ" và narrative.
  const aumFlowSeries = useMemo(
    () => chartPeriods.map(p => ({
      period: p,
      AUM: assets?.get(p)?.nav ?? 0,
      'Dòng tiền': income?.get(p)?.navChangeByFlow ?? 0,
    })),
    [assets, income, chartPeriods],
  )

  // ── Red Flags: điểm dữ liệu cho detector (thuần, asc theo kỳ) ──
  const redFlagPoints = useMemo(
    () => chartPeriods.map(p => ({
      period: p,
      turnoverRate: flow?.get(p)?.turnoverRate ?? null,
      brokerageFee: income?.get(p)?.brokerageFee ?? null,
      managementFee: income?.get(p)?.managementFee ?? null,
    })),
    [flow, income, chartPeriods],
  )

  const selectPeriod = (
    value: string | null,
    onChange: (v: string | null) => void,
  ) => (
    <Select<PeriodOption>
      className="fund-search-select"
      classNamePrefix="fund-search"
      options={periodOptions}
      value={value === null
        ? { value: null, label: 'Mới nhất' }
        : { value, label: formatPeriodLabel(value) }}
      onChange={opt => opt && onChange(opt.value)}
      isClearable={false}
      styles={selectStyles}
    />
  )

  if (error) {
    return (
      <div className="simulation-panel dca-panel">
        <div className="error-banner">{error}</div>
      </div>
    )
  }

  return (
    <div className="simulation-panel dca-panel">
      <div className="panel-header">
        <h2>Phân Tích Quỹ</h2>
      </div>

      {/* ── Thông số ── */}
      <div className="dca-params-card">
        <h3 className="dca-section-title">Thông số</h3>
        <div className="dca-param-row">
          <label className="dca-label">Quỹ</label>
          <div className="overlap-select">
            <Select<FundOption>
              className="fund-search-select"
              classNamePrefix="fund-search"
              options={fundOptions}
              value={selectedFund}
              onChange={opt => opt && setFundId(opt.value)}
              isSearchable={false}
              styles={selectStyles}
            />
          </div>
        </div>
      </div>

      {loading && <div className="loading-indicator">Đang tải dữ liệu...</div>}

      {!loading && portfolio && (
        <>
          {/* ── Pills chọn section (kiểu tab DCA) ── */}
          <div className="dca-anchor-nav">
            {ANALYSIS_SECTIONS.map(s => (
              <button
                key={s.id}
                className={`dca-anchor-btn${activeSection === s.id ? ' dca-anchor-btn--active' : ''}`}
                onClick={() => setActiveSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* ════════════ Nhóm 3: Cấu trúc & Phân bổ ════════════ */}
          <div style={{ display: showSection('allocation') }}>
            <div className="section-divider">
              <span className="section-divider-label">Cấu trúc & Phân bổ</span>
            </div>

            {/* ── Tổng tài sản snapshot (donut 4 loại + kỳ báo cáo) ── */}
            <div className="chart-container">
              <div className="chart-header">
                <h3>Tổng tài sản</h3>
              </div>
              <div className="dca-param-row">
                <label className="dca-label">Kỳ báo cáo</label>
                <div className="overlap-select">{selectPeriod(piePeriod, setPiePeriod)}</div>
              </div>
              {piePeriodSummary && pieData.length > 0 ? (
                <>
                  <div className="fund-analysis-summary">
                    <div className="fund-analysis-total-left">
                      <div className="fund-analysis-total-caption">Tổng tài sản</div>
                      <div className="fund-analysis-total-value">{formatVNDLocale(pieTotal)}</div>
                      {headerDelta && (
                        <div className={`fund-analysis-delta ${headerDelta.positive ? 'pos' : 'neg'}`}>
                          So với kỳ {headerDelta.label}: {headerDelta.absLabel} ({headerDelta.pctLabel})
                        </div>
                      )}
                    </div>
                    {donutGradient && (
                      <div className="fund-analysis-donut-wrap">
                        <div className="fund-analysis-donut" style={{ background: donutGradient }}>
                          <div className="fund-analysis-donut-hole" />
                        </div>
                      </div>
                    )}
                    <div className="fund-analysis-alloc-cards">
                      {pieData.map(d => {
                        const delta = categoryDelta(d.field, d.value)
                        return (
                          <div key={d.name} className="fund-analysis-alloc-card">
                            <div className="fund-analysis-alloc-head">
                              <span className="fund-analysis-alloc-dot" style={{ backgroundColor: d.color }} />
                              <span className="fund-analysis-alloc-name">{d.name}</span>
                            </div>
                            <div className="fund-analysis-alloc-value">{formatVNDLocale(d.value)}</div>
                            <div className="fund-analysis-alloc-meta">
                              <span className="fund-analysis-alloc-pct">
                                {pieTotal > 0 ? ((d.value / pieTotal) * 100).toFixed(1) : 0}%
                              </span>
                              {delta && delta.show && (
                                <span className={`fund-analysis-alloc-delta ${delta.positive ? 'pos' : 'neg'}`}>
                                  {delta.positive ? '↑' : '↓'} {delta.label}
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  {pieAssets && pieAssets.nav > 0 && (
                    <p className="fund-analysis-nav">
                      NAV: <strong>{formatVND(pieAssets.nav)}</strong>
                      {pieAssets.navPerUnit > 0 && <> · NAV/CCQ: <strong>{Math.round(pieAssets.navPerUnit).toLocaleString('vi-VN')} đ</strong></>}
                      {' '}(kỳ {formatPeriodLabel(pieResolved!)})
                    </p>
                  )}
                </>
              ) : (
                <p className="overlap-empty">Không có dữ liệu danh mục kỳ này.</p>
              )}
            </div>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>Phân bổ theo ngành nghề</h3>
                </div>
                {industryPie.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={industryPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2} isAnimationActive={false}>
                          {industryPie.map(d => (
                            <Cell key={d.name} fill={d.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          formatter={(value: number | string, name: string) => [`${Number(value).toFixed(1)}%`, name]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="fund-analysis-stack-legend">
                      {industryPie.map(d => (
                        <span key={d.name} className="fund-analysis-stack-legend-item">
                          <span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: d.color }} />
                          {d.name}
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="overlap-empty">Kỳ này không có dữ liệu ngành.</p>
                )}
                <p className="fund-analysis-chart-note">
                  Tỷ trọng cổ phiếu theo ngành, kỳ {pieResolved ? formatPeriodLabel(pieResolved) : 'đang chọn'}.
                  Nếu một hai ngành chiếm quá nửa, danh mục dễ bị kéo theo ngành đó.
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Top 10 cổ phiếu nắm giữ lớn nhất</h3>
                </div>
                {top10Stocks.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={top10Stocks} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="ticker" width={72} interval={0} tick={{ fontSize: 11 }} tickFormatter={(t: string) => (t.length > 12 ? `${t.slice(0, 11)}…` : t)} />
                      <RechartsTooltip
                        formatter={(value: number | string) => [`${Number(value).toFixed(2)}%`, 'Tỷ trọng']}
                        labelFormatter={(t: string) => `${t}${industryMap[t] ? ` · ${industryMap[t]}` : ''}`}
                      />
                      <Bar dataKey="weightPct" fill={ASSET_COLORS.stock} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="overlap-empty">Kỳ này không có cổ phiếu.</p>
                )}
                <p className="fund-analysis-chart-note">
                  Tỷ trọng trong NAV, kỳ {pieResolved ? formatPeriodLabel(pieResolved) : 'đang chọn'}.
                  Vài mã đứng đầu quyết định phần lớn hiệu suất cả danh mục.
                </p>
              </div>
            </div>

            <div className="chart-container">
              <div className="chart-header">
                <h3>Mức độ tập trung danh mục (top 5)</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={top5Concentration} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => `${Math.round(v)}%`} tick={{ fontSize: 11 }} width={48} domain={[0, 100]} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [`${Number(value).toFixed(1)}%`, 'Top 5']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Line type="monotone" dataKey="value" stroke={INVESTOR_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Tổng tỷ trọng 5 cổ phiếu lớn nhất mỗi kỳ. Đường dốc lên liên tục nghĩa là quỹ đang
                  mất dần tính đa dạng hóa.
                </p>
              </div>

            {/* ── Danh mục quỹ (bảng, kèm kỳ báo cáo riêng) ── */}
            <div className="chart-container">
              <div className="chart-header">
                <h3>Danh mục quỹ</h3>
              </div>
              <div className="dca-param-row">
                <label className="dca-label">Kỳ báo cáo</label>
                <div className="overlap-select">{selectPeriod(tablePeriod, setTablePeriod)}</div>
              </div>
              {tableStocks.length > 0 ? (
                <div className="dca-stats-table-scroll fund-analysis-table-scroll">
                  <table className="dca-stats-table overlap-table">
                    <thead>
                      <tr>
                        <th>Chứng khoán</th>
                        <th>Khối lượng nắm giữ</th>
                        <th>Tổng giá trị</th>
                        <th>Tỷ trọng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableStocks.map(s => (
                        <tr key={s.ticker}>
                          <td>
                            <span className="fund-analysis-symbol">{s.ticker}</span>
                            {industryMap[s.ticker] && (
                              <span className="fund-analysis-industry">{industryMap[s.ticker]}</span>
                            )}
                          </td>
                          <td>{s.quantity > 0 ? s.quantity.toLocaleString('vi-VN') : '—'}</td>
                          <td>{formatVND(s.value)}</td>
                          <td>{s.weightPct.toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="overlap-empty">Kỳ này không có cổ phiếu trong danh mục.</p>
              )}
            </div>
          </div>

          {/* ════════════ Nhóm 1: Hiệu suất & Rủi ro ════════════ */}
          <div style={{ display: showSection('perf') }}>
            <div className="section-divider">
              <span className="section-divider-label">Hiệu suất & Rủi ro</span>
            </div>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>NAV/CCQ (giá quỹ) qua các tháng</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={navCcqSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <defs>
                      <linearGradient id="navCcqFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={NAV_CCQ_COLOR} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={NAV_CCQ_COLOR} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tick={{ fontSize: 11 }} width={76} domain={['auto', 'auto']} tickFormatter={(v: number) => `${Math.round(v).toLocaleString('vi-VN')}`} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [`${Number(value).toLocaleString('vi-VN')} đ`, 'NAV/CCQ']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Area type="monotone" dataKey="value" stroke={NAV_CCQ_COLOR} strokeWidth={2} fill="url(#navCcqFill)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Giá trị tài sản ròng trên mỗi chứng chỉ quỹ cuối kỳ (báo cáo 2219) — giá bạn mua/bán.
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Mức sụt giảm từ đỉnh (drawdown)</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={drawdownSeriesData} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => `${Math.round(v)}%`} tick={{ fontSize: 11 }} width={54} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [`${Number(value).toFixed(1)}%`, 'Sụt giảm']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Area type="monotone" dataKey="value" stroke={DRAWDOWN_COLOR} strokeWidth={2} fill="rgba(220,38,38,0.25)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Khoảng cách từ đỉnh cao nhất trước đó, tính trên NAV/CCQ. Đáy sâu nhất lịch sử:
                  {maxDD < 0 ? ` −${(Math.abs(maxDD) * 100).toFixed(0)}%` : ' chưa đủ số liệu'}.
                  Cú sập càng sâu, càng cần nhiều thời gian hồi phục.
                </p>
              </div>
            </div>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>Lợi nhuận quỹ theo tháng</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={profitSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [formatVND(Number(value)), 'Lợi nhuận quỹ']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="value" isAnimationActive={false}>
                      {profitSeries.map(d => (
                        <Cell key={d.period} fill={d.value >= 0 ? PROFIT_POS : PROFIT_NEG} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Lợi nhuận của quỹ = thay đổi NAV do hoạt động đầu tư (2237) = thu nhập ròng +
                  lãi/lỗ khi bán + lãi/lỗ theo giá thị trường (gồm cả phần cổ phiếu tăng/giảm chưa bán).
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Lợi nhuận theo tháng (% NAV/CCQ)</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={navCcqReturnSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => `${v.toFixed(1)}%`} tick={{ fontSize: 11 }} width={54} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [`${Number(value).toFixed(2)}%`, 'Thay đổi NAV/CCQ']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="value" isAnimationActive={false}>
                      {navCcqReturnSeries.map(d => (
                        <Cell key={d.period} fill={d.value >= 0 ? PROFIT_POS : PROFIT_NEG} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Tỷ suất sinh lời mỗi tháng trên MỖI chứng chỉ (thay đổi % NAV/CCQ). Tính trên-đơn-vị
                  nên đã tự loại ảnh hưởng dòng tiền. Xanh = lời, đỏ = lỗ.
                </p>
              </div>
            </div>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>Lãi/lỗ thực hiện (khi bán)</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={gainSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [formatVND(Number(value)), 'Lãi/lỗ thực hiện']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="Thực hiện" isAnimationActive={false}>
                      {gainSeries.map(d => (
                        <Cell key={d.period} fill={d['Thực hiện'] >= 0 ? PROFIT_POS : PROFIT_NEG} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Lãi/lỗ khi quỹ BÁN cổ phiếu trong tháng (2235). Xanh = lời, đỏ = lỗ. Chỉ là phần đã
                  chốt bằng cách bán, chưa tính phần còn đang giữ.
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Lãi/lỗ chưa thực hiện (theo giá thị trường)</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={gainSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [formatVND(Number(value)), 'Lãi/lỗ chưa thực hiện']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="Chưa thực hiện" isAnimationActive={false}>
                      {gainSeries.map(d => (
                        <Cell key={d.period} fill={d['Chưa thực hiện'] >= 0 ? PROFIT_POS : PROFIT_NEG} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Lãi/lỗ do cổ phiếu lên/xuống giá khi quỹ VẪN ĐANG GIỮ (2236, chưa bán). Phần này làm
                  giá quỹ (NAV/CCQ) biến động mạnh nhất. Xanh = lời, đỏ = lỗ.
                </p>
              </div>
            </div>
          </div>

          {/* ════════════ Nhóm 2: Quy mô & Dòng tiền ════════════ */}
          <div style={{ display: showSection('size') }}>
            <div className="section-divider">
              <span className="section-divider-label">Quy mô & Dòng tiền</span>
            </div>

            <div className="fund-analysis-insight">
              Hiệu quả THẬT của quỹ (NAV/CCQ) chỉ ~1,18x kể từ đỉnh 2022. Tổng tài sản tăng 3,5x chủ
              yếu do dòng tiền mới (số chứng chỉ ×3), không phải do đầu tư. Tổng tài sản của quỹ mở
              bằng giá nhân số lượng, nên nó tăng khi nhà đầu tư nạp tiền mới. Xem chart "Thay đổi tổng
              NAV" để biết mỗi tháng tăng trưởng đến từ đầu tư hay từ dòng tiền. Dòng tiền âm liên tục
              là tín hiệu nhà đầu tư mất niềm tin; tiền mặt cao thì quỹ đang phòng thủ.
            </div>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>Quy mô quỹ (AUM) qua các tháng</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={aumSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <defs>
                      <linearGradient id="aumFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={SERIES_COLOR} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={SERIES_COLOR} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [formatVND(Number(value)), 'AUM (tài sản ròng)']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Area type="monotone" dataKey="value" stroke={SERIES_COLOR} strokeWidth={2} fill="url(#aumFill)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Quy mô quỹ tính theo tài sản ròng (NAV cuối kỳ, mục 2243), đã trừ nợ phải trả.
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Số chứng chỉ quỹ đang lưu hành</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={unitsSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => `${Math.round(v / 1e6)}tr`} tick={{ fontSize: 11 }} width={54} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [`${Number(value).toLocaleString('vi-VN')} chứng chỉ`, 'Lưu hành']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Line type="monotone" dataKey="value" stroke={UNITS_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>Thay đổi NAV do phát hành CCQ (2239.3.1)</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={subRedSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [formatVND(Number(value)), 'Phát hành']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="Phát hành" fill={PROFIT_POS} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Thay đổi giá trị tài sản ròng do phát hành thêm chứng chỉ quỹ (2239.3.1). Báo cáo
                  chỉ tách riêng mục này từ 12/2020, các tháng trước để trống.
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Thay đổi NAV do mua lại CCQ (2239.3.2)</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={subRedSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [formatVND(Number(value)), 'Mua lại']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="Mua lại" fill={PROFIT_NEG} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Thay đổi giá trị tài sản ròng do quỹ mua lại chứng chỉ (2239.3.2), số âm là tiền
                  rút ra. Phát hành trừ mua lại ra dòng tiền ròng của tháng.
                </p>
              </div>
            </div>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>Dòng tiền ròng (phát hành − mua lại CCQ)</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={flowSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [formatVND(Number(value)), 'Dòng tiền ròng']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="value" isAnimationActive={false}>
                      {flowSeries.map(d => (
                        <Cell key={d.period} fill={d.value >= 0 ? FLOW_POS : FLOW_NEG} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Xanh = nhà đầu tư nạp thêm tiền, đỏ = rút vốn ra. Con số chính xác từ báo cáo
                  (2239.3), bằng hiệu của hai chart phát hành và mua lại bên trên.
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Thay đổi tổng NAV: đầu tư vs dòng tiền</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={navChangeSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string, name: string) => [formatVND(Number(value)), name]}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="Đầu tư" fill={INVEST_COLOR} isAnimationActive={false} />
                    <Bar dataKey="Dòng tiền" fill={FLOW_NAV_COLOR} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="fund-analysis-stack-legend">
                  <span className="fund-analysis-stack-legend-item"><span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: INVEST_COLOR }} />Đầu tư (2237)</span>
                  <span className="fund-analysis-stack-legend-item"><span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: FLOW_NAV_COLOR }} />Dòng tiền (2239.3)</span>
                </div>
                <p className="fund-analysis-chart-note">
                  Mỗi tháng, tổng NAV được tính bằng:<br />
                  1. Lợi nhuận đầu tư (2237): quỹ làm ra bao nhiêu tiền.<br />
                  2. Dòng tiền (2239.3): nhà đầu tư nạp thêm hay rút ra.<br />
                  <br />
                  Chart này tách 2 thứ ra, để thấy quỹ lớn nhờ đâu. Lớn nhờ lợi nhuận là thật. Lớn nhờ
                  tiền mới chưa nói lên chất lượng.<br />
                  <br />
                  DCDS từ cuối 2018: lợi nhuận đầu tư cộng dồn 713 tỷ, dòng tiền 4.722 tỷ. Tức 87% tăng
                  trưởng đến từ tiền mới, chỉ 13% từ quỹ làm ra. Tổng NAV gấp 5,3 lần nhưng quỹ thật sự
                  sinh lời chưa tới 1 lần.<br />
                  <br />
                  Năm nay lại ngược, cũng đáng chú ý: 7 tháng đầu 2026 hút 895 tỷ tiền mới, nhưng lợi
                  nhuận đầu tư âm 652 tỷ. Tiền mới vào nhiều vẫn không cứu được lỗ.<br />
                  <br />
                  Quỹ phình to không có nghĩa là quỹ làm ra tiền. Muốn biết quỹ có giỏi không, phải
                  nhìn NAV/CCQ, tức lợi nhuận trên từng chứng chỉ.
                </p>
              </div>
            </div>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>Tiền mặt / cổ phiếu (% tổng tài sản) qua các tháng</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={allocationSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => `${Math.round(v)}%`} tick={{ fontSize: 11 }} width={44} domain={[0, 100]} />
                    <RechartsTooltip
                      formatter={(value: number | string, name: string) => [`${Number(value).toFixed(1)}%`, name]}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    {ALLOC_KEYS.map((k, i) => (
                      <Area
                        key={k}
                        dataKey={k}
                        stackId="a"
                        stroke={ALLOC_FIELDS[i] === 'stockValue' ? ASSET_COLORS.stock : ALLOC_FIELDS[i] === 'bondValue' ? ASSET_COLORS.bond : ALLOC_FIELDS[i] === 'cashValue' ? ASSET_COLORS.cash : ASSET_COLORS.other}
                        fill={ALLOC_FIELDS[i] === 'stockValue' ? ASSET_COLORS.stock : ALLOC_FIELDS[i] === 'bondValue' ? ASSET_COLORS.bond : ALLOC_FIELDS[i] === 'cashValue' ? ASSET_COLORS.cash : ASSET_COLORS.other}
                        fillOpacity={0.7}
                        isAnimationActive={false}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
                <div className="fund-analysis-stack-legend">
                  {ALLOC_KEYS.map((k, i) => (
                    <span key={k} className="fund-analysis-stack-legend-item">
                      <span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: ALLOC_FIELDS[i] === 'stockValue' ? ASSET_COLORS.stock : ALLOC_FIELDS[i] === 'bondValue' ? ASSET_COLORS.bond : ALLOC_FIELDS[i] === 'cashValue' ? ASSET_COLORS.cash : ASSET_COLORS.other }} />
                      {k}
                    </span>
                  ))}
                </div>
                <p className="fund-analysis-chart-note">
                  Tỷ trọng từng loại tài sản trong tổng tài sản (cộng lại đúng 100%). Tiền mặt cao trong
                  downtrend là phòng thủ tốt, nhưng cao trong uptrend là bỏ lỡ cơ hội.
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Tiền mặt qua các tháng</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={cashSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [formatVND(Number(value)), 'Tiền mặt']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="value" fill={CASH_SERIES_COLOR} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Tiền mặt và tương đương tiền quỹ nắm giữ mỗi cuối kỳ (Cash at Bank + Cash Equivalents
                  + Money market). Tăng vọt nghĩa là quỹ bán cổ phiếu và đang giữ tiền.
                </p>
              </div>
            </div>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>Tiền gửi ngân hàng (2203)</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={bankDepositSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [formatVND(Number(value)), 'Tiền gửi ngân hàng']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="value" fill={BANK_DEPOSIT_COLOR} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Tiền gửi ngân hàng (mục 2203) chiếm phần lớn trong tổng tiền mặt. Phần chênh
                  với chart "Tiền mặt qua các tháng" là tương đương tiền và công cụ thị trường tiền tệ.
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Tỷ lệ tiền mặt theo % AUM</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={cashAumSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis domain={[0, 'auto']} tickFormatter={(v: number) => `${Math.round(v)}%`} tick={{ fontSize: 11 }} width={48} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [`${Number(value).toFixed(1)}%`, 'Tiền mặt % AUM']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="value" fill={BANK_DEPOSIT_COLOR} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Tỷ lệ tiền mặt trên quy mô tài sản ròng (AUM). Cao nghĩa là quỹ giữ nhiều tiền mặt,
                  phòng thủ hoặc chờ đợi cơ hội mua vào.
                </p>
              </div>
            </div>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>Số nhà đầu tư</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={investorSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} width={50} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [`${Number(value).toLocaleString('vi-VN')} nhà đầu tư`, 'Số nhà đầu tư']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="value" fill={INVESTOR_COLOR} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Số nhà đầu tư cuối kỳ (22841). Tăng nhanh cùng số chứng chỉ lưu hành nghĩa là quỹ
                  hút dòng tiền bán lẻ mạnh (07/2026: 74.212 nhà đầu tư).
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Công ty quản lý & bên liên quan sở hữu (2282)</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={relatedPartySeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis domain={[0, 'auto']} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11 }} width={44} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [`${(Number(value) * 100).toFixed(2)}%`, 'Công ty quản lý + bên liên quan']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Line type="monotone" dataKey="value" stroke={OWNERSHIP_FMC_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Tỷ lệ chứng chỉ do công ty quản lý quỹ và bên liên quan nắm giữ (2282). Con số nhảy
                  theo thời điểm, không phải thước đo niềm tin: họ kiếm tiền bằng phí quản lý, không
                  cần nắm nhiều chứng chỉ.
                </p>
              </div>
            </div>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>Top 10 nhà đầu tư lớn nhất (2283)</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={top10Series} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis domain={[0, 'auto']} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11 }} width={44} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [`${(Number(value) * 100).toFixed(2)}%`, 'Top 10 nhà đầu tư']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Line type="monotone" dataKey="value" stroke={TOP10_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  10 nhà đầu tư lớn nhất nắm bao nhiêu phần trăm quỹ (2283). Tập trung cao nghĩa là
                  vài tổ chức lớn chi phối; họ rút vốn sẽ ảnh hưởng mạnh tới quỹ.
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Nhà đầu tư nước ngoài (2284)</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={foreignSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis domain={[0, 'auto']} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11 }} width={44} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [`${(Number(value) * 100).toFixed(2)}%`, 'Nhà đầu tư nước ngoài']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Line type="monotone" dataKey="value" stroke={FOREIGN_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Tỷ lệ chứng chỉ do nhà đầu tư nước ngoài nắm (2284). Giảm thường đi cùng thị trường
                  điều chỉnh, khi vốn ngoại rút khỏi cổ phiếu Việt Nam.
                </p>
              </div>
            </div>
          </div>

          {/* ════════════ Nhóm 4: Chi phí & Hiệu quả ════════════ */}
          <div style={{ display: showSection('cost') }}>
            <div className="section-divider">
              <span className="section-divider-label">Chi phí & Hiệu quả</span>
            </div>

            <p className="fund-analysis-narrative">
              Phí là thứ duy nhất chắc chắn mất. Phí quản lý khoảng 1,95%/năm, tổng chi phí 2,1%/năm,
              lấy đi đều đặn bất kể thị trường ra sao. Turnover cao nghĩa là quỹ giao dịch nhiều, sinh
              phí cho công ty chứng khoán, chưa chắc sinh lời cho nhà đầu tư. Cổ tức nhận về theo mùa,
              thường dồn vào quý 2 và quý 3.
            </p>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>Thu nhập: cổ tức + lãi tiền gửi</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={incomeSrcSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string, name: string) => [formatVND(Number(value)), name]}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="Cổ tức" stackId="a" fill={DIVIDEND_COLOR} isAnimationActive={false} />
                    <Bar dataKey="Lãi tiền gửi" stackId="a" fill={INTEREST_COLOR} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="fund-analysis-stack-legend">
                  <span className="fund-analysis-stack-legend-item"><span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: DIVIDEND_COLOR }} />Cổ tức (2221.1)</span>
                  <span className="fund-analysis-stack-legend-item"><span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: INTEREST_COLOR }} />Lãi tiền gửi (2222)</span>
                </div>
                <p className="fund-analysis-chart-note">
                  Tiền mặt quỹ thu vào: cổ tức (2221.1) + lãi tiền gửi (2222). Đây là thu nhập lãi từ
                  tiền gửi, KHÔNG phải lợi nhuận quỹ. Cổ tức lớn hơn hẳn lãi tiền gửi vì quỹ là quỹ
                  cổ phiếu.
                </p>
                <p className="fund-analysis-chart-note fund-analysis-note-em">
                  Cổ tức dồn về theo mùa (Q2-Q3, sau ĐHĐCĐ). Đợt cao 05-07/2026 chủ yếu do cổ phiếu lớn
                  chi trả: VIC ~11.000đ/CP (tháng 5, ~31 tỷ), BID ~2.000đ/CP (tháng 6, ~25 tỷ), ACB
                  ~1.800đ/CP (tháng 7, ~17 tỷ). Suy luận từ tổng cổ tức chia số CP nắm giữ, không phải
                  lỗi số liệu.
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Chi phí: phí quản lý + giao dịch</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={costSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string, name: string) => [formatVND(Number(value)), name]}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="Phí quản lý" stackId="a" fill={MGMT_FEE_COLOR} isAnimationActive={false} />
                    <Bar dataKey="Phí giao dịch" stackId="a" fill={BROKERAGE_COLOR} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="fund-analysis-stack-legend">
                  <span className="fund-analysis-stack-legend-item"><span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: MGMT_FEE_COLOR }} />Phí quản lý (2225)</span>
                  <span className="fund-analysis-stack-legend-item"><span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: BROKERAGE_COLOR }} />Phí giao dịch (2231)</span>
                </div>
                <p className="fund-analysis-chart-note">
                  Chi phí là thứ duy nhất chắc chắn mất. Hai loại phí lớn:<br />
                  1. Phí quản lý (2225): khoảng 1,95%/năm, trừ đều vào NAV mỗi ngày. Không tránh được,
                  dù quỹ lời hay lỗ.<br />
                  2. Phí giao dịch (2231): mỗi lần quỹ mua bán cổ phiếu là một lần trả tiền môi giới.
                  Tỉ lệ thuận với turnover.<br />
                  <br />
                  Nhìn 2 cột cạnh nhau để so: phí giao dịch tiến gần phí quản lý nghĩa là quỹ đang chạy
                  quá nhiều vòng. Quỹ chạy nhiều, môi giới vui, bạn chưa chắc vui.<br />
                  <br />
                  DCDS 07/2026: phí giao dịch 6,06 tỷ, đã bằng 63% phí quản lý 9,66 tỷ. Hai năm 2022 và
                  2026 quỹ lỗ nặng mà phí vẫn trừ đều. Đó là bản chất của phí: nó không cần biết thị
                  trường ra sao.
                </p>
              </div>
            </div>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>Chi phí / NAV (%)</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={feeRatioSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => `${(v * 100).toFixed(2)}%`} tick={{ fontSize: 11 }} width={56} domain={[0, 'auto']} />
                    <RechartsTooltip
                      formatter={(value: number | string, name: string) => [`${(Number(value) * 100).toFixed(2)}%`, name]}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Line type="monotone" dataKey="Phí quản lý" stroke={MGMT_FEE_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="Tổng chi phí" stroke={TOTAL_COST_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="fund-analysis-stack-legend">
                  <span className="fund-analysis-stack-legend-item"><span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: MGMT_FEE_COLOR }} />Phí quản lý/NAV (2265)</span>
                  <span className="fund-analysis-stack-legend-item"><span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: TOTAL_COST_COLOR }} />Tổng chi phí/NAV (2269)</span>
                </div>
                <p className="fund-analysis-chart-note">
                  Chi phí so với NAV bình quân, tính theo năm: phí quản lý ~1,95%, tổng chi phí ~2,1%.
                  Đây là phần ăn mòn hàng năm của quỹ. 2022 nhích lên vì NAV giảm mạnh, không phải vì
                  phí tăng.
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Portfolio turnover rate</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={turnoverSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => `${v.toFixed(1)}%`} tick={{ fontSize: 11 }} width={54} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [`${Number(value).toFixed(2)}%`, 'Turnover']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="value" fill={TURNOVER_COLOR} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Portfolio turnover rate — tỷ lệ danh mục được mua-bán trong kỳ (2270). 07/2026 đạt
                  683,99%, tức quỹ giao dịch gần 7 lần giá trị danh mục trong 12 tháng gần nhất. Cao
                  nghĩa là quản lý chủ động xoay vòng; xem chart "Lãi/lỗ thực hiện" để thấy đợt bán
                  lớn tương ứng.
                </p>
              </div>
            </div>
          </div>

          {/* ════════════ Nhóm 5: Red Flags ════════════ */}
          <div style={{ display: showSection('redflags') }}>
            <div className="section-divider">
              <span className="section-divider-label">Dấu vết nghi vấn (Red Flags)</span>
            </div>

            <p className="fund-analysis-narrative">
              Những con số này ít ai đọc, nhưng chúng nói về rủi ro thật. Quỹ mở về nguyên tắc không
              dùng đòn bẩy; nếu nợ phải trả tăng vọt, cần hỏi vì sao. Tiền thu từ bán chứng khoán chưa
              về nhiều nghĩa là dòng tiền đang kẹt ở khâu thanh toán. So AUM với dòng tiền: AUM tăng mà
              dòng tiền âm kéo dài là dấu hiệu đáng ngờ, có thể giá trị tài sản đang được định giá lại
              chứ không phải tiền thật vào.
            </p>

            <div className="fund-analysis-charts-grid">
              <div className="chart-container">
                <div className="chart-header">
                  <h3>Nợ phải trả</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={liabilitySeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [formatVND(Number(value)), 'Nợ phải trả']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Line type="monotone" dataKey="value" stroke={LIAB_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Quỹ mở Việt Nam theo nguyên tắc không đòn bẩy. Quỹ không vay nợ để đầu tư. Khoản "nợ
                  phải trả" này là nợ hoạt động:<br />
                  1. Tiền phải trả nhà đầu tư mua lại chứng chỉ.<br />
                  2. Phí quản lý, phí lưu ký chưa thanh toán.<br />
                  3. Chi phí khác còn treo.<br />
                  <br />
                  Số này nhỏ là sạch. Nó phình lên vào tháng có đợt rút vốn lớn, rồi tự xẹp khi quỹ trả
                  tiền xong. Chỉ lo khi nó tăng vọt bất thường mà không rõ lý do.<br />
                  <br />
                  DCDS 07/2026 có 248 tỷ nợ, khoảng 4% tài sản. Thực ra con số này đang giảm: từ 517 tỷ
                  hồi tháng 3 xuống 248 tỷ. Nghĩa là các đợt mua lại lớn đã được thanh toán dần. Không
                  có gì bất thường.
                </p>
              </div>

              <div className="chart-container">
                <div className="chart-header">
                  <h3>Phải thu từ bán chứng khoán chưa về</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={settlementSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                    <YAxis tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                    <RechartsTooltip
                      formatter={(value: number | string) => [formatVND(Number(value)), 'Phải thu bán CK']}
                      labelFormatter={(p: string) => formatPeriodLabel(p)}
                    />
                    <Bar dataKey="value" fill={SETTLE_COLOR} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="fund-analysis-chart-note">
                  Bán cổ phiếu xong, tiền không về ngay. Phải chờ thanh toán vài ngày. Khoản đang chờ
                  đó nằm ở đây (2208).<br />
                  <br />
                  Số này nhỏ là bình thường. Cao nghĩa là một trong hai chuyện:<br />
                  1. Quỹ đang bán khối lượng lớn, tiền đang trên đường về.<br />
                  2. Thanh toán bị kẹt, tiền mắc ở khâu trung gian.<br />
                  <br />
                  Rủi ro thật nằm ở chuyện thứ 2: đối tác không trả tiền. Giao dịch càng to, mất càng
                  đau.<br />
                  <br />
                  DCDS tháng 7/2026 có 334 tỷ đang chờ về, cả năm dao động 178 tới 365 tỷ. Con số cao,
                  nhưng lý do chính là quỹ bán mạnh trong thị trường giảm (lãi thực hiện âm 267 tỷ cùng
                  tháng). Tiền về trễ không phải là thảm họa, chỉ là tín hiệu quỹ đang bán nhiều. Kết
                  hợp với chart Lãi/lỗ thực hiện mới ra câu chuyện đầy đủ.
                </p>
              </div>
            </div>

            <div className="chart-container">
              <div className="chart-header">
                <h3>Độ lệch pha AUM và dòng tiền</h3>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={aumFlowSeries} margin={{ left: 8, right: 8, top: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" tickFormatter={formatAxisTick} tick={{ fontSize: 10 }} minTickGap={32} />
                  <YAxis yAxisId="aum" tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                  <YAxis yAxisId="flow" orientation="right" tickFormatter={(v: number) => formatVNDAxis(v)} tick={{ fontSize: 11 }} width={76} />
                  <RechartsTooltip
                    formatter={(value: number | string, name: string) => [formatVND(Number(value)), name]}
                    labelFormatter={(p: string) => formatPeriodLabel(p)}
                  />
                  <Line yAxisId="aum" type="monotone" dataKey="AUM" stroke={AUM_AXIS_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line yAxisId="flow" type="monotone" dataKey="Dòng tiền" stroke={FLOW_AXIS_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="fund-analysis-stack-legend">
                <span className="fund-analysis-stack-legend-item"><span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: AUM_AXIS_COLOR }} />AUM (trái)</span>
                <span className="fund-analysis-stack-legend-item"><span className="fund-analysis-stack-legend-dot" style={{ backgroundColor: FLOW_AXIS_COLOR }} />Dòng tiền (phải)</span>
              </div>
              <p className="fund-analysis-chart-note">
                Mỗi tháng, AUM được tính bằng:<br />
                1. Tiền mới nhà đầu tư nạp vào hay rút ra (đường dòng tiền).<br />
                2. Lợi nhuận đầu tư, tức giá tài sản lên hay xuống.<br />
                <br />
                Hai đường chạy ngược nhau là có chuyện:<br />
                1. AUM lên mà dòng tiền âm: tăng nhờ GIÁ tài sản, vốn đang chảy ra.<br />
                2. AUM xuống mà dòng tiền dương: hút được vốn nhưng giá giảm mạnh hơn.<br />
                3. Cả 2 cùng lên: khỏe. Cùng xuống: xấu.<br />
                <br />
                DCDS năm nay đang ở mục 2:<br />
                1. Hút gần 838 tỷ tiền mới trong 7 tháng, chỉ một tháng rút nhẹ.<br />
                2. Tổng tài sản vẫn tụt: 6.311 tỷ (tháng 2) → 5.723 tỷ (tháng 7).<br />
                3. Vì lợi nhuận đầu tư âm 652 tỷ, thị trường giảm 17% so với đỉnh.<br />
                4. Người mua ở đỉnh, một chứng chỉ giá 112 nghìn, giờ còn 93 nghìn.<br />
                <br />
                Tiền vào nhiều không cứu được sự sụt giảm của tài sản. Hút vốn là chuyện của phân phối,
                làm ra tiền mới là chuyện của đầu tư. Chart này chỉ tách hai chuyện đó ra, để bạn không
                nhầm.
              </p>
            </div>

            <RedFlagDetectors points={redFlagPoints} />
          </div>
        </>
      )}
    </div>
  )
}

export const FundAnalysisPanel = memo(FundAnalysisPanelImpl)
