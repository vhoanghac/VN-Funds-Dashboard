import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { RebalanceFrequency } from '../types'
import type { DCAFrequency } from './dca'
import type { CashMode, LSvsDCAFreq } from './lsVsDca'

// ─── Shared helpers ────────────────────────────────────────────────────────

interface Slot { fundId: string; weight: number }
/** name chỉ có khi người dùng tự đặt tên (isNameCustom) — tên tự sinh từ mã quỹ không cần lưu vào URL/localStorage */
interface Portfolio { slots: Slot[]; rebalFreq: RebalanceFrequency; name?: string }

function encodeSlots(slots: Slot[]): string {
  return slots
    .filter(s => s.fundId && s.weight > 0)
    .map(s => `${s.fundId}:${s.weight}`)
    .join(',')
}

function decodeSlots(str: string): Slot[] {
  return str.split(',').flatMap(part => {
    const [fundId, weightStr] = part.split(':')
    const weight = parseInt(weightStr ?? '', 10)
    if (!fundId || isNaN(weight) || weight <= 0) return []
    return [{ fundId, weight }]
  })
}

function origin(): string {
  return `${window.location.origin}${window.location.pathname}`
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

export function parseDcaParams(): Partial<DcaShareState> | null {
  const p = new URLSearchParams(window.location.search)
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
    const c = JSON.parse(json) as CompactDca
    const result: Partial<DcaShareState> = {}

    if (typeof c.i === 'number' && c.i >= 0) result.initialAmount = c.i
    if (typeof c.c === 'number' && c.c >= 0) result.cashflowAmount = c.c
    if (c.f) result.cashflowFreq = c.f
    if (c.dm === 'all' || c.dm === 'years') result.dateMode = c.dm
    if (typeof c.y === 'number' && c.y > 0) result.yearsBack = c.y
    result.dateFrom = c.from ?? ''
    result.dateTo = c.to ?? ''

    if (Array.isArray(c.p)) {
      const portfolios: Portfolio[] = []
      for (const portfolio of c.p) {
        const slots = decodeSlots(portfolio.s ?? '')
        if (slots.length === 0) continue
        portfolios.push({ slots, rebalFreq: portfolio.r ?? 'quarterly', name: portfolio.n || undefined })
      }
      if (portfolios.length > 0) result.portfolios = portfolios
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
  if (freq) result.cashflowFreq = freq

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
    const rebalFreq = (p.get(`p${i}r`) ?? 'quarterly') as RebalanceFrequency
    portfolios.push({ slots, rebalFreq })
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

export function parseLsDcaParams(): Partial<LsDcaShareState> | null {
  const p = new URLSearchParams(window.location.search)
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
    const c = JSON.parse(json) as CompactLsDca
    const result: Partial<LsDcaShareState> = {}

    if (typeof c.cap === 'number' && c.cap > 0) result.totalCapital = c.cap
    if (typeof c.h === 'number' && c.h > 0) result.horizonMonths = c.h
    if (c.f === 'weekly' || c.f === 'monthly') result.freq = c.f
    if (c.cash === 'flat' || c.cash === 'savings' || c.cash === 'fund') result.cashMode = c.cash
    if (typeof c.rate === 'number' && !isNaN(c.rate)) result.savingsRate = c.rate
    result.cashFundId = c.cfund ?? ''
    result.compareFundId = c.cmp ?? ''

    if (c.pf) {
      const slots = decodeSlots(c.pf.s ?? '')
      if (slots.length > 0) {
        result.portfolio = { slots, rebalFreq: c.pf.r ?? 'quarterly', name: c.pf.n || undefined }
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
  if (freq === 'weekly' || freq === 'monthly') result.freq = freq

  const cash = p.get('cash') as CashMode | null
  if (cash === 'flat' || cash === 'savings' || cash === 'fund') result.cashMode = cash

  const rate = parseFloat(p.get('rate') ?? '')
  if (!isNaN(rate)) result.savingsRate = rate

  result.cashFundId = p.get('cfund') ?? ''
  result.compareFundId = p.get('cmp') ?? ''

  const fundsStr = p.get('lsfunds')
  if (fundsStr) {
    const slots = decodeSlots(fundsStr)
    if (slots.length > 0) {
      const rebalFreq = (p.get('rebal') ?? 'quarterly') as RebalanceFrequency
      result.portfolio = { slots, rebalFreq }
    }
  }

  return result
}
