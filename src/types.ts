import type { CALCULATOR_IDS } from './constants'
import type { TabId } from './tabRegistry'

/** Price data point (date, price) — used for both raw daily CSV rows and any resampled/aligned series */
export interface PricePoint {
  date: string // YYYY-MM-DD
  price: number
}

/** Versioned price-series point at the data-ingress boundary. */
export interface PriceSeriesPoint {
  date: string // YYYY-MM-DD
  value: number
}

/** A transformation already applied to PriceSeries.points. */
export interface PriceSeriesAdjustment {
  kind: 'dividend'
  exDate: string
  payDate: string
  amountPerCert: number
  taxRate: number
}

/**
 * Versioned data contract for every price source entering the dashboard.
 * points are calculation-ready; rawPoints preserves pre-adjustment NAV when needed.
 */
export interface PriceSeriesV1 {
  version: 1
  assetId: string
  currency: string
  points: PriceSeriesPoint[]
  rawPoints?: PriceSeriesPoint[]
  purchasePoints?: PriceSeriesPoint[]
  adjustments: PriceSeriesAdjustment[]
  source: string
  asOf: string
}

export type PriceSeries = PriceSeriesV1

/** Return data point */
export interface ReturnPoint {
  date: string
  value: number // decimal, e.g., 0.05 = 5%
}

/** Fund metadata from fund_metadata.json */
export interface FundMeta {
  id: string
  name_vi: string
  type: 'mutual_fund' | 'bond' | 'balanced' | 'etf' | 'crypto' | 'gold'
  start_date: string
  csv_file: string
}

/** Series data for charts: generic shape shared by all chart components */
export interface ChartSeries {
  name: string
  color: string
  data: ReturnPoint[]
}

/** KPI card data */
export interface KPIData {
  cagr: number | null
  maxDrawdown: number | null
  rollingAvg12M: number | null
  winRate: number | null // null if < 1 full year
}

/** Yearly return for a single year */
export interface YearlyReturn {
  year: number
  value: number // decimal
  isPartial: boolean // true for incomplete years
}

/** Monthly return for a single calendar month */
export interface MonthlyReturn {
  year: number
  month: number // 1..12
  value: number // decimal, growth of the whole month
  isPartial: boolean // true for incomplete months (first/last)
}

/** Rebalancing frequency options */
export type RebalanceFrequency = 'monthly' | 'quarterly' | 'yearly'

export interface PortfolioSlot {
  fundId: string
  weight: number // 0-100
}

export interface Portfolio {
  slots: PortfolioSlot[]
  rebalFreq: RebalanceFrequency
  name?: string
}

export type StoredPortfolio =
  Omit<Portfolio, 'rebalFreq'> & { rebalFreq: string }

export type PortfolioCardState = Omit<Portfolio, 'name'> & {
  id: string
  /** Số cố định gắn với danh mục lúc tạo, dùng làm fallback tên. */
  num: number
  name: string
  /** true khi người dùng tự đặt tên, không tự đổi theo quỹ. */
  isNameCustom: boolean
}

/**
 * Máy tính trong tab "Máy tính".
 * Suy ra từ CALCULATOR_IDS nên chỉ cần sửa danh sách đó, không sửa hai chỗ.
 */
export type CalculatorId = typeof CALCULATOR_IDS[number]

/** URL state for the dashboard */
export interface DashboardState {
  funds: string[] // selected fund IDs for comparison
  /** Id của tab đang mở. Suy từ tabRegistry nên chỉ cần sửa registry, không sửa ở đây. */
  tab: TabId
  rollingPeriod: number // months: 6, 12, 24, 36, 48
  dateFrom: string | null
  dateTo: string | null
  /** Máy tính đang mở, chỉ có nghĩa khi tab === 'calculator' */
  calcId?: CalculatorId
}
