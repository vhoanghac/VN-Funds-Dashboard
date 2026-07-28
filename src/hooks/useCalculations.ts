import { useMemo } from 'react'
import type { PricePoint, ReturnPoint, KPIData, YearlyReturn } from '../types'
import { alignMultiSeries, NoOverlapError } from '../utils/dateAlign'
import {
  weeklyReturns,
  cumulativeReturns,
  cagr,
  maxDrawdown,
  drawdownSeries,
  yearlyReturns,
  rollingReturns,
  rollingAverage,
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
  rolling: ReturnPoint[]
  kpi: KPIData
}

export interface ComparisonResult {
  funds: FundComparisonData[]
  startDate: string
  endDate: string
}

export interface ComparisonError {
  type: 'no_overlap' | 'insufficient_data' | 'unknown'
  message: string
}

type ComparisonState =
  | { status: 'idle' }
  | { status: 'ready'; data: ComparisonResult }
  | { status: 'error'; error: ComparisonError }

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

      // Compute returns for each fund
      const allReturns = aligned.prices.map(prices =>
        weeklyReturns(aligned.dates, prices),
      )

      // Compute yearly for all (needed for winRate)
      const allYearly = allReturns.map(r => yearlyReturns(r))

      const startDate = aligned.dates[0]

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
  }, [fundIdsKey, fundData, rollingPeriod, dateFrom, dateTo])
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
