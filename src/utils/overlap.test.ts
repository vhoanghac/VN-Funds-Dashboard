import { describe, it, expect } from 'vitest'
import {
  parseHoldingsCSV,
  parseIndustryCSV,
  computeOverlap,
  computeSectorDrift,
  type Holding,
} from './overlap'

// Dữ liệu thật từ public/data/DCDS_holdings.csv (cập nhật 07/08/2026)
const DCDS_CSV = `date,stock_code,industry,weight_pct,type_asset
2026-08-07,VIC,Bất động sản,10.08,STOCK
2026-08-07,BID,Ngân hàng,7.83,STOCK
2026-08-07,MWG,Bán lẻ,6.17,STOCK
2026-08-07,VHM,Bất động sản,4.45,STOCK
2026-08-07,HPG,Vật liệu xây dựng,3.91,STOCK
2026-08-07,ACB,Ngân hàng,3.46,STOCK
2026-08-07,HDB,Ngân hàng,3.32,STOCK
2026-08-07,VPB,Ngân hàng,3.2,STOCK
2026-08-07,TCB,Ngân hàng,2.46,STOCK
2026-08-07,POW,Điện,2.02,STOCK
`

// Dữ liệu thật từ public/data/VESAF_holdings.csv
const VESAF_CSV = `date,stock_code,industry,weight_pct,type_asset
2026-08-07,BVH,Bảo hiểm,7.21,STOCK
2026-08-07,MWG,Bán lẻ,6.32,STOCK
2026-08-07,VCB,Ngân hàng,6.16,STOCK
2026-08-07,HPG,Vật liệu xây dựng,5.99,STOCK
2026-08-07,CTG,Ngân hàng,5.9,STOCK
2026-08-07,MBB,Ngân hàng,5.84,STOCK
2026-08-07,FPT,Công nghệ và thông tin,4.36,STOCK
2026-08-07,GMD,Vận tải - Kho bãi,4.0,STOCK
2026-08-07,TCB,Ngân hàng,3.85,STOCK
2026-08-07,ACB,Ngân hàng,3.81,STOCK
`

// Ngành đầy đủ của DCDS (top vài ngành, đủ để test drift)
const DCDS_INDUSTRY_CSV = `date,industry,weight_pct
2026-08-07,Ngân hàng,28.23
2026-08-07,Bất động sản,15.23
2026-08-07,Bán lẻ,6.17
2026-08-07,Vật liệu xây dựng,4.64
`

// Ngành VESAF
const VESAF_INDUSTRY_CSV = `date,industry,weight_pct
2026-08-07,Ngân hàng,25.56
2026-08-07,Bán lẻ,8.4
2026-08-07,Vật liệu xây dựng,8.26
2026-08-07,Bảo hiểm,7.21
`

describe('parseHoldingsCSV', () => {
  it('parses real DCDS holdings, latest period only, sorted kept', () => {
    const rows = parseHoldingsCSV(DCDS_CSV)
    expect(rows).toHaveLength(10)
    expect(rows[0]!.stockCode).toBe('VIC')
    expect(rows[0]!.weightPct).toBeCloseTo(10.08, 2)
    expect(rows[0]!.industry).toBe('Bất động sản')
  })

  it('ignores older periods when multiple dates present', () => {
    const csv = `date,stock_code,industry,weight_pct,type_asset
2026-07-01,VIC,Bất động sản,9.0,STOCK
2026-08-07,VIC,Bất động sản,10.08,STOCK
2026-08-07,BID,Ngân hàng,7.83,STOCK`
    const rows = parseHoldingsCSV(csv)
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.date === '2026-08-07')).toBe(true)
  })

  it('returns [] on header-only', () => {
    expect(parseHoldingsCSV('date,stock_code,industry,weight_pct,type_asset\n')).toEqual([])
  })
})

describe('parseIndustryCSV', () => {
  it('parses DCDS industries with weights', () => {
    const rows = parseIndustryCSV(DCDS_INDUSTRY_CSV)
    expect(rows).toHaveLength(4)
    expect(rows[0]!.industry).toBe('Ngân hàng')
    expect(rows[0]!.weightPct).toBeCloseTo(28.23, 2)
  })
})

