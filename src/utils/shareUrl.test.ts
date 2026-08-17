import { describe, it, expect, afterEach } from 'vitest'
import { compressToEncodedURIComponent } from 'lz-string'
import {
  buildDcaUrl,
  hasDcaSharePayload,
  hasLsDcaSharePayload,
  parseDcaParams,
  buildLsDcaUrl,
  parseLsDcaParams,
  type DcaShareState,
  type LsDcaShareState,
} from './shareUrl'
import { parseSavingsRate, savingsAssetId } from './savingsAsset'

/** Point window.location at a URL so the parsers read it, as a real visit would. */
function visit(url: string): void {
  const parsed = new URL(url, window.location.href)
  window.history.replaceState({}, '', parsed.pathname + parsed.search)
}

function visitCompact(tab: string, payload: unknown): void {
  visit(`/?tab=${tab}&s=${compressToEncodedURIComponent(JSON.stringify(payload))}`)
}

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

const dcaState: DcaShareState = {
  initialAmount: 50_000_000,
  cashflowAmount: 5_000_000,
  cashflowFreq: 'monthly',
  dateMode: 'years',
  yearsBack: 5,
  dateFrom: '2019-01-01',
  dateTo: '2024-01-01',
  portfolios: [
    { slots: [{ fundId: 'DCDS', weight: 60 }, { fundId: 'VESAF', weight: 40 }], rebalFreq: 'quarterly' },
    { slots: [{ fundId: 'SSISCA', weight: 100 }], rebalFreq: 'yearly', name: 'Danh mục của tôi' },
  ],
}

describe('DCA share link', () => {
  it('survives a full round trip', () => {
    visit(buildDcaUrl(dcaState))
    expect(parseDcaParams()).toEqual(dcaState)
  })

  it('keeps a custom portfolio name', () => {
    visit(buildDcaUrl(dcaState))
    expect(parseDcaParams()!.portfolios![1]!.name).toBe('Danh mục của tôi')
  })

  it('keeps a name with diacritics and URL-significant characters intact', () => {
    // '&', '?' and '=' would split the query string if the payload were not
    // encoded, so this is the case that breaks first if compression changes.
    const name = 'Quỹ hưu trí & tiết kiệm ?dài=hạn'
    const state = {
      ...dcaState,
      portfolios: [{ slots: [{ fundId: 'DCDS', weight: 100 }], rebalFreq: 'quarterly' as const, name }],
    }
    visit(buildDcaUrl(state))
    expect(parseDcaParams()!.portfolios![0]!.name).toBe(name)
  })

  it('drops slots with no weight or no fund', () => {
    const state = {
      ...dcaState,
      portfolios: [{
        slots: [
          { fundId: 'DCDS', weight: 100 },
          { fundId: 'VESAF', weight: 0 },
          { fundId: '', weight: 50 },
        ],
        rebalFreq: 'quarterly' as const,
      }],
    }
    visit(buildDcaUrl(state))
    expect(parseDcaParams()!.portfolios![0]!.slots).toEqual([{ fundId: 'DCDS', weight: 100 }])
  })

  it('drops a portfolio left completely empty', () => {
    const state = {
      ...dcaState,
      portfolios: [
        { slots: [{ fundId: 'DCDS', weight: 100 }], rebalFreq: 'quarterly' as const },
        { slots: [], rebalFreq: 'quarterly' as const },
      ],
    }
    visit(buildDcaUrl(state))
    expect(parseDcaParams()!.portfolios).toHaveLength(1)
  })

  it('ignores the link when it belongs to another tab', () => {
    visit(buildLsDcaUrl({
      totalCapital: 1, horizonMonths: 1, freq: 'monthly', cashMode: 'flat',
      savingsRate: 0, cashFundId: '', compareFundId: '', portfolio: null,
    }))
    expect(parseDcaParams()).toBeNull()
  })

  it('returns null instead of throwing on a corrupted payload', () => {
    // A link mangled by a chat app must not take the tab down with it.
    visit('/?tab=dca&s=not-actually-compressed')
    expect(parseDcaParams()).toBeNull()
  })

  it('still reads pre-compression links', () => {
    visit('/?tab=dca&init=1000&cashflow=500&freq=monthly&datemode=years&years=3&p1=DCDS:70,VESAF:30&p1r=yearly')
    const parsed = parseDcaParams()!
    expect(parsed.initialAmount).toBe(1000)
    expect(parsed.yearsBack).toBe(3)
    expect(parsed.portfolios).toEqual([
      { slots: [{ fundId: 'DCDS', weight: 70 }, { fundId: 'VESAF', weight: 30 }], rebalFreq: 'yearly' },
    ])
  })

  it('stops at the first missing slot in a legacy link', () => {
    // The p1..p4 loop breaks on a gap, so p3 is unreachable once p2 is absent.
    visit('/?tab=dca&p1=DCDS:100&p3=VESAF:100')
    expect(parseDcaParams()!.portfolios).toHaveLength(1)
  })

  it('defaults the rebalance frequency when a legacy link omits it', () => {
    visit('/?tab=dca&p1=DCDS:100')
    expect(parseDcaParams()!.portfolios![0]!.rebalFreq).toBe('quarterly')
  })

  it('detects a corrupted compact payload as an explicit share payload', () => {
    visit('/?tab=dca&s=not-actually-compressed')
    expect(hasDcaSharePayload()).toBe(true)
  })

  it('does not treat shared date filters alone as a DCA payload', () => {
    visit('/?tab=dca&from=2020-01-01&to=2024-01-01')
    expect(hasDcaSharePayload()).toBe(false)
  })

  it('preserves savings asset IDs and decimal weights in a share link', () => {
    const state = {
      ...dcaState,
      portfolios: [{
        slots: [{ fundId: 'SAVINGS:6', weight: 33.3 }, { fundId: 'DCDS', weight: 66.7 }],
        rebalFreq: 'quarterly' as const,
      }],
    }
    visit(buildDcaUrl(state))
    expect(parseDcaParams()!.portfolios).toEqual(state.portfolios)
  })

  it('keeps a decimal savings rate intact through the share link', () => {
    const state = {
      ...dcaState,
      portfolios: [{
        slots: [{ fundId: savingsAssetId(6.5), weight: 100 }],
        rebalFreq: 'quarterly' as const,
      }],
    }
    visit(buildDcaUrl(state))
    const parsed = parseDcaParams()!.portfolios![0]!
    expect(parsed.slots).toEqual([{ fundId: 'SAVINGS:6.5', weight: 100 }])
    expect(parseSavingsRate(parsed.slots[0]!.fundId)).toBe(6.5)
  })

  it('keeps a 100% savings weight in the share link', () => {
    const state = {
      ...dcaState,
      portfolios: [{
        slots: [{ fundId: 'SAVINGS:6.5', weight: 100 }],
        rebalFreq: 'quarterly' as const,
      }],
    }
    visit(buildDcaUrl(state))
    expect(parseDcaParams()!.portfolios).toEqual(state.portfolios)
  })

  it('defaults an invalid frequency in a compact link', () => {
    visitCompact('dca', { p: [{ s: 'DCDS:100', r: 'never', n: 'Danh mục cũ' }] })
    expect(parseDcaParams()!.portfolios).toEqual([{
      slots: [{ fundId: 'DCDS', weight: 100 }],
      rebalFreq: 'quarterly',
      name: 'Danh mục cũ',
    }])
  })

  it('keeps an explicit empty portfolio list from falling back to local state', () => {
    visitCompact('dca', { p: [] })
    expect(parseDcaParams()!.portfolios).toEqual([])
  })

  it('defaults an invalid frequency in a legacy link', () => {
    visit('/?tab=dca&p1=DCDS:100&p1r=never')
    expect(parseDcaParams()!.portfolios![0]!.rebalFreq).toBe('quarterly')
  })
})

