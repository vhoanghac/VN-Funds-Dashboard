import { useState, useEffect } from 'react'
import type { PricePoint, FundMeta } from '../types'
import {
  formatCsvPriceWarning,
  parseCSV,
  parseFundMetadata,
  parseGoldCSV,
} from '../utils/csvParser'
import { loadAdjustedPriceData } from '../utils/dividendAdjust'
import { isSavingsAssetId, savingsPriceSeriesForId, pruneUnusedSavings } from '../utils/savingsAsset'
import {
  createPriceSeries,
  PriceSeriesValidationError,
  toPricePoints,
  toPriceSeriesPoints,
} from '../utils/priceSeries'

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
  warnings: Map<string, string[]>
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
  warnings: string[]
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

function filterByInUse<T>(values: Map<string, T>, inUse: ReadonlySet<string>): Map<string, T> {
  const next = new Map<string, T>()
  for (const [id, value] of values) {
    if (inUse.has(id)) next.set(id, value)
  }
  return next
}

function staticCsvSource(id: string): string {
  return `static-csv:/data/${id}.csv`
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof PriceSeriesValidationError) return 'Dữ liệu không hợp lệ'
  return error instanceof Error ? error.message : 'Không tải được dữ liệu quỹ'
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
  const [warningCache, setWarningCache] = useState<Map<string, string[]>>(new Map())
  const [cacheModes, setCacheModes] = useState<Map<string, FundSeriesMode>>(new Map())
  const [settledKey, setSettledKey] = useState('')

  useEffect(() => {
    let cancelled = false
    const modeFor = (id: string): FundSeriesMode => requestedDualIds.has(id) ? 'dual' : 'normal'
    const toLoad = ids.filter(id => !data.has(id) || cacheModes.get(id) !== modeFor(id))

    setErrors(prev => filterByInUse(prev, requestedIds))

    if (toLoad.length === 0) {
      setData(prev => pruneSeriesMap(prev, requestedIds))
      setRaw(prev => pruneSeriesMap(prev, requestedIds))
      setSettledKey(requestKey)
      return () => { cancelled = true }
    }

    Promise.all(toLoad.map(async (id): Promise<LoadResult> => {
      const mode = modeFor(id)
      let warnings: string[] = []
      try {
        if (isSavingsAssetId(id)) {
          const series = savingsPriceSeriesForId(id)
          const points = toPricePoints(series.points)
          return {
            id,
            mode,
            data: points,
            raw: points,
            purchase: null,
            error: null,
            warnings,
          }
        }

        const resp = await fetch(`/data/${id}.csv`)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const text = await resp.text()

        if (mode === 'dual') {
          const { buy, sell, warnings: parserWarnings } = parseGoldCSV(text)
          warnings = parserWarnings.map(formatCsvPriceWarning)
          if (buy.length === 0) throw new Error('Chưa có dữ liệu')
          const series = createPriceSeries({
            assetId: id,
            currency: 'VND',
            points: toPriceSeriesPoints(buy),
            purchasePoints: sell.length > 0 ? toPriceSeriesPoints(sell) : undefined,
            adjustments: [],
            source: staticCsvSource(id),
          })
          const data = toPricePoints(series.points)
          return {
            id,
            mode,
            data,
            raw: data,
            purchase: series.purchasePoints ? toPricePoints(series.purchasePoints) : [],
            error: null,
            warnings,
          }
        }

        const parsed = parseCSV(text)
        warnings = parsed.warnings.map(formatCsvPriceWarning)
        const rawDaily = parsed.points
        if (rawDaily.length === 0) throw new Error('Chưa có dữ liệu')
        const adjusted = await loadAdjustedPriceData(id, rawDaily)
        const series = createPriceSeries({
          assetId: id,
          currency: 'VND',
          points: toPriceSeriesPoints(adjusted.points),
          rawPoints: adjusted.appliedEvents.length > 0
            ? toPriceSeriesPoints(rawDaily)
            : undefined,
          adjustments: adjusted.appliedEvents.map(event => ({ kind: 'dividend', ...event })),
          source: staticCsvSource(id),
        })
        const data = toPricePoints(series.points)
        return {
          id,
          mode,
          data,
          raw: series.rawPoints ? toPricePoints(series.rawPoints) : data,
          purchase: null,
          error: null,
          warnings,
        }
      } catch (err) {
        return {
          id,
          mode,
          data: null,
          raw: null,
          purchase: null,
          error: loadErrorMessage(err),
          warnings,
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
        const next = filterByInUse(prev, requestedIds)
        for (const result of results) {
          if (result.error) next.set(result.id, result.error)
          else next.delete(result.id)
        }
        return next
      })
      setWarningCache(prev => {
        const next = new Map(prev)
        for (const result of results) {
          if (result.warnings.length > 0) next.set(result.id, result.warnings)
          else next.delete(result.id)
        }
        return pruneSeriesMap(next, requestedIds)
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
    warnings: filterByInUse(warningCache, requestedIds),
  }
}

interface FundSeriesState {
  prices: PricePoint[] | null
  loading: boolean
  error: string | null
  warnings: string[]
}

export function useFundSeries(fundId: string | null): FundSeriesState {
  const state = useFundSeriesMap(fundId ? [fundId] : [])
  if (!fundId) return { prices: null, loading: false, error: null, warnings: [] }
  return {
    prices: state.data.get(fundId) ?? null,
    loading: state.loading,
    error: state.errors.get(fundId) ?? null,
    warnings: state.warnings.get(fundId) ?? [],
  }
}

interface MultiFundState {
  data: Map<string, PricePoint[]>
  purchase: Map<string, PricePoint[]>
  loading: boolean
  errors: Map<string, string>
  warnings: Map<string, string[]>
}

export function useMultiFundSeries(
  fundIds: string[],
  options: FundSeriesMapOptions = {},
): MultiFundState {
  const state = useFundSeriesMap(fundIds, options)
  return {
    data: state.data,
    purchase: state.purchase,
    loading: state.loading,
    errors: state.errors,
    warnings: state.warnings,
  }
}
