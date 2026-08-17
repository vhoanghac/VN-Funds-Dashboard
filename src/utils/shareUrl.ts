import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { Portfolio, PortfolioSlot, RebalanceFrequency } from '../types'
import { isDCAFrequency, type DCAFrequency } from './dca'
import { isCashMode, isLSvsDCAFreq, type CashMode, type LSvsDCAFreq } from './lsVsDca'
import { parsePortfolio } from './portfolio'

// ─── Shared helpers ────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function encodeSlots(slots: PortfolioSlot[]): string {
  return slots
    .filter(s => s.fundId && s.weight > 0)
    .map(s => `${s.fundId}:${s.weight}`)
    .join(',')
}

function decodeSlots(str: string): PortfolioSlot[] {
  return str.split(',').flatMap(part => {
    const separator = part.lastIndexOf(':')
    if (separator <= 0) return []
    const fundId = part.slice(0, separator)
    const weight = Number(part.slice(separator + 1))
    if (!fundId || !Number.isFinite(weight) || weight <= 0) return []
    return [{ fundId, weight }]
  })
}

function origin(): string {
  return `${window.location.origin}${window.location.pathname}`
}

const DCA_LEGACY_KEYS = ['init', 'cashflow', 'freq', 'datemode', 'years', 'p1', 'p1r', 'p2', 'p2r', 'p3', 'p3r', 'p4', 'p4r']
const LS_DCA_LEGACY_KEYS = ['capital', 'horizon', 'freq', 'cash', 'rate', 'cfund', 'cmp', 'lsfunds', 'rebal']

export type ShareTab = 'dca' | 'lsdca'

export interface ShareUrlState<T> {
  key: string
  hasExplicitPayload: boolean
  parsedPayload: T | null
}

function paramsFromWindow(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}

function shareKey(
  params: URLSearchParams,
  tab: ShareTab,
  legacyKeys: string[],
  sharedKeys: string[] = [],
): string {
  if (params.get('tab') !== tab || !(params.has('s') || legacyKeys.some(key => params.has(key)))) {
    return `${tab}:none`
  }
  return [
    's',
    ...legacyKeys,
    ...sharedKeys,
  ].map(key => `${key}=${params.getAll(key).join(',')}`).join('&')
}

/** Remove a tab's share payload before handing the URL to another tab. */
export function clearSharePayload(params: URLSearchParams, ownerTab: ShareTab | null): void {
  const hadDcaPayload = ownerTab === 'dca' && (
    params.has('s') || DCA_LEGACY_KEYS.some(key => params.has(key))
  )
  params.delete('s')
  for (const key of new Set([...DCA_LEGACY_KEYS, ...LS_DCA_LEGACY_KEYS])) params.delete(key)
  // DCA's pre-compression format shared these names with the dashboard filters.
  if (hadDcaPayload) {
    params.delete('from')
    params.delete('to')
  }
}

export function getDcaShareKey(params: URLSearchParams): string {
  return shareKey(params, 'dca', DCA_LEGACY_KEYS, ['from', 'to'])
}

export function getLsDcaShareKey(params: URLSearchParams): string {
  return shareKey(params, 'lsdca', LS_DCA_LEGACY_KEYS)
}

export function hasDcaSharePayload(params: URLSearchParams = paramsFromWindow()): boolean {
  return params.get('tab') === 'dca' &&
    (params.has('s') || DCA_LEGACY_KEYS.some(key => params.has(key)))
}

export function hasLsDcaSharePayload(params: URLSearchParams = paramsFromWindow()): boolean {
  return params.get('tab') === 'lsdca' &&
    (params.has('s') || LS_DCA_LEGACY_KEYS.some(key => params.has(key)))
}

// ─── DCA ──────────────────────────────────────────────────────────────────

export interface DcaShareState {
  initialAmount: number
  cashflowAmount: number
  cashflowFreq: DCAFrequency
  dateMode: 'all' | 'years'
  yearsBack: number
  dateFrom: string
  dateTo: string
  portfolios: Portfolio[]
}

/**
 * URL chia sẻ được nén bằng lz-string thành 1 query param duy nhất (?s=...),
 * thay vì liệt kê từng tham số riêng lẻ. Rút ngắn đáng kể URL khi có nhiều
 * danh mục/nhiều quỹ, mà vẫn chạy hoàn toàn phía client (không cần backend).
 */
