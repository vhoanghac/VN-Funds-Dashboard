import { describe, it, expect } from 'vitest'
import {
  parseHoldingsCSV,
  parseIndustryCSV,
  getAvailablePeriods,
  resolvePeriod,
  computeOverlap,
  computeSectorDrift,
  type Holding,
} from './overlap'

// Dữ liệu thật từ public/data/DCDS_holdings.csv — danh mục đầy đủ kỳ 2026-07-01
// (nguồn digiinvest, backfill 11/08/2026). 44 cổ phiếu.
const DCDS_CSV = `date,stock_code,industry,weight_pct,asset_value,type_asset
2026-07-01,VIC,BĐS,10.08,602177660000,STOCK
2026-07-01,BID,Ngân hàng,7.83,467400000000,STOCK
2026-07-01,MWG,Bán lẻ,6.17,368331060000,STOCK
2026-07-01,VHM,BĐS,4.45,265469250000,STOCK
2026-07-01,HPG,Vật liệu,3.91,233311412600,STOCK
2026-07-01,ACB,Ngân hàng,3.46,206584911900,STOCK
2026-07-01,HDB,Ngân hàng,3.32,198223804800,STOCK
2026-07-01,VPB,Ngân hàng,3.2,190926520000,STOCK
2026-07-01,TCB,Ngân hàng,2.46,146970465000,STOCK
2026-07-01,POW,Điện,2.02,120342320000,STOCK
2026-07-01,STB,Ngân hàng,2.0,119422760000,STOCK
2026-07-01,VPX,Chứng khoán,1.94,115867680000,STOCK
2026-07-01,GMD,Hạ tầng,1.9,113365560000,STOCK
2026-07-01,CTG,Ngân hàng,1.7,101547450000,STOCK
2026-07-01,VNM,Thực phẩm,1.61,95854536000,STOCK
2026-07-01,VCB,Ngân hàng,1.47,87911316000,STOCK
2026-07-01,DMX,Vật liệu,1.46,87204550000,STOCK
2026-07-01,VND,Chứng khoán,1.3,77735540000,STOCK
2026-07-01,ABB,Ngân hàng,1.23,73170984600,STOCK
2026-07-01,MSB,Ngân hàng,1.18,70474290000,STOCK
2026-07-01,PC1,Hạ tầng,1.15,68672520000,STOCK
2026-07-01,MSN,Thực phẩm,1.03,61510296000,STOCK
2026-07-01,BSR,Dầu khí,0.94,56147040000,STOCK
2026-07-01,DPM,Vật liệu,0.82,48997620000,STOCK
2026-07-01,CTR,Xây dựng,0.58,34645080000,STOCK
2026-07-01,TAL,BĐS,0.56,33454080000,STOCK
2026-07-01,GEL,Vật liệu,0.53,31666250000,STOCK
2026-07-01,PET,Bán lẻ,0.51,30465600000,STOCK
2026-07-01,FPT,Công nghệ,0.48,28626000000,STOCK
2026-07-01,DHC,Vật liệu,0.44,26276800000,STOCK
2026-07-01,PVD,Dầu khí,0.42,25087200000,STOCK
2026-07-01,PVS,Dầu khí,0.22,13140600000,STOCK
2026-07-01,MBB,Ngân hàng,0.21,12540000000,STOCK
2026-07-01,TVN,Xây dựng,0.2,11942000000,STOCK
2026-07-01,CII,Hạ tầng,0.15,8958000000,STOCK
2026-07-01,HVN,Vận tải,0.13,7763100000,STOCK
2026-07-01,SHB,Ngân hàng,0.13,7762300000,STOCK
2026-07-01,TCX,Chứng khoán,0.13,7760300000,STOCK
2026-07-01,DRI,Sản phẩm cao su,0.08,4777700000,STOCK
2026-07-01,NVL,BĐS,0.08,4777400000,STOCK
2026-07-01,DPG,Xây dựng,0.07,4180600000,STOCK
2026-07-01,DXS,BĐS,0.06,3583500000,STOCK
2026-07-01,OCB,Ngân hàng,0.04,2389000000,STOCK
2026-07-01,HHS,Ô tô,0.03,1791600000,STOCK
`

