import { useSearchParams } from 'react-router-dom'
import { useCallback, useMemo } from 'react'
import type { CalculatorId, DashboardState } from '../types'
import { TAB_REGISTRY, type TabId } from '../tabRegistry'
import { CALCULATOR_IDS, DEFAULT_FUNDS } from '../constants'
import { loadLS, saveLS } from '../utils/localStorage'
import {
  clearSharePayload,
  getDcaShareKey,
  getLsDcaShareKey,
  hasDcaSharePayload,
  hasLsDcaSharePayload,
  parseDcaParams,
  parseLsDcaParams,
  type DcaShareState,
  type LsDcaShareState,
  type ShareTab,
  type ShareUrlState,
} from '../utils/shareUrl'

const VALID_TABS = TAB_REGISTRY.map(t => t.id) as readonly TabId[]
const VALID_PERIODS = [6, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120]
const DEFAULT_CALC_ID: CalculatorId = 'compound'

function isShareTab(tab: string | null): tab is ShareTab {
  return tab === 'dca' || tab === 'lsdca'
}

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
  const calcParam = searchParams.get('calcId')

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
    tab: VALID_TABS.includes(tabParam as TabId)
      ? (tabParam as DashboardState['tab'])
      : 'compare',
    rollingPeriod: VALID_PERIODS.includes(roll) ? roll : 12,
    dateFrom: fromParam || null,
    dateTo: toParam || null,
    // Link hỏng hoặc ai sửa tay URL thì quay về máy tính đầu tiên, không để
    // trang trắng. Cùng mẫu whitelist với VALID_TABS phía trên.
    calcId: CALCULATOR_IDS.includes(calcParam as CalculatorId)
      ? (calcParam as CalculatorId)
      : DEFAULT_CALC_ID,
  }

  const dcaShareKey = getDcaShareKey(searchParams)
  const dcaUrlParams = useMemo<ShareUrlState<Partial<DcaShareState>>>(() => {
    const hasExplicitPayload = hasDcaSharePayload(searchParams)
    return {
      key: dcaShareKey,
      hasExplicitPayload,
      parsedPayload: hasExplicitPayload ? parseDcaParams(searchParams) : null,
    }
  }, [dcaShareKey])

  const lsDcaShareKey = getLsDcaShareKey(searchParams)
  const lsDcaUrlParams = useMemo<ShareUrlState<Partial<LsDcaShareState>>>(() => {
    const hasExplicitPayload = hasLsDcaSharePayload(searchParams)
    return {
      key: lsDcaShareKey,
      hasExplicitPayload,
      parsedPayload: hasExplicitPayload ? parseLsDcaParams(searchParams) : null,
    }
  }, [lsDcaShareKey])

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
        if (updates.tab !== undefined) {
          const previousTab = next.get('tab')
          if (updates.tab !== previousTab && (isShareTab(previousTab) || isShareTab(updates.tab))) {
            clearSharePayload(next, isShareTab(previousTab) ? previousTab : null)
          }
          next.set('tab', updates.tab)
          // Rời tab Máy tính thì bỏ luôn calcId, đừng để nó bám lại trong URL
          // rồi lẫn vào link người ta copy đi chia sẻ.
          if (updates.tab !== 'calculator') next.delete('calcId')
        }
        if (updates.calcId !== undefined) next.set('calcId', updates.calcId)
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

  return { state, updateState, dcaUrlParams, lsDcaUrlParams }
}
