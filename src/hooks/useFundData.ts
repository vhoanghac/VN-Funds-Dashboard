import { useState, useEffect, useMemo } from 'react'
import type { WeeklyPrice, FundMeta } from '../types'
import { parseCSV, parseFundMetadata } from '../utils/csvParser'
import { resampleToWeekly } from '../utils/weeklyResample'

interface FundDataState {
  metadata: FundMeta[] | null
  metadataError: string | null
  loading: boolean
}

/**
 * Fetch and parse fund_metadata.json
 */
export function useFundMetadata(): FundDataState {
  const [state, setState] = useState<FundDataState>({
    metadata: null,
    metadataError: null,
    loading: true,
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const resp = await fetch('/data/fund_metadata.json')
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const text = await resp.text()
        const metadata = parseFundMetadata(text)
        if (!cancelled) {
          setState({ metadata, metadataError: null, loading: false })
        }
      } catch {
        if (!cancelled) {
          setState({
            metadata: null,
            metadataError: 'Không thể tải danh sách quỹ. Vui lòng tải lại trang.',
            loading: false,
          })
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  return state
}

/**
 * Fetch and parse a single fund's CSV, resampled to weekly.
 */
interface FundSeriesState {
  weekly: WeeklyPrice[] | null
  loading: boolean
  error: string | null
}

export function useFundSeries(fundId: string | null): FundSeriesState {
  const [state, setState] = useState<FundSeriesState>({
    weekly: null,
    loading: false,
    error: null,
  })

  useEffect(() => {
    if (!fundId) {
      setState({ weekly: null, loading: false, error: null })
      return
    }

    let cancelled = false
    setState({ weekly: null, loading: true, error: null })

    async function load() {
      try {
        const resp = await fetch(`/data/${fundId}.csv`)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const text = await resp.text()
        const daily = parseCSV(text)

        if (daily.length === 0) {
          throw new Error('Chưa có dữ liệu')
        }

        const weekly = resampleToWeekly(daily)
        if (!cancelled) {
          setState({ weekly, loading: false, error: null })
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Không tải được dữ liệu quỹ'
          setState({ weekly: null, loading: false, error: message })
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [fundId])

  return state
}

/**
 * Fetch and parse multiple funds' CSVs, resampled to weekly.
 * Caches previously fetched funds so only new funds are fetched.
 */
interface MultiFundState {
  data: Map<string, WeeklyPrice[]>
  loading: boolean
  errors: Map<string, string>
}

export function useMultiFundSeries(fundIds: string[]): MultiFundState {
  const [data, setData] = useState<Map<string, WeeklyPrice[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Map<string, string>>(new Map())

  const neededIds = useMemo(
    () => fundIds.filter(id => !data.has(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fundIds.join(','), data],
  )

  useEffect(() => {
    if (neededIds.length === 0) return

    let cancelled = false
    setLoading(true)

    Promise.all(
      neededIds.map(async id => {
        try {
          const resp = await fetch(`/data/${id}.csv`)
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const text = await resp.text()
          const daily = parseCSV(text)
          if (daily.length === 0) throw new Error('Chưa có dữ liệu')
          const weekly = resampleToWeekly(daily)
          return { id, weekly, error: null as string | null }
        } catch (err) {
          return { id, weekly: null as WeeklyPrice[] | null, error: err instanceof Error ? err.message : 'Lỗi' }
        }
      }),
    ).then(results => {
      if (cancelled) return
      setData(prev => {
        const next = new Map(prev)
        for (const r of results) {
          if (r.weekly) next.set(r.id, r.weekly)
        }
        return next
      })
      setErrors(new Map(
        results.filter(r => r.error !== null).map(r => [r.id, r.error!]),
      ))
      setLoading(false)
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededIds.join(',')])

  const allLoaded = fundIds.length > 0 && fundIds.every(id => data.has(id))

  return { data, loading: loading || (fundIds.length > 0 && !allLoaded), errors }
}
