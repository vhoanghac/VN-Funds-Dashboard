import { useSearchParams } from 'react-router-dom'
import { useCallback, useMemo } from 'react'
import type { DashboardState } from '../types'
import { DEFAULT_FUNDS } from '../constants'
import { loadLS, saveLS } from '../utils/localStorage'

const VALID_TABS = ['compare', 'simulate', 'dca', 'lsdca', 'bitcoin', 'changelog'] as const
const VALID_PERIODS = [6, 12, 24, 36, 48]

/**
 * Manages dashboard state via URL search params.
 * Supports N funds via comma-separated `funds` param.
 * Backward-compatible with old `a` & `b` params.
 */
export function useUrlState() {
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = searchParams.get('tab')
  const rollParam = searchParams.get('roll')
  const fundsParam = searchParams.get('funds')
  const aParam = searchParams.get('a')
  const bParam = searchParams.get('b')
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  // Chỉ tạo lại mảng funds khi GIÁ TRỊ param thực sự đổi, không phải mỗi khi
  // searchParams đổi reference vì lý do khác (vd chuyển tab). Nhờ vậy các
  // component nhận `funds` làm prop (được bọc React.memo) mới thực sự bỏ
  // qua re-render khi tab khác thay đổi — nếu tạo mảng mới mỗi lần, memo sẽ
  // luôn thấy props "khác" (so sánh theo reference) dù nội dung y hệt.
  const funds = useMemo(() => {
    let result: string[]
    if (fundsParam) {
      result = fundsParam.split(',').filter(Boolean)
    } else if (aParam && bParam) {
      // Backward compat với format cũ ?a=X&b=Y
      result = [aParam, bParam]
    } else if (aParam) {
      result = [aParam]
    } else {
      result = loadLS('compare_funds', DEFAULT_FUNDS)
    }
    return result.length > 0 ? result : DEFAULT_FUNDS
  }, [fundsParam, aParam, bParam])

  const roll = parseInt(rollParam ?? '', 10)

  const state: DashboardState = {
    funds,
    tab: VALID_TABS.includes(tabParam as typeof VALID_TABS[number])
      ? (tabParam as DashboardState['tab'])
      : 'compare',
    rollingPeriod: VALID_PERIODS.includes(roll) ? roll : 12,
    dateFrom: fromParam || null,
    dateTo: toParam || null,
  }

  const updateState = useCallback(
    (updates: Partial<DashboardState>) => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        if (updates.funds !== undefined) {
          next.set('funds', updates.funds.join(','))
          // Clean up old params
          next.delete('a')
          next.delete('b')
          saveLS('compare_funds', updates.funds)
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