describe('LS vs DCA share link', () => {
  const base: LsDcaShareState = {
    totalCapital: 200_000_000,
    horizonMonths: 24,
    freq: 'monthly',
    cashMode: 'savings',
    savingsRate: 5.5,
    cashFundId: '',
    compareFundId: 'DCDS',
    portfolio: { slots: [{ fundId: 'VESAF', weight: 100 }], rebalFreq: 'quarterly' },
  }

  it('survives a full round trip', () => {
    visit(buildLsDcaUrl(base))
    expect(parseLsDcaParams()).toEqual(base)
  })

  it('carries the savings rate only in savings mode', () => {
    visit(buildLsDcaUrl({ ...base, cashMode: 'flat' }))
    expect(parseLsDcaParams()!.savingsRate).toBeUndefined()
  })

  it('carries the cash fund only in fund mode', () => {
    visit(buildLsDcaUrl({ ...base, cashMode: 'fund', cashFundId: 'VFF' }))
    expect(parseLsDcaParams()!.cashFundId).toBe('VFF')

    visit(buildLsDcaUrl({ ...base, cashMode: 'savings', cashFundId: 'VFF' }))
    expect(parseLsDcaParams()!.cashFundId).toBe('')
  })

  it('handles a link with no portfolio attached', () => {
    visit(buildLsDcaUrl({ ...base, portfolio: null }))
    expect(parseLsDcaParams()!.portfolio).toBeUndefined()
  })

  it('ignores the link when it belongs to another tab', () => {
    visit(buildDcaUrl(dcaState))
    expect(parseLsDcaParams()).toBeNull()
  })

  it('returns null instead of throwing on a corrupted payload', () => {
    visit('/?tab=lsdca&s=%%%broken%%%')
    expect(parseLsDcaParams()).toBeNull()
  })

  it('still reads pre-compression links', () => {
    visit('/?tab=lsdca&capital=100000&horizon=12&freq=weekly&cash=savings&rate=6&lsfunds=DCDS:100&rebal=yearly')
    const parsed = parseLsDcaParams()!
    expect(parsed.totalCapital).toBe(100000)
    expect(parsed.freq).toBe('weekly')
    expect(parsed.savingsRate).toBe(6)
    expect(parsed.portfolio).toEqual({
      slots: [{ fundId: 'DCDS', weight: 100 }], rebalFreq: 'yearly',
    })
  })

  it('detects a valid LS-DCA URL without a portfolio as an explicit share payload', () => {
    visit(buildLsDcaUrl({ ...base, portfolio: null }))
    expect(hasLsDcaSharePayload()).toBe(true)
  })

  it('defaults an invalid frequency in compact and legacy LS-DCA links', () => {
    visitCompact('lsdca', { pf: { s: 'DCDS:100', r: 'never', n: 'Danh mục cũ' } })
    expect(parseLsDcaParams()!.portfolio).toEqual({
      slots: [{ fundId: 'DCDS', weight: 100 }],
      rebalFreq: 'quarterly',
      name: 'Danh mục cũ',
    })

    visit('/?tab=lsdca&lsfunds=DCDS:100&rebal=never')
    expect(parseLsDcaParams()!.portfolio!.rebalFreq).toBe('quarterly')
  })
})