// Dữ liệu thật từ public/data/VESAF_holdings.csv — danh mục đầy đủ kỳ 2026-07-01.
// 30 cổ phiếu.
const VESAF_CSV = `date,stock_code,industry,weight_pct,asset_value,type_asset
2026-07-01,BVH,Bảo hiểm,7.21,40000000000,STOCK
2026-07-01,MWG,Bán lẻ,6.32,35000000000,STOCK
2026-07-01,VCB,Ngân hàng,6.16,34000000000,STOCK
2026-07-01,HPG,Vật liệu,5.99,33000000000,STOCK
2026-07-01,CTG,Ngân hàng,5.9,32000000000,STOCK
2026-07-01,MBB,Ngân hàng,5.84,31000000000,STOCK
2026-07-01,FPT,Công nghệ,4.36,30000000000,STOCK
2026-07-01,GMD,Hạ tầng,4.0,29000000000,STOCK
2026-07-01,TCB,Ngân hàng,3.85,28000000000,STOCK
2026-07-01,ACB,Ngân hàng,3.81,27000000000,STOCK
2026-07-01,CTR,Xây dựng,3.74,26000000000,STOCK
2026-07-01,VRE,BĐS,3.73,25000000000,STOCK
2026-07-01,IDC,BĐS,3.4,24000000000,STOCK
2026-07-01,REE,Hạ tầng,3.15,23000000000,STOCK
2026-07-01,GAS,Dầu khí,2.88,22000000000,STOCK
2026-07-01,PVS,Dầu khí,2.71,21000000000,STOCK
2026-07-01,VHC,Thực phẩm,2.34,20000000000,STOCK
2026-07-01,HT1,Vật liệu,2.27,19000000000,STOCK
2026-07-01,DMX,Vật liệu,2.11,18000000000,STOCK
2026-07-01,FRT,Bán lẻ,2.08,17000000000,STOCK
2026-07-01,TLG,Dịch vụ,1.94,16000000000,STOCK
2026-07-01,SSI,Chứng khoán,1.67,15000000000,STOCK
2026-07-01,ITC,BĐS,1.37,14000000000,STOCK
2026-07-01,VCI,Chứng khoán,1.21,13000000000,STOCK
2026-07-01,TTN,Viễn thông,1.19,12000000000,STOCK
2026-07-01,VND,Chứng khoán,1.18,11000000000,STOCK
2026-07-01,TCX,Chứng khoán,0.84,10000000000,STOCK
2026-07-01,MIG,Bảo hiểm,0.42,9000000000,STOCK
2026-07-01,PVT,Dầu khí,0.24,8000000000,STOCK
2026-07-01,DHC,Vật liệu,0.19,7000000000,STOCK
`

// Ngành đầy đủ của DCDS kỳ 2026-07-01 (tổng theo cổ phiếu từ danh mục đầy đủ)
const DCDS_INDUSTRY_CSV = `date,industry,weight_pct
2026-07-01,Ngân hàng,28.23
2026-07-01,BĐS,15.23
2026-07-01,Vật liệu,7.16
2026-07-01,Bán lẻ,6.68
2026-07-01,Chứng khoán,3.37
2026-07-01,Hạ tầng,3.2
2026-07-01,Thực phẩm,2.64
2026-07-01,Điện,2.02
2026-07-01,Dầu khí,1.58
2026-07-01,Xây dựng,0.85
2026-07-01,Công nghệ,0.48
2026-07-01,Vận tải,0.13
2026-07-01,Sản phẩm cao su,0.08
2026-07-01,Ô tô,0.03
`

// Ngành VESAF kỳ 2026-07-01
const VESAF_INDUSTRY_CSV = `date,industry,weight_pct
2026-07-01,Ngân hàng,25.56
2026-07-01,Vật liệu,10.56
2026-07-01,BĐS,8.5
2026-07-01,Bán lẻ,8.4
2026-07-01,Bảo hiểm,7.63
2026-07-01,Hạ tầng,7.15
2026-07-01,Dầu khí,5.83
2026-07-01,Chứng khoán,4.9
2026-07-01,Công nghệ,4.36
2026-07-01,Xây dựng,3.74
2026-07-01,Thực phẩm,2.34
2026-07-01,Dịch vụ,1.94
2026-07-01,Viễn thông,1.19
`

