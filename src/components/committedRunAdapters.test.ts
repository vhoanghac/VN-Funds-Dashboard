import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const COMPONENT_DIR = join(__dirname)

const sources = {
  dca: readFileSync(join(COMPONENT_DIR, 'DCAPanel.tsx'), 'utf8'),
  lsDca: readFileSync(join(COMPONENT_DIR, 'LumpSumDCAPanel.tsx'), 'utf8'),
  rebalance: readFileSync(join(COMPONENT_DIR, 'RebalanceSensitivityPanel.tsx'), 'utf8'),
  tactical: readFileSync(join(COMPONENT_DIR, 'TacticalAllocationPanel.tsx'), 'utf8'),
  bitcoin: readFileSync(join(COMPONENT_DIR, 'BitcoinPanel.tsx'), 'utf8'),
}

describe('committed-run panel adapters', () => {
  for (const [name, source] of Object.entries(sources)) {
    it(`${name} uses the shared snapshot contract`, () => {
      expect(source).toMatch(/useCommittedRun\(\{/) 
      expect(source).toMatch(/captureSnapshot:/)
      expect(source).toMatch(/compute: snapshot =>/)
    })
  }

  it('DCA snapshots every data Map and passes result-only blocks the snapshot', () => {
    expect(sources.dca).toMatch(/fundData: new Map\(fundData\)/)
    expect(sources.dca).toMatch(/rawFundData: new Map\(rawFundData\)/)
    expect(sources.dca).toMatch(/purchasePriceData: new Map\(purchasePriceData\)/)
    expect(sources.dca).toMatch(/dividendsByFund: new Map\(dividendsByFund\)/)
    expect(sources.dca).toMatch(/const fundData = snapshot\.data\.fundData/)
    expect(sources.dca).toMatch(/const rawFundData = snapshot\.data\.rawFundData/)
    expect(sources.dca).toMatch(/fundData=\{committed!\.data\.fundData\}/)
    expect(sources.dca).toMatch(/purchasePriceData=\{committed!\.data\.purchasePriceData\}/)
  })

  it('DCA passes sell-price overrides only for dual-price assets', () => {
    expect(sources.dca).toMatch(/dualPriceFundIds\.has\(slot\.fundId\) && purchasePrices/)
  })

  it('Bitcoin snapshots the amount and uses committed data for auxiliary blocks', () => {
    expect(sources.bitcoin).toMatch(/investAmount,/) 
    expect(sources.bitcoin).toMatch(/investAmount=\{committed\.params\.investAmount\}/)
    expect(sources.bitcoin).toMatch(/btc=\{committed\.data\.get\(BTC_ID\)/)
    expect(sources.bitcoin).toMatch(/base=\{committed\.data\.get\(committed\.params\.fundId\)/)
  })

  it('Tactical sends only snapshot data to the engine and result props', () => {
    expect(sources.tactical).toMatch(/rawPrices: snapshot\.data/)
    expect(sources.tactical).toMatch(/nameA=\{committed\.labels\.nameA\}/)
    expect(sources.tactical).toMatch(/indicatorType=\{committed\.params\.indicatorType\}/)
    expect(sources.tactical).not.toMatch(/rawPrices: fundData/)
  })

  it('Rebalance and LS-DCA compute from snapshot-local data', () => {
    expect(sources.rebalance).toMatch(/data: new Map\(fundData\)/)
    expect(sources.rebalance).toMatch(/const fundData = snapshot\.data/)
    expect(sources.lsDca).toMatch(/data: snapshot\.data/)
    expect(sources.lsDca).toMatch(/compareFundName: string \| null/)
  })

  it('all adapters wait for settled data before committing', () => {
    for (const source of Object.values(sources)) {
      expect(source).toMatch(/ready: dataReady/)
      expect(source).toMatch(/valid: canRun/)
      expect(source).toMatch(/!loading/)
    }
  })

  it('Rebalance does not fetch zero-weight slots', () => {
    expect(sources.rebalance).toMatch(/if \(s\.fundId && s\.weight > 0\) ids\.add\(s\.fundId\)/)
  })

  it('Bitcoin defers a complete old result, not only its return arrays', () => {
    expect(sources.bitcoin).toMatch(/const runView = useMemo\(/)
    expect(sources.bitcoin).toMatch(/const deferredRun = useDeferredValue\(runView\)/)
    expect(sources.bitcoin).toMatch(/const heavyParams = deferredRun\?\.committed\?\.params/)
    expect(sources.bitcoin).toMatch(/stats=\{deferredPortfolioStats\}/)
  })
})