interface CompactDca {
  i?: number; c?: number; f?: DCAFrequency; dm?: 'all' | 'years'; y?: number
  from?: string; to?: string
  p?: { s: string; r: RebalanceFrequency; n?: string }[]
}

export function buildDcaUrl(s: DcaShareState): string {
  const compact: CompactDca = {
    i: s.initialAmount,
    c: s.cashflowAmount,
    f: s.cashflowFreq,
    dm: s.dateMode,
    y: s.dateMode === 'years' ? s.yearsBack : undefined,
    from: s.dateFrom || undefined,
    to: s.dateTo || undefined,
    p: s.portfolios
      .map(portfolio => ({ s: encodeSlots(portfolio.slots), r: portfolio.rebalFreq, n: portfolio.name || undefined }))
      .filter(portfolio => portfolio.s),
  }
  const encoded = compressToEncodedURIComponent(JSON.stringify(compact))
  return `${origin()}?tab=dca&s=${encoded}`
}

export function parseDcaParams(params: URLSearchParams = paramsFromWindow()): Partial<DcaShareState> | null {
  const p = params
  if (p.get('tab') !== 'dca') return null

  const compressed = p.get('s')
  if (compressed) return parseCompactDca(compressed)

  // Link cũ (trước khi nén) — vẫn đọc được để không phá link đã chia sẻ.
  return parseLegacyDcaParams(p)
}

function parseCompactDca(compressed: string): Partial<DcaShareState> | null {
  try {
    const json = decompressFromEncodedURIComponent(compressed)
    if (!json) return null
    const c = JSON.parse(json) as unknown
    if (!isRecord(c)) return null
    const result: Partial<DcaShareState> = {}

    if (typeof c.i === 'number' && c.i >= 0) result.initialAmount = c.i
    if (typeof c.c === 'number' && c.c >= 0) result.cashflowAmount = c.c
    if ('f' in c) result.cashflowFreq = isDCAFrequency(c.f) ? c.f : 'monthly'
    if (c.dm === 'all' || c.dm === 'years') result.dateMode = c.dm
    if (typeof c.y === 'number' && c.y > 0) result.yearsBack = c.y
    result.dateFrom = typeof c.from === 'string' ? c.from : ''
    result.dateTo = typeof c.to === 'string' ? c.to : ''

    if (Array.isArray(c.p)) {
      const portfolios: Portfolio[] = []
      for (const rawPortfolio of c.p) {
        if (!isRecord(rawPortfolio) || typeof rawPortfolio.s !== 'string') continue
        const slots = decodeSlots(rawPortfolio.s)
        if (slots.length === 0) continue
        const portfolio = parsePortfolio({
          slots,
          rebalFreq: rawPortfolio.r,
          name: rawPortfolio.n,
        })
        if (portfolio) portfolios.push(portfolio)
      }
      result.portfolios = portfolios
    }

    return result
  } catch {
    return null
  }
}

function parseLegacyDcaParams(p: URLSearchParams): Partial<DcaShareState> {
  const result: Partial<DcaShareState> = {}

  const init = parseInt(p.get('init') ?? '', 10)
  if (!isNaN(init) && init >= 0) result.initialAmount = init

  const cashflow = parseInt(p.get('cashflow') ?? '', 10)
  if (!isNaN(cashflow) && cashflow >= 0) result.cashflowAmount = cashflow

  const freq = p.get('freq') as DCAFrequency | null
  if (freq !== null) result.cashflowFreq = isDCAFrequency(freq) ? freq : 'monthly'

  const datemode = p.get('datemode')
  if (datemode === 'all' || datemode === 'years') result.dateMode = datemode

  const years = parseInt(p.get('years') ?? '', 10)
  if (!isNaN(years) && years > 0) result.yearsBack = years

  result.dateFrom = p.get('from') ?? ''
  result.dateTo = p.get('to') ?? ''

  // Parse portfolios p1, p2, p3...
  const portfolios: Portfolio[] = []
  for (let i = 1; i <= 4; i++) {
    const slotsStr = p.get(`p${i}`)
    if (!slotsStr) break
    const slots = decodeSlots(slotsStr)
    if (slots.length === 0) break
    const portfolio = parsePortfolio({ slots, rebalFreq: p.get(`p${i}r`) })
    if (portfolio) portfolios.push(portfolio)
  }
  if (portfolios.length > 0) result.portfolios = portfolios

  return result
}

// ─── LS vs DCA ────────────────────────────────────────────────────────────