describe('computeOverlap — real DCDS vs VESAF', () => {
  const a = parseHoldingsCSV(DCDS_CSV)
  const b = parseHoldingsCSV(VESAF_CSV)
  const r = computeOverlap(a, b)!

  it('computes stock counts and overlap count', () => {
    expect(r.stockCountA).toBe(10)
    expect(r.stockCountB).toBe(10)
    // Cổ phiếu chung: MWG, HPG, TCB, ACB
    expect(r.overlapCount).toBe(4)
    const codes = r.overlap.map(o => o.stockCode).sort()
    expect(codes).toEqual(['ACB', 'HPG', 'MWG', 'TCB'])
  })

  it('top overlap sorted by min(wA,wB) descending — MWG first', () => {
    expect(r.overlap[0]!.stockCode).toBe('MWG')
    expect(r.overlap[0]!.minWeight).toBeCloseTo(6.17, 2)
  })

  it('weighted overlap = Σ min(wA,wB)', () => {
    // min(MWG)=6.17 + min(HPG)=3.91 + min(TCB)=2.46 + min(ACB)=3.46 = 16.0
    expect(r.weightedOverlapPct).toBeCloseTo(16.0, 2)
  })

  it('pctInA and pctInB', () => {
    // Σ wA trùng = 6.17+3.91+2.46+3.46 = 16.0 ; Σ wA = 46.9
    expect(r.pctInA).toBeCloseTo(16.0 / 46.9, 4)
    // Σ wB trùng = 6.32+5.99+3.85+3.81 = 19.97 ; Σ wB = 53.44
    expect(r.pctInB).toBeCloseTo(19.97 / 53.44, 4)
  })

  it('overweight/underweight splits correctly', () => {
    // Với cặp này A nhẹ hơn B ở cả 4 cổ phiếu chung → overweight rỗng
    expect(r.overweightA).toHaveLength(0)
    expect(r.underweightA).toHaveLength(4)
    // Chênh âm lớn nhất: HPG (3.91−5.99 = −2.08) > TCB (−1.39)
    expect(r.underweightA[0]!.stockCode).toBe('HPG')
  })

  it('returns null when a fund has no holdings', () => {
    expect(computeOverlap([], b)).toBeNull()
    expect(computeOverlap(a, [])).toBeNull()
  })
})

describe('computeOverlap — overweight/underweight directions', () => {
  const a: Holding[] = [
    { date: '2026-08-07', stockCode: 'VIC', industry: 'BĐS', weightPct: 10 },
    { date: '2026-08-07', stockCode: 'BID', industry: 'NH', weightPct: 5 },
    { date: '2026-08-07', stockCode: 'MWG', industry: 'BL', weightPct: 3 },
    { date: '2026-08-07', stockCode: 'FPT', industry: 'CNTT', weightPct: 2 },
  ]
  const b: Holding[] = [
    { date: '2026-08-07', stockCode: 'VIC', industry: 'BĐS', weightPct: 6 },
    { date: '2026-08-07', stockCode: 'BID', industry: 'NH', weightPct: 7 },
    { date: '2026-08-07', stockCode: 'MWG', industry: 'BL', weightPct: 3 },
    { date: '2026-08-07', stockCode: 'SAB', industry: 'TP', weightPct: 8 },
  ]
  const r = computeOverlap(a, b)!

  it('overlap only includes shared codes', () => {
    expect(r.overlapCount).toBe(3)
    expect(r.overlap.map(o => o.stockCode).sort()).toEqual(['BID', 'MWG', 'VIC'])
  })

  it('overweightA = VIC (10>6); MWG equal excluded from both', () => {
    expect(r.overweightA.map(o => o.stockCode)).toEqual(['VIC'])
    expect(r.overweightA[0]!.diff).toBeCloseTo(4, 6)
  })

  it('underweightA = BID (5<7)', () => {
    expect(r.underweightA.map(o => o.stockCode)).toEqual(['BID'])
    expect(r.underweightA[0]!.diff).toBeCloseTo(-2, 6)
  })

  it('weighted overlap = min sums = 6+5+3 = 14', () => {
    expect(r.weightedOverlapPct).toBeCloseTo(14, 6)
  })
})

describe('computeSectorDrift', () => {
  const indA = parseIndustryCSV(DCDS_INDUSTRY_CSV)
  const indB = parseIndustryCSV(VESAF_INDUSTRY_CSV)
  const rows = computeSectorDrift(indA, indB)

  it('computes A−B drift for each industry', () => {
    const byName = new Map(rows.map(r => [r.industry, r]))
    // Ngân hàng: A 28.23 − B 25.56 = +2.67
    expect(byName.get('Ngân hàng')!.drift).toBeCloseTo(2.67, 2)
    // Bán lẻ: A 6.17 − B 8.4 = −2.23
    expect(byName.get('Bán lẻ')!.drift).toBeCloseTo(-2.23, 2)
    // Bảo hiểm: chỉ B có → drift = −7.21
    expect(byName.get('Bảo hiểm')!.drift).toBeCloseTo(-7.21, 2)
  })

  it('sorts by |drift| descending — Bất động sản (+15.23) first', () => {
    expect(rows[0]!.industry).toBe('Bất động sản')
  })

  it('returns empty for empty inputs', () => {
    expect(computeSectorDrift([], [])).toEqual([])
  })
})
