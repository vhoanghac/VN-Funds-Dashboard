import { useState, useEffect, useMemo } from 'react'
import type { PricePoint, FundMeta } from '../types'
import { parseCSV, parseFundMetadata } from '../utils/csvParser'
import { loadAdjustedPrices } from '../utils/dividendAdjust'

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
 * Fetch and parse a single fund's CSV (daily prices).
 */
interface FundSeriesState {
  prices: PricePoint[] | null
  loading: boolean
  error: string | null
}

export function useFundSeries(fundId: string | null): FundSeriesState {
  const [state, setState] = useState<FundSeriesState>({
    prices: null,
    loading: false,
    error: null,
  })

  useEffect(() => {
    if (!fundId) {
      setState({ prices: null, loading: false, error: null })
      return
    }

    let cancelled = false
    setState({ prices: null, loading: true, error: null })
    const id = fundId // narrow for closure

    async function load() {
      try {
        const resp = await fetch(`/data/${id}.csv`)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const text = await resp.text()
        const rawDaily = parseCSV(text)

        if (rawDaily.length === 0) {
          throw new Error('Chưa có dữ liệu')
        }

        // Áp dụng dividend adjustment (DCDE...), giữ nguyên daily cho tính toán
        const daily = await loadAdjustedPrices(id, rawDaily)
        if (!cancelled) {
          setState({ prices: daily, loading: false, error: null })
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Không tải được dữ liệu quỹ'
          setState({ prices: null, loading: false, error: message })
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [fundId])

  return state
}

/**
 * Fetch and parse multiple funds' CSVs (daily prices).
 * Caches previously fetched funds so only new funds are fetched.
 */
interface MultiFundState {
  data: Map<string, PricePoint[]>
  loading: boolean
  errors: Map<string, string>
}

export function useMultiFundSeries(fundIds: string[]): MultiFundState {
  const [data, setData] = useState<Map<string, PricePoint[]>>(new Map())
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
          const rawDaily = parseCSV(text)
          if (rawDaily.length === 0) throw new Error('Chưa có dữ liệu')
          const daily = await loadAdjustedPrices(id, rawDaily)
          return { id, prices: daily, error: null as string | null }
        } catch (err) {
          return { id, prices: null as PricePoint[] | null, error: err instanceof Error ? err.message : 'Lỗi' }
        }
      }),
    ).then(results => {
      if (cancelled) return
      setData(prev => {
        const next = new Map(prev)
        for (const r of results) {
          if (r.prices) next.set(r.id, r.prices)
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
