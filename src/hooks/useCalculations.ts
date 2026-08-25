import { useMemo } from 'react'
import type { PricePoint, ReturnPoint, KPIData, YearlyReturn, MonthlyReturn } from '../types'
import { alignMultiSeries, NoOverlapError } from '../utils/dateAlign'
import {
  weeklyReturns,
  cumulativeReturns,
  cagr,
  maxDrawdown,
  drawdownSeries,
  yearlyReturns,
  monthlyReturns,
  rollingReturns,
  rollingAverage,
  availableRollingPeriods,
  winRateAmong,
} from '../utils/calculations'

export interface FundComparisonData {
  id: string
  returns: ReturnPoint[]
  /** Giá gốc trên chuỗi ngày đã căn chỉnh. value là tiền, không phải %. */
  prices: ReturnPoint[]
  cumulative: ReturnPoint[]
  drawdown: ReturnPoint[]
  yearly: YearlyReturn[]
  monthly: MonthlyReturn[]
  /** Lợi nhuận tháng theo lịch sử RIÊNG của từng quỹ, không cắt theo giao.
   *  Chỉ lọc theo dateFrom/dateTo. Heatmap dùng bản này để không bị thu hẹp
   *  khi các quỹ có thời điểm ra đời khác nhau. */
  monthlyFull: MonthlyReturn[]
  rolling: ReturnPoint[]
  kpi: KPIData
}

export interface ComparisonResult {
  funds: FundComparisonData[]
  startDate: string
  endDate: string
  /** Các chu kỳ rolling (tháng) có đủ dữ liệu để tính cho ít nhất một quỹ. */
  availableRollingPeriods: number[]
}

export interface ComparisonError {
  type: 'no_overlap' | 'insufficient_data' | 'unknown'
  message: string
}

type ComparisonState =
  | { status: 'idle' }
  | { status: 'ready'; data: ComparisonResult }
  | { status: 'error'; error: ComparisonError }

const EMPTY_PURCHASE_DATA = new Map<string, PricePoint[]>()

/**
 * Compute all comparison metrics for N funds.
 * Uses alignMultiSeries for common date alignment.
 */
export function useMultiComparison(
  fundIds: string[],
  fundData: Map<string, PricePoint[]>,
  rollingPeriod: number,
  dateFrom: string | null,
  dateTo: string | null,
  purchaseData: Map<string, PricePoint[]> = EMPTY_PURCHASE_DATA,
): ComparisonState {
  // Serialize fundIds for stable dependency
  const fundIdsKey = fundIds.join(',')

  return useMemo(() => {
    if (fundIds.length === 0) return { status: 'idle' as const }

    // Check all funds loaded
    const allSeries: PricePoint[][] = []
    for (const id of fundIds) {
      const series = fundData.get(id)
      if (!series) return { status: 'idle' as const }
      allSeries.push(filterDateRange(series, dateFrom, dateTo))
    }

    try {
      const aligned = alignMultiSeries(allSeries)

      if (aligned.dates.length < 2) {
        return {
          status: 'error' as const,
          error: {
            type: 'insufficient_data' as const,
            message: 'Khoảng thời gian đã chọn chỉ có một điểm dữ liệu chung. Cần ít nhất hai điểm để tính lợi nhuận.',
          },
        }
      }

      // Gold has a bid/ask spread. An investor enters at ask (sell) and later
      // values the position at bid (buy). Keep the displayed price series intact.
      const calculationPrices = aligned.prices.map((prices, i) =>
        withEntryPurchasePrice(fundIds[i]!, aligned.dates, prices, purchaseData),
      )

      // Compute returns for each fund
      const allReturns = calculationPrices.map(prices =>
        weeklyReturns(aligned.dates, prices),
      )

      // Compute yearly for all (needed for winRate)
      const allYearly = allReturns.map(r => yearlyReturns(r))

      const startDate = aligned.dates[0]

      // Lợi nhuận tháng theo lịch sử riêng từng quỹ, dùng chuỗi GỐC chưa lọc ngày
      // và chưa align. Heatmap luôn hiển thị toàn bộ lịch sử quỹ, không bị thu
      // hẹp bởi bộ lọc thời gian (6T/1N/3N...) cũng như không bị cắt theo thời
      // điểm ra đời của quỹ mới nhất.
      const allMonthlyFull: MonthlyReturn[][] = fundIds.map(id => {
        const raw = fundData.get(id)
        if (!raw) return []
        const dates = raw.map(p => p.date)
        const prices = raw.map(p => p.price)
        const rets = weeklyReturns(dates, prices)
        return monthlyReturns(rets)
      })

      const funds: FundComparisonData[] = fundIds.map((id, i) => {
        const returns = allReturns[i]!
        const yearly = allYearly[i]!
        const rolling = rollingReturns(returns, rollingPeriod)

        return {
          id,
          returns,
          prices: aligned.dates.map((date, j) => ({ date, value: aligned.prices[i]![j]! })),
          cumulative: cumulativeReturns(returns, startDate),
          drawdown: drawdownSeries(returns, startDate),
          yearly,
          monthly: monthlyReturns(returns),
          monthlyFull: allMonthlyFull[i]!,
          rolling,
          kpi: {
            cagr: cagr(returns),
            maxDrawdown: maxDrawdown(returns),
            rollingAvg12M: rollingAverage(rollingReturns(returns, 12)),
            winRate: winRateAmong(allYearly, i),
          },
        }
      })

      return {
        status: 'ready' as const,
        data: {
          funds,
          startDate: aligned.dates[0]!,
          endDate: aligned.dates[aligned.dates.length - 1]!,
          availableRollingPeriods: availableRollingPeriods(allReturns, [6, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120]),
        },
      }
    } catch (err) {
      if (err instanceof NoOverlapError) {
        return {
          status: 'error' as const,
          error: {
            type: 'no_overlap' as const,
            message: 'Không có dữ liệu chung giữa các quỹ trong khoảng thời gian đã chọn',
          },
        }
      }
      return {
        status: 'error' as const,
        error: {
          type: 'unknown' as const,
          message: err instanceof Error ? err.message : 'Lỗi không xác định',
        },
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundIdsKey, fundData, rollingPeriod, dateFrom, dateTo, purchaseData])
}

function withEntryPurchasePrice(
  fundId: string,
  dates: string[],
  prices: number[],
  purchaseData: Map<string, PricePoint[]>,
): number[] {
  const purchaseAtStart = new Map(purchaseData.get(fundId)?.map(point => [point.date, point.price]))
    .get(dates[0]!)
  if (purchaseAtStart === undefined) return prices

  return prices.map((price, index) => index === 0 ? purchaseAtStart : price)
}

function filterDateRange(
  series: PricePoint[],
  from: string | null,
  to: string | null,
): PricePoint[] {
  return series.filter(p => {
    if (from && p.date < from) return false
    if (to && p.date > to) return false
    return true
  })
}