export interface LsDcaShareState {
  totalCapital: number
  horizonMonths: number
  freq: LSvsDCAFreq
  cashMode: CashMode
  savingsRate: number
  cashFundId: string
  compareFundId: string
  portfolio: Portfolio | null
}

interface CompactLsDca {
  cap?: number; h?: number; f?: LSvsDCAFreq; cash?: CashMode; rate?: number
  cfund?: string; cmp?: string
  pf?: { s: string; r: RebalanceFrequency; n?: string }
}

export function buildLsDcaUrl(s: LsDcaShareState): string {
  const compact: CompactLsDca = {
    cap: s.totalCapital,
    h: s.horizonMonths,
    f: s.freq,
    cash: s.cashMode,
    rate: s.cashMode === 'savings' ? s.savingsRate : undefined,
    cfund: s.cashMode === 'fund' && s.cashFundId ? s.cashFundId : undefined,
    cmp: s.compareFundId || undefined,
  }
  if (s.portfolio) {
    const encoded = encodeSlots(s.portfolio.slots)
    if (encoded) compact.pf = { s: encoded, r: s.portfolio.rebalFreq, n: s.portfolio.name || undefined }
  }
  const encoded = compressToEncodedURIComponent(JSON.stringify(compact))
  return `${origin()}?tab=lsdca&s=${encoded}`
}

export function parseLsDcaParams(params: URLSearchParams = paramsFromWindow()): Partial<LsDcaShareState> | null {
  const p = params
  if (p.get('tab') !== 'lsdca') return null

  const compressed = p.get('s')
  if (compressed) return parseCompactLsDca(compressed)

  // Link cũ (trước khi nén) — vẫn đọc được để không phá link đã chia sẻ.
  return parseLegacyLsDcaParams(p)
}

function parseCompactLsDca(compressed: string): Partial<LsDcaShareState> | null {
  try {
    const json = decompressFromEncodedURIComponent(compressed)
    if (!json) return null
    const c = JSON.parse(json) as unknown
    if (!isRecord(c)) return null
    const result: Partial<LsDcaShareState> = {}

    if (typeof c.cap === 'number' && c.cap > 0) result.totalCapital = c.cap
    if (typeof c.h === 'number' && c.h > 0) result.horizonMonths = c.h
    if ('f' in c) result.freq = isLSvsDCAFreq(c.f) ? c.f : 'monthly'
    if ('cash' in c) result.cashMode = isCashMode(c.cash) ? c.cash : 'flat'
    if (typeof c.rate === 'number' && !isNaN(c.rate)) result.savingsRate = c.rate
    result.cashFundId = typeof c.cfund === 'string' ? c.cfund : ''
    result.compareFundId = typeof c.cmp === 'string' ? c.cmp : ''

    if (isRecord(c.pf) && typeof c.pf.s === 'string') {
      const slots = decodeSlots(c.pf.s)
      if (slots.length > 0) {
        const portfolio = parsePortfolio({
          slots,
          rebalFreq: c.pf.r,
          name: c.pf.n,
        })
        if (portfolio) result.portfolio = portfolio
      }
    }

    return result
  } catch {
    return null
  }
}

function parseLegacyLsDcaParams(p: URLSearchParams): Partial<LsDcaShareState> {
  const result: Partial<LsDcaShareState> = {}

  const capital = parseInt(p.get('capital') ?? '', 10)
  if (!isNaN(capital) && capital > 0) result.totalCapital = capital

  const horizon = parseInt(p.get('horizon') ?? '', 10)
  if (!isNaN(horizon) && horizon > 0) result.horizonMonths = horizon

  const freq = p.get('freq') as LSvsDCAFreq | null
  if (freq !== null) result.freq = isLSvsDCAFreq(freq) ? freq : 'monthly'

  const cash = p.get('cash') as CashMode | null
  if (cash !== null) result.cashMode = isCashMode(cash) ? cash : 'flat'

  const rate = parseFloat(p.get('rate') ?? '')
  if (!isNaN(rate)) result.savingsRate = rate

  result.cashFundId = p.get('cfund') ?? ''
  result.compareFundId = p.get('cmp') ?? ''

  const fundsStr = p.get('lsfunds')
  if (fundsStr) {
    const slots = decodeSlots(fundsStr)
    if (slots.length > 0) {
      const portfolio = parsePortfolio({ slots, rebalFreq: p.get('rebal') })
      if (portfolio) result.portfolio = portfolio
    }
  }

  return result
}
