/** Price data point (date, price) — used for both raw daily CSV rows and any resampled/aligned series */
export interface PricePoint {
  date: string // YYYY-MM-DD
  price: number
}

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

/** URL state for the dashboard */
export interface DashboardState {
  funds: string[] // selected fund IDs for comparison
  tab: 'compare' | 'dca' | 'lsdca' | 'rebalance' | 'tactical' | 'bitcoin' | 'wallofworry' | 'methodology' | 'changelog'
  rollingPeriod: number // months: 6, 12, 24, 36, 48
  dateFrom: string | null
  dateTo: string | null
}
