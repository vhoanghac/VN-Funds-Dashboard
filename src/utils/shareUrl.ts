import type { RebalanceFrequency } from '../types'
import type { DCAFrequency } from './dca'
import type { CashMode, LSvsDCAFreq } from './lsVsDca'

// ─── Shared helpers ────────────────────────────────────────────────────────

interface Slot { fundId: string; weight: number }
interface Portfolio { slots: Slot[]; rebalFreq: RebalanceFrequency }

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
  portfolios: Array<{ slots: Slot[]; rebalFreq: RebalanceFrequency }>
}

export function buildDcaUrl(s: DcaShareState): string {
  const p = new URLSearchParams()
  p.set('tab', 'dca')
  p.set('init', String(s.initialAmount))
  p.set('cashflow', String(s.cashflowAmount))
  p.set('freq', s.cashflowFreq)
  p.set('datemode', s.dateMode)
  if (s.dateMode === 'years') p.set('years', String(s.yearsBack))
  if (s.dateFrom) p.set('from', s.dateFrom)
  if (s.dateTo) p.set('to', s.dateTo)

  s.portfolios.forEach((portfolio, i) => {
    const encoded = encodeSlots(portfolio.slots)
    if (encoded) {
      p.set(`p${i + 1}`, encoded)
      p.set(`p${i + 1}r`, portfolio.rebalFreq)
    }
  })

  return `${origin()}?${p.toString()}`
}

export function parseDcaParams(): Partial<DcaShareState> | null {
  const p = new URLSearchParams(window.location.search)
  if (p.get('tab') !== 'dca') return null

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

export function buildLsDcaUrl(s: LsDcaShareState): string {
  const p = new URLSearchParams()
  p.set('tab', 'lsdca')
  p.set('capital', String(s.totalCapital))
  p.set('horizon', String(s.horizonMonths))
  p.set('freq', s.freq)
  p.set('cash', s.cashMode)
  if (s.cashMode === 'savings') p.set('rate', String(s.savingsRate))
  if (s.cashMode === 'fund' && s.cashFundId) p.set('cfund', s.cashFundId)
  if (s.compareFundId) p.set('cmp', s.compareFundId)

  if (s.portfolio) {
    const encoded = encodeSlots(s.portfolio.slots)
    if (encoded) {
      p.set('funds', encoded)
      p.set('rebal', s.portfolio.rebalFreq)
    }
  }

  return `${origin()}?${p.toString()}`
}

export function parseLsDcaParams(): Partial<LsDcaShareState> | null {
  const p = new URLSearchParams(window.location.search)
  if (p.get('tab') !== 'lsdca') return null

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

  const fundsStr = p.get('funds')
  if (fundsStr) {
    const slots = decodeSlots(fundsStr)
    if (slots.length > 0) {
      const rebalFreq = (p.get('rebal') ?? 'quarterly') as RebalanceFrequency
      result.portfolio = { slots, rebalFreq }
    }
  }

  return result
}
