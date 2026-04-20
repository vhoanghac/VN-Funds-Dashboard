/** Raw price data point from CSV */
export interface PricePoint {
  date: string // YYYY-MM-DD
  price: number
}

/** Weekly resampled price point */
export interface WeeklyPrice {
  date: string // YYYY-MM-DD (Friday or last trading day of week)
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
  type: 'mutual_fund' | 'bond' | 'balanced' | 'etf' | 'crypto'
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

/** Rebalancing frequency options */
export type RebalanceFrequency = 'monthly' | 'quarterly' | 'yearly'

/** URL state for the dashboard */
export interface DashboardState {
  funds: string[] // selected fund IDs for comparison
  tab: 'compare' | 'simulate' | 'dca' | 'lsdca' | 'bitcoin' | 'changelog'
  rollingPeriod: number // months: 6, 12, 24, 36, 48
  dateFrom: string | null
  dateTo: string | null
}
