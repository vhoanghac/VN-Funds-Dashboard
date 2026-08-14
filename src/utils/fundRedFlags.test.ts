import { describe, it, expect } from 'vitest'
import {
  computeVerdictAt, redFlagSummary, redFlagHistory,
  type RedFlagPoint, type RedFlagId,
} from './fundRedFlags'

function pt(over: Partial<RedFlagPoint> = {}): RedFlagPoint {
  return {
    period: '2026-07-31',
    turnoverRate: null,
    brokerageFee: null,
    managementFee: null,
    relatedPartyOwnership: null,
    outstandingUnits: null,
    redemptionFlow: null,
    realizedGain: null,
    cashValue: null,
    totalValue: null,
    ...over,
  }
}

function last(id: RedFlagId, points: RedFlagPoint[]) {
  return redFlagSummary(id, points)
}

describe('D1 — Cỗ máy giao dịch', () => {
  it('turnover ×100 (regression bug 850850c): 6.84 → 684% → DANGER', () => {
    const r = last('machine', [pt({ turnoverRate: 6.84, managementFee: 1e9, brokerageFee: 0.6e9 })])
    expect(r.verdict).toBe('DANGER')
    expect(r.keyMetric).toBeCloseTo(684, 5)
  })

  it('turnover 3.5 → 350% → WATCH', () => {
    expect(last('machine', [pt({ turnoverRate: 3.5, managementFee: 1e9, brokerageFee: 0.1e9 })]).verdict).toBe('WATCH')
  })

  it('tỉ lệ phí MG/FM ≥ 50% → WATCH dù turnover thấp', () => {
    const r = last('machine', [pt({ turnoverRate: 2.0, managementFee: 1e9, brokerageFee: 0.6e9 })])
    expect(r.verdict).toBe('WATCH')
    expect(r.extra).toBe('60%')
  })

  it('tỉ lệ phí MG/FM ≥ 80% → DANGER', () => {
    expect(last('machine', [pt({ turnoverRate: 1.0, managementFee: 1e9, brokerageFee: 0.9e9 })]).verdict).toBe('DANGER')
  })

  it('bình thường → OK (turnover 250%, tỉ lệ 40%)', () => {
    expect(last('machine', [pt({ turnoverRate: 2.5, managementFee: 1e9, brokerageFee: 0.4e9 })]).verdict).toBe('OK')
  })

  it('biên ngưỡng: turnover đúng 5.0 → 500% → DANGER; 2.99 → 299% → OK', () => {
    expect(last('machine', [pt({ turnoverRate: 5.0, managementFee: 1e9, brokerageFee: 0.1e9 })]).verdict).toBe('DANGER')
    expect(last('machine', [pt({ turnoverRate: 2.99, managementFee: 1e9, brokerageFee: 0.1e9 })]).verdict).toBe('OK')
  })

  it('biên ngưỡng tỉ lệ: đúng 0.5 → WATCH; đúng 0.8 → DANGER', () => {
    expect(last('machine', [pt({ turnoverRate: 1.0, managementFee: 1e9, brokerageFee: 0.5e9 })]).verdict).toBe('WATCH')
    expect(last('machine', [pt({ turnoverRate: 1.0, managementFee: 1e9, brokerageFee: 0.8e9 })]).verdict).toBe('DANGER')
  })

  it('thiếu turnoverRate → N/A, không phải OK', () => {
    expect(last('machine', [pt({ managementFee: 1e9, brokerageFee: 0.5e9 })]).verdict).toBe('N/A')
  })

  it('thiếu phí quản lý vẫn phán theo turnover (không N/A), turnover 7.0 → DANGER', () => {
    const r = last('machine', [pt({ turnoverRate: 7.0 })])
    expect(r.verdict).toBe('DANGER')
  })

  it('managementFee = 0 không chia-0, phán theo turnover 1.0 → OK', () => {
    const r = last('machine', [pt({ turnoverRate: 1.0, managementFee: 0, brokerageFee: 0.5e9 })])
    expect(r.verdict).toBe('OK')
  })
})

describe('D2 — Bên liên quan rút', () => {
  const series = (ownerships: number[]): RedFlagPoint[] =>
    ownerships.map((o, i) => pt({ period: `2026-${String((i % 12) + 1).padStart(2, '0')}-01`, relatedPartyOwnership: o, outstandingUnits: 1000 }))

  it('rút ~69% vị thế trong 6 tháng → DANGER (8.3% → 2.6%)', () => {
    const r = last('relatedParty', series([0.083, 0.083, 0.083, 0.083, 0.083, 0.026]))
    expect(r.verdict).toBe('DANGER')
    expect(r.keyMetric).toBeCloseTo(0.687, 2)
  })

  it('rút 40% → WATCH', () => {
    expect(last('relatedParty', series([0.1, 0.1, 0.1, 0.1, 0.1, 0.06])).verdict).toBe('WATCH')
  })

  it('vị thế ổn định → OK', () => {
    expect(last('relatedParty', series([0.08, 0.08, 0.08, 0.08, 0.08, 0.08])).verdict).toBe('OK')
  })

  it('vị thế TĂNG → OK, không phải red flag', () => {
    expect(last('relatedParty', series([0.05, 0.05, 0.05, 0.05, 0.05, 0.09])).verdict).toBe('OK')
  })

  it('biên ngưỡng: rút đúng 50% → DANGER; đúng 30% → WATCH', () => {
    expect(last('relatedParty', series([0.10, 0.10, 0.10, 0.10, 0.10, 0.05])).verdict).toBe('DANGER')
    expect(last('relatedParty', series([0.10, 0.10, 0.10, 0.10, 0.10, 0.07])).verdict).toBe('WATCH')
  })

  it('chưa đủ 6 kỳ lịch sử → N/A', () => {
    expect(last('relatedParty', series([0.08, 0.08, 0.08, 0.08, 0.08])).verdict).toBe('N/A')
  })

  it('thiếu 2282 hoặc 2281 → N/A', () => {
    const pts = [pt({ relatedPartyOwnership: null, outstandingUnits: 1000 })]
    expect(last('relatedParty', pts).verdict).toBe('N/A')
    expect(last('relatedParty', [pt({ relatedPartyOwnership: 0.08, outstandingUnits: null })]).verdict).toBe('N/A')
  })
})

