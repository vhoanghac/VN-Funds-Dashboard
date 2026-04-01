import { useSearchParams } from 'react-router-dom'
import { useCallback, useMemo } from 'react'
import type { DashboardState } from '../types'
import { DEFAULT_FUNDS } from '../constants'

const VALID_TABS = ['compare', 'simulate', 'dca', 'changelog'] as const
const VALID_PERIODS = [6, 12, 24, 36, 48]

/**
 * Manages dashboard state via URL search params.
 * Supports N funds via comma-separated `funds` param.
 * Backward-compatible with old `a` & `b` params.
 */
export function useUrlState() {
  const [searchParams, setSearchParams] = useSearchParams()

  const state: DashboardState = useMemo(() => {
    const tab = searchParams.get('tab')
    const roll = parseInt(searchParams.get('roll') ?? '', 10)

    // Parse funds: comma-separated, or fallback to old a/b params
    let funds: string[]
    const fundsParam = searchParams.get('funds')
    if (fundsParam) {
      funds = fundsParam.split(',').filter(Boolean)
    } else {
      // Backward compat with old ?a=X&b=Y format
      const a = searchParams.get('a')
      const b = searchParams.get('b')
      if (a && b) funds = [a, b]
      else if (a) funds = [a]
      else funds = DEFAULT_FUNDS
    }

    return {
      funds: funds.length > 0 ? funds : DEFAULT_FUNDS,
      tab: VALID_TABS.includes(tab as typeof VALID_TABS[number])
        ? (tab as DashboardState['tab'])
        : 'compare',
      rollingPeriod: VALID_PERIODS.includes(roll) ? roll : 12,
      dateFrom: searchParams.get('from') || null,
      dateTo: searchParams.get('to') || null,
    }
  }, [searchParams])

  const updateState = useCallback(
    (updates: Partial<DashboardState>) => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        if (updates.funds !== undefined) {
          next.set('funds', updates.funds.join(','))
          // Clean up old params
          next.delete('a')
          next.delete('b')
        }
        if (updates.tab !== undefined) next.set('tab', updates.tab)
        if (updates.rollingPeriod !== undefined) next.set('roll', String(updates.rollingPeriod))
        if (updates.dateFrom !== undefined) {
          if (updates.dateFrom) next.set('from', updates.dateFrom)
          else next.delete('from')
        }
        if (updates.dateTo !== undefined) {
          if (updates.dateTo) next.set('to', updates.dateTo)
          else next.delete('to')
        }
        return next
      }, { replace: true })
    },
    [setSearchParams],
  )

  return { state, updateState }
}
