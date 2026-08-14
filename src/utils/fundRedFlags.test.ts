import { describe, it, expect } from 'vitest'
import {
  computeVerdictAt, redFlagSummary,
  type RedFlagPoint, type RedFlagId,
} from './fundRedFlags'

function pt(over: Partial<RedFlagPoint> = {}): RedFlagPoint {
  return {
    period: '2026-07-31',
    turnoverRate: null,
    brokerageFee: null,
    managementFee: null,
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

describe('computeVerdictAt', () => {
  it('computeVerdictAt trả verdict cho điểm bất kỳ trong chuỗi', () => {
    const points = [pt({ turnoverRate: 1.0 }), pt({ turnoverRate: 6.0 })]
    expect(computeVerdictAt('machine', points, 0).verdict).toBe('OK')
    expect(computeVerdictAt('machine', points, 1).verdict).toBe('DANGER')
  })
})