describe('D3 — Rút vốn buộc bán', () => {
  it('mua lại −100 tỷ + lãi thực hiện −267 tỷ → DANGER', () => {
    const r = last('forcedSale', [pt({ redemptionFlow: -100_273_165_742, realizedGain: -267_015_523_861 })])
    expect(r.verdict).toBe('DANGER')
    expect(r.keyMetric).toBeCloseTo(100_273_165_742, 0)
  })

  it('mua lại −30 tỷ + lãi −80 tỷ → WATCH', () => {
    expect(last('forcedSale', [pt({ redemptionFlow: -30e9, realizedGain: -80e9 })]).verdict).toBe('WATCH')
  })

  it('mua lại nhỏ + lãi âm nhẹ → OK', () => {
    expect(last('forcedSale', [pt({ redemptionFlow: -10e9, realizedGain: -20e9 })]).verdict).toBe('OK')
  })

  it('biên ngưỡng: đúng 50 tỷ/−100 tỷ → DANGER; đúng 20 tỷ/−50 tỷ → WATCH', () => {
    expect(last('forcedSale', [pt({ redemptionFlow: -50e9, realizedGain: -100e9 })]).verdict).toBe('DANGER')
    expect(last('forcedSale', [pt({ redemptionFlow: -20e9, realizedGain: -50e9 })]).verdict).toBe('WATCH')
    expect(last('forcedSale', [pt({ redemptionFlow: -20e9, realizedGain: -40e9 })]).verdict).toBe('OK')
  })

  it('thiếu 2239.3.2 hoặc 2235 → N/A (kỳ trước 12/2020)', () => {
    expect(last('forcedSale', [pt({ redemptionFlow: null, realizedGain: -100e9 })]).verdict).toBe('N/A')
    expect(last('forcedSale', [pt({ redemptionFlow: -50e9, realizedGain: null })]).verdict).toBe('N/A')
  })
})

describe('D4 — Cọc tiền mặt', () => {
  it('tiền mặt 35% → DANGER', () => {
    expect(last('cashPile', [pt({ cashValue: 35e9, totalValue: 100e9 })]).verdict).toBe('DANGER')
  })

  it('21,6% → WATCH (DCDS thực tế, allocation.cashValue)', () => {
    const r = last('cashPile', [pt({ cashValue: 1_291_500_000_000, totalValue: 5_971_685_141_314 })])
    expect(r.verdict).toBe('WATCH')
    expect(r.extra).toBe('22%')
  })

  it('10% → OK', () => {
    expect(last('cashPile', [pt({ cashValue: 10e9, totalValue: 100e9 })]).verdict).toBe('OK')
  })

  it('3% → WATCH (quá căng)', () => {
    expect(last('cashPile', [pt({ cashValue: 3e9, totalValue: 100e9 })]).verdict).toBe('WATCH')
  })

  it('biên ngưỡng: 0.30 → WATCH (>0.30 mới DANGER); 0.20 → WATCH; 0.05 → WATCH', () => {
    expect(last('cashPile', [pt({ cashValue: 30e9, totalValue: 100e9 })]).verdict).toBe('WATCH')
    expect(last('cashPile', [pt({ cashValue: 20e9, totalValue: 100e9 })]).verdict).toBe('WATCH')
    expect(last('cashPile', [pt({ cashValue: 5e9, totalValue: 100e9 })]).verdict).toBe('WATCH')
  })

  it('totalValue = 0 hoặc thiếu cash → N/A (chia-0 guard)', () => {
    expect(last('cashPile', [pt({ cashValue: 10e9, totalValue: 0 })]).verdict).toBe('N/A')
    expect(last('cashPile', [pt({ cashValue: null, totalValue: 100e9 })]).verdict).toBe('N/A')
  })
})

describe('computeVerdictAt / redFlagHistory', () => {
  it('computeVerdictAt trả verdict cho điểm bất kỳ trong chuỗi', () => {
    const points = [pt({ turnoverRate: 1.0 }), pt({ turnoverRate: 6.0 })]
    expect(computeVerdictAt('machine', points, 0).verdict).toBe('OK')
    expect(computeVerdictAt('machine', points, 1).verdict).toBe('DANGER')
  })

  it('redFlagHistory trả tối đa 12 kỳ, đúng period + verdict từng kỳ', () => {
    const points = Array.from({ length: 15 }, (_, i) => pt({ period: `2026-${String(i + 1).padStart(2, '0')}-01`, turnoverRate: i >= 10 ? 6 : 1 }))
    const h = redFlagHistory('machine', points)
    expect(h).toHaveLength(12)
    expect(h[0]!.period).toBe('2026-04-01')
    expect(h[h.length - 1]!.verdict).toBe('DANGER')
    expect(h.find(x => x.period === '2026-03-01')).toBeUndefined()
  })
})