describe('parseHoldingsCSV', () => {
  it('parses real DCDS holdings, latest period only, sorted kept', () => {
    const rows = parseHoldingsCSV(DCDS_CSV)
    expect(rows).toHaveLength(44)
    expect(rows[0]!.stockCode).toBe('VIC')
    expect(rows[0]!.weightPct).toBeCloseTo(10.08, 2)
    expect(rows[0]!.industry).toBe('BĐS')
    expect(rows[0]!.assetValue).toBe(602177660000)
  })

  it('parses legacy CSV without asset_value as 0', () => {
    const csv = `date,stock_code,industry,weight_pct,type_asset
2026-07-01,VIC,BĐS,10.08,STOCK`
    const rows = parseHoldingsCSV(csv)
    expect(rows[0]!.assetValue).toBe(0)
  })

  it('ignores older periods when multiple dates present', () => {
    const csv = `date,stock_code,industry,weight_pct,type_asset
2026-06-01,VIC,BĐS,9.0,STOCK
2026-07-01,VIC,BĐS,10.08,STOCK
2026-07-01,BID,Ngân hàng,7.83,STOCK`
    const rows = parseHoldingsCSV(csv)
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.date === '2026-07-01')).toBe(true)
  })

  it('targetPeriod selects an earlier specific period', () => {
    const csv = `date,stock_code,industry,weight_pct,type_asset
2026-05-01,VIC,BĐS,8.0,STOCK
2026-06-01,VIC,BĐS,9.0,STOCK
2026-06-01,BID,Ngân hàng,7.0,STOCK
2026-07-01,VIC,BĐS,10.08,STOCK`
    const rows = parseHoldingsCSV(csv, '2026-06-01')
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.date === '2026-06-01')).toBe(true)
    expect(rows[0]!.weightPct).toBeCloseTo(9.0, 2)
  })

  it('targetPeriod with no exact match falls back to nearest earlier period', () => {
    const csv = `date,stock_code,industry,weight_pct,type_asset
2026-06-01,VIC,BĐS,9.0,STOCK
2026-07-01,VIC,BĐS,10.08,STOCK`
    // Chọn kỳ chưa tồn tại 08-01 → rơi về 07-01
    const rows = parseHoldingsCSV(csv, '2026-08-01')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.date).toBe('2026-07-01')
    // Chọn 08-30 (chưa có) → rơi về 07-01
    const rows2 = parseHoldingsCSV(csv, '2026-08-30')
    expect(rows2).toHaveLength(1)
    expect(rows2[0]!.date).toBe('2026-07-01')
  })

  it('returns [] on header-only', () => {
    expect(parseHoldingsCSV('date,stock_code,industry,weight_pct,type_asset\n')).toEqual([])
  })
})

describe('getAvailablePeriods / resolvePeriod', () => {
  const csv = `date,stock_code,industry,weight_pct,type_asset
2026-06-01,VIC,BĐS,8.0,STOCK
2026-07-01,VIC,BĐS,9.0,STOCK
2026-08-07,VIC,BĐS,10.08,STOCK`

  it('lists distinct periods sorted descending', () => {
    expect(getAvailablePeriods(csv)).toEqual(['2026-08-07', '2026-07-01', '2026-06-01'])
  })

  it('resolvePeriod: null → latest; exact target → that period; missing → nearest earlier', () => {
    expect(resolvePeriod(getAvailablePeriods(csv), null)).toBe('2026-08-07')
    expect(resolvePeriod(getAvailablePeriods(csv), '2026-07-01')).toBe('2026-07-01')
    // Chọn 08-30 (chưa tồn tại) → rơi về 08-07
    expect(resolvePeriod(getAvailablePeriods(csv), '2026-08-30')).toBe('2026-08-07')
    // Target sớm hơn mọi kỳ → kỳ sớm nhất
    expect(resolvePeriod(getAvailablePeriods(csv), '2026-01-01')).toBe('2026-06-01')
  })

  it('returns [] / "" for empty input', () => {
    expect(getAvailablePeriods('')).toEqual([])
    expect(resolvePeriod([], null)).toBe('')
  })
})

describe('parseIndustryCSV', () => {
  it('parses DCDS industries with weights', () => {
    const rows = parseIndustryCSV(DCDS_INDUSTRY_CSV)
    expect(rows).toHaveLength(14)
    expect(rows[0]!.industry).toBe('Ngân hàng')
    expect(rows[0]!.weightPct).toBeCloseTo(28.23, 2)
  })

  it('returns only the latest period when multiple report periods present', () => {
    const csv = `date,industry,weight_pct
2026-06-01,Ngân hàng,26.0
2026-06-01,Bán lẻ,5.0
2026-07-01,Ngân hàng,28.23
2026-07-01,BĐS,15.23`
    const rows = parseIndustryCSV(csv)
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.date === '2026-07-01')).toBe(true)
    expect(rows[0]!.weightPct).toBeCloseTo(28.23, 2)
  })
})

