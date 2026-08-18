import { useState, useEffect } from 'react'
import type { PricePoint, FundMeta } from '../types'
import { parseCSV, parseFundMetadata, parseGoldCSV } from '../utils/csvParser'
import { loadAdjustedPrices } from '../utils/dividendAdjust'
import { isSavingsAssetId, savingsSeriesForId, pruneUnusedSavings } from '../utils/savingsAsset'

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

export type FundSeriesMode = 'normal' | 'dual'

export interface FundSeriesMapState {
  data: Map<string, PricePoint[]>
  raw: Map<string, PricePoint[]>
  purchase: Map<string, PricePoint[]>
  loading: boolean
  errors: Map<string, string>
}

interface FundSeriesMapOptions {
  dualPriceFundIds?: ReadonlySet<string>
}

interface LoadResult {
  id: string
  mode: FundSeriesMode
  data: PricePoint[] | null
  raw: PricePoint[] | null
  purchase: PricePoint[] | null
  error: string | null
}

function stableIdKey(ids: Iterable<string>): string {
  return Array.from(new Set(ids)).sort().join('\u0000')
}

function pruneSeriesMap<T>(cache: Map<string, T>, inUse: ReadonlySet<string>): Map<string, T> {
  const next = new Map(cache)
  const before = next.size
  pruneUnusedSavings(next, inUse)
  return next.size === before ? cache : next
}

function filterErrors(errors: Map<string, string>, inUse: ReadonlySet<string>): Map<string, string> {
  const next = new Map<string, string>()
  for (const [id, message] of errors) {
    if (inUse.has(id)) next.set(id, message)
  }
  return next
}

/**
 * Fetch, parse, adjust and cache every kind of price series used by the app.
 * The cache belongs to this hook instance. It is not a cross-tab request cache.
 */
export function useFundSeriesMap(
  fundIds: string[],
  options: FundSeriesMapOptions = {},
): FundSeriesMapState {
  const idsKey = stableIdKey(fundIds)
  const ids = idsKey ? idsKey.split('\u0000') : []
  const dualPriceFundIds = options.dualPriceFundIds
  const dualKey = stableIdKey(ids.filter(id => dualPriceFundIds?.has(id)))
  const requestKey = `${idsKey}\u0001${dualKey}`
  const requestedIds = new Set(ids)
  const requestedDualIds = new Set(dualKey ? dualKey.split('\u0000') : [])

  const [data, setData] = useState<Map<string, PricePoint[]>>(new Map())
  const [raw, setRaw] = useState<Map<string, PricePoint[]>>(new Map())
  const [purchase, setPurchase] = useState<Map<string, PricePoint[]>>(new Map())
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [cacheModes, setCacheModes] = useState<Map<string, FundSeriesMode>>(new Map())
  const [settledKey, setSettledKey] = useState('')

  useEffect(() => {
    let cancelled = false
    const modeFor = (id: string): FundSeriesMode => requestedDualIds.has(id) ? 'dual' : 'normal'
    const toLoad = ids.filter(id => !data.has(id) || cacheModes.get(id) !== modeFor(id))

    setErrors(prev => filterErrors(prev, requestedIds))

    if (toLoad.length === 0) {
      setData(prev => pruneSeriesMap(prev, requestedIds))
      setRaw(prev => pruneSeriesMap(prev, requestedIds))
      setSettledKey(requestKey)
      return () => { cancelled = true }
    }

    Promise.all(toLoad.map(async (id): Promise<LoadResult> => {
      const mode = modeFor(id)
      try {
        if (isSavingsAssetId(id)) {
          const series = savingsSeriesForId(id)
          return { id, mode, data: series, raw: series, purchase: null, error: null }
        }

        const resp = await fetch(`/data/${id}.csv`)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const text = await resp.text()

        if (mode === 'dual') {
          const { buy, sell } = parseGoldCSV(text)
          if (buy.length === 0) throw new Error('Chưa có dữ liệu')
          return {
            id,
            mode,
            data: buy,
            raw: buy,
            purchase: sell.length > 0 ? sell : null,
            error: null,
          }
        }

        const rawDaily = parseCSV(text)
        if (rawDaily.length === 0) throw new Error('Chưa có dữ liệu')
        const adjusted = await loadAdjustedPrices(id, rawDaily)
        return { id, mode, data: adjusted, raw: rawDaily, purchase: null, error: null }
      } catch (err) {
        return {
          id,
          mode,
          data: null,
          raw: null,
          purchase: null,
          error: err instanceof Error ? err.message : 'Không tải được dữ liệu quỹ',
        }
      }
    })).then(results => {
      if (cancelled) return

      setData(prev => {
        const next = new Map(prev)
        for (const result of results) {
          if (result.data) next.set(result.id, result.data)
          else next.delete(result.id)
        }
        return pruneSeriesMap(next, requestedIds)
      })
      setRaw(prev => {
        const next = new Map(prev)
        for (const result of results) {
          if (result.raw) next.set(result.id, result.raw)
          else next.delete(result.id)
        }
        return pruneSeriesMap(next, requestedIds)
      })
      setPurchase(prev => {
        const next = new Map(prev)
        for (const result of results) {
          if (result.purchase) next.set(result.id, result.purchase)
          else next.delete(result.id)
        }
        return next
      })
      setCacheModes(prev => {
        const next = new Map(prev)
        for (const result of results) {
          if (result.error) next.delete(result.id)
          else next.set(result.id, result.mode)
        }
        return next
      })
      setErrors(prev => {
        const next = filterErrors(prev, requestedIds)
        for (const result of results) {
          if (result.error) next.set(result.id, result.error)
          else next.delete(result.id)
        }
        return next
      })
      setSettledKey(requestKey)
    })

    return () => { cancelled = true }
    // State maps are intentionally read from the render that started this request.
    // The request key controls when this effect starts again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  return {
    data,
    raw,
    purchase,
    loading: ids.length > 0 && settledKey !== requestKey,
    errors,
  }
}

interface FundSeriesState {
  prices: PricePoint[] | null
  loading: boolean
  error: string | null
}

export function useFundSeries(fundId: string | null): FundSeriesState {
  const state = useFundSeriesMap(fundId ? [fundId] : [])
  if (!fundId) return { prices: null, loading: false, error: null }
  return {
    prices: state.data.get(fundId) ?? null,
    loading: state.loading,
    error: state.errors.get(fundId) ?? null,
  }
}

interface MultiFundState {
  data: Map<string, PricePoint[]>
  loading: boolean
  errors: Map<string, string>
}

export function useMultiFundSeries(fundIds: string[]): MultiFundState {
  const state = useFundSeriesMap(fundIds)
  return { data: state.data, loading: state.loading, errors: state.errors }
}