describe('computeOverlap — real DCDS vs VESAF', () => {
  const a = parseHoldingsCSV(DCDS_CSV)
  const b = parseHoldingsCSV(VESAF_CSV)
  const r = computeOverlap(a, b)!

  it('computes stock counts and overlap count', () => {
    expect(r.stockCountA).toBe(44)
    expect(r.stockCountB).toBe(30)
    // Cổ phiếu chung: ACB, CTG, CTR, DHC, DMX, FPT, GMD, HPG, MBB, MWG, PVS,
    // TCB, TCX, VCB, VND
    expect(r.overlapCount).toBe(15)
    const codes = r.overlap.map(o => o.stockCode).sort()
    expect(codes).toEqual(['ACB', 'CTG', 'CTR', 'DHC', 'DMX', 'FPT', 'GMD', 'HPG', 'MBB', 'MWG', 'PVS', 'TCB', 'TCX', 'VCB', 'VND'])
  })

  it('top overlap sorted by min(wA,wB) descending — MWG first', () => {
    expect(r.overlap[0]!.stockCode).toBe('MWG')
    expect(r.overlap[0]!.minWeight).toBeCloseTo(6.17, 2)
  })

  it('weighted overlap = Σ min(wA,wB)', () => {
    // Tính từ dữ liệu thật: 25.52
    expect(r.weightedOverlapPct).toBeCloseTo(25.52, 2)
  })

  it('pctInA and pctInB', () => {
    // Σ wA trùng = 25.89 ; Σ wA = 71.68
    expect(r.pctInA).toBeCloseTo(25.89 / 71.68, 4)
    // Σ wB trùng = 57.0 ; Σ wB = 92.1
    expect(r.pctInB).toBeCloseTo(57.0 / 92.1, 4)
  })

  it('overlapInA/overlapInB are absolute NAV pct of overlapping stocks', () => {
    // Σ wA cổ phiếu trùng = 25.89 (điểm % NAV)
    expect(r.overlapInA).toBeCloseTo(25.89, 4)
    // Σ wB cổ phiếu trùng = 57.0
    expect(r.overlapInB).toBeCloseTo(57.0, 4)
  })

  it('overweight/underweight splits correctly', () => {
    // A nhẹ hơn B ở hầu hết cổ phiếu chung; DHC và VND A nặng hơn
    expect(r.overweightA.map(o => o.stockCode).sort()).toEqual(['DHC', 'VND'])
    expect(r.underweightA).toHaveLength(13)
    // Chênh âm lớn nhất: MBB (0.21−5.84 = −5.63)
    expect(r.underweightA[0]!.stockCode).toBe('MBB')
    expect(r.underweightA[0]!.diff).toBeCloseTo(-5.63, 2)
  })

  it('returns null when a fund has no holdings', () => {
    expect(computeOverlap([], b)).toBeNull()
    expect(computeOverlap(a, [])).toBeNull()
  })
})

describe('computeOverlap — overweight/underweight directions', () => {
  const a: Holding[] = [
    { date: '2026-07-01', stockCode: 'VIC', industry: 'BĐS', weightPct: 10, assetValue: 0, type: 'STOCK' },
    { date: '2026-07-01', stockCode: 'BID', industry: 'NH', weightPct: 5, assetValue: 0, type: 'STOCK' },
    { date: '2026-07-01', stockCode: 'MWG', industry: 'BL', weightPct: 3, assetValue: 0, type: 'STOCK' },
    { date: '2026-07-01', stockCode: 'FPT', industry: 'CNTT', weightPct: 2, assetValue: 0, type: 'STOCK' },
  ]
  const b: Holding[] = [
    { date: '2026-07-01', stockCode: 'VIC', industry: 'BĐS', weightPct: 6, assetValue: 0, type: 'STOCK' },
    { date: '2026-07-01', stockCode: 'BID', industry: 'NH', weightPct: 7, assetValue: 0, type: 'STOCK' },
    { date: '2026-07-01', stockCode: 'MWG', industry: 'BL', weightPct: 3, assetValue: 0, type: 'STOCK' },
    { date: '2026-07-01', stockCode: 'SAB', industry: 'TP', weightPct: 8, assetValue: 0, type: 'STOCK' },
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
    // Bán lẻ: A 6.68 − B 8.4 = −1.72
    expect(byName.get('Bán lẻ')!.drift).toBeCloseTo(-1.72, 2)
    // Bảo hiểm: chỉ B có → drift = −7.63
    expect(byName.get('Bảo hiểm')!.drift).toBeCloseTo(-7.63, 2)
  })

  it('sorts by |drift| descending — Bảo hiểm (−7.63) first', () => {
    // |−7.63| (chỉ B có) lớn nhất; BĐS +6.73 đứng sau
    expect(rows[0]!.industry).toBe('Bảo hiểm')
    expect(rows[0]!.drift).toBeCloseTo(-7.63, 2)
    expect(rows[1]!.industry).toBe('BĐS')
    expect(rows[1]!.drift).toBeCloseTo(6.73, 2)
  })

  it('returns empty for empty inputs', () => {
    expect(computeSectorDrift([], [])).toEqual([])
  })
})
