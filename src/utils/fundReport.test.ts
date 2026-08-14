import { describe, it, expect } from 'vitest'
import {
  parseTidyPortfolio,
  parseTidyAssets,
  parseTidyIncome,
  parseTidyIndicators,
  fundReportPeriods,
  resolveReportPeriod,
} from './fundReport'

// Dữ liệu thật từ public/data/DCDS/tidied/tidy_portfolio.csv — toàn bộ kỳ
// 2026-07-31 (nguồn báo cáo Thông tư 98/2020 của DCDS). Golden test: nếu số
// này lệch là pipeline báo cáo hoặc parser hỏng, không được sửa thầm.
const PORTFOLIO_2026_07 = `period_end,section,code,ticker,quantity,market_price,value,weight,asOf
2026-07-31,REAL ESTATE INVESTMENT (NOT APPLICABLE),,,,,,,2026-08-03
2026-07-31,REAL ESTATE INVESTMENT (NOT APPLICABLE),2264,,,,,,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246,,,,,,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.1,ABB,4205229,17400,73170984600,0.0122529877025465,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.2,ACB,9433101,21900,206584911900,0.0345940730315436,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.3,BID,12300000,38000,467400000000,0.0782693643317494,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.4,BSR,2219700,25350,56269395000,0.00942269956778374,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.5,CII,680000,13100,8908000000,0.00149170624190677,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.6,CTG,3303905,30800,101760274000,0.0170404620457951,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.7,CTR,478820,71900,34427158000,0.00576506583741699,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.8,DHC,802860,32900,26414094000,0.00442322282152134,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.9,DMX,1090000,80000,87200000000,0.0146022434097744,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.10,DPG,140200,27700,3883540000,0.000650325646463248,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.11,DPM,2077200,23550,48918060000,0.00819166765199482,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.12,DRI,379400,12900,4894260000,0.000819577704480762,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.13,DXS,630000,5750,3622500000,0.000606612692109034,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.14,FPT,426800,67100,28638280000,0.00479567815822562,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.15,GEL,1222900,25900,31673110000,0.00530388144225412,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.16,GMD,1474300,77000,113521100000,0.0190098937424924,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.17,HDB,7866024,25200,198223804800,0.0331939477901514,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.18,HHS,191200,9520,1820224000,0.000304809104453133,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.19,HPG,10751678,21700,233311412600,0.0390696105167833,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.20,HVN,364631,21500,7839566500,0.00131278965894625,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.21,MBB,559300,22500,12584250000,0.00210731974345703,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.22,MSB,4433000,15950,70706350000,0.0118402675839071,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.23,MSN,932400,66100,61631640000,0.0103206445988944,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.24,MWG,5269400,69900,368331060000,0.0616795847878465,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.25,NVL,388600,13000,5051800000,0.000845958867631861,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.26,OCB,221520,10150,2248428000,0.000376514827354957,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.27,PC1,3200200,21400,68484280000,0.0114681665860452,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.28,PET,804690,38000,30578220000,0.00512053453529394,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.29,POW,8848700,13600,120342320000,0.020152154233222,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.30,PVD,1372136,18150,24904268400,0.0041703920770545,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.31,PVS,390200,34100,13305820000,0.00222815163310372,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.32,SHB,682546,11500,7849279000,0.00131441608428017,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.33,STB,1675300,71300,119448890000,0.0200025431973322,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.34,TAL,1516220,22250,33735895000,0.0056493090646398,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.35,TCB,5076700,28950,146970465000,0.0246112213758914,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.36,TCX,189000,41000,7749000000,0.00129762367181585,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.37,TVN,1364000,8700,11866800000,0.00198717777632008,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.38,VCB,1477600,59300,87621680000,0.0146728566437312,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.39,VHM,1792500,148100,265469250000,0.0444546629164019,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.40,VIC,2812600,214100,602177660000,0.100838816138169,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.41,VND,4668000,16600,77488800000,0.0129760357698547,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.42,VNM,1574600,60900,95893140000,0.016057969857885,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.43,VPB,7698650,24800,190926520000,0.0319719669543711,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2246.44,VPX,4556400,25400,115732560000,0.0193802180224349,2026-08-03
2026-07-31,"SHARES LISTED, SHARES REGISTERED FOR TRADING, LISTED FUND CERTIFICATES",2247,,,,4279579050800,0.716645126045331,2026-08-03
2026-07-31,"SHARES UNLISTED, UNREGISTERED FOR TRADING, UNLISTED FUND CERTIFICATES",2248,,,,,,2026-08-03
2026-07-31,"SHARES UNLISTED, UNREGISTERED FOR TRADING, UNLISTED FUND CERTIFICATES",2249,,,,0,0,2026-08-03
2026-07-31,BONDS,2251,,,,,,2026-08-03
2026-07-31,BONDS,2251.1,Listed bonds,,,0,0,2026-08-03
2026-07-31,BONDS,2251.2,"Unlisted Bonds, Private placement bonds",,,53382400000,0.00893925227749932,2026-08-03
2026-07-31,BONDS,2251.2.1,CII425002 HCMC JSC UNL BOND 25/06/41,533824,100000,53382400000,0.00893925227749932,2026-08-03
2026-07-31,BONDS,2252,,,,53382400000,0.00893925227749932,2026-08-03
2026-07-31,OTHER SECURITIES,2253,,,,,,2026-08-03
2026-07-31,OTHER SECURITIES,2253.1,Investment - Rights,,,0,0,2026-08-03
2026-07-31,OTHER SECURITIES,2253.2,Index future contracts,,,0,0,2026-08-03
2026-07-31,OTHER SECURITIES,2254,,,,0,0,2026-08-03
2026-07-31,OTHER SECURITIES,2255,,,,4332961450800,0.72558437832283,2026-08-03
2026-07-31,OTHER ASSETS,2256,,,,,,2026-08-03
2026-07-31,OTHER ASSETS,2256.1,Dividend receivables,,,12752927250,0.00213556591618859,2026-08-03
2026-07-31,OTHER ASSETS,2256.2,Coupon receivables,,,541136658,9.06170779594935e-05,2026-08-03
2026-07-31,OTHER ASSETS,2256.3,Interest receivables from bank deposits and Money market instruments,,,546000001,9.14314783983837e-05,2026-08-03
2026-07-31,OTHER ASSETS,2256.4,Outstanding Settlement of sales transactions,,,334210198000,0.0559658103351479,2026-08-03
2026-07-31,OTHER ASSETS,2256.5,Receivable from AP/Investors on securities on hold of buying,,,0,0,2026-08-03
2026-07-31,OTHER ASSETS,2256.6,Other receivables,,,-866400000,-0.000145084675346657,2026-08-03
2026-07-31,OTHER ASSETS,2256.7,Other assets,,,0,0,2026-08-03
2026-07-31,OTHER ASSETS,2257,,,,347183861909,0.0581383401323477,2026-08-03
2026-07-31,CASH,2258,,,,,,2026-08-03
2026-07-31,CASH,2259,"Cash, Cash Equivalent",,,1191539828610,0.199531589561973,2026-08-03
2026-07-31,CASH,2259.1,Cash at Bank,,,1003539828610,0.168049688632643,2026-08-03
2026-07-31,CASH,2259.2,Cash Equivalents,,,188000000000,0.0314819009293301,2026-08-03
2026-07-31,CASH,2260,Deposits with term over three (03) months,,,0,0,2026-08-03
2026-07-31,CASH,2261.1,Money market instruments,,,99999999995,0.0167456919828489,2026-08-03
2026-07-31,CASH,2262,,,,1291539828605,0.216277281544822,2026-08-03
2026-07-31,Total value of portfolio,2263,,,,5971685141314,1,2026-08-03
`

const ASSETS_2026_07 = `code,line_item,period_end,value,asOf
2212,TOTAL ASSETS,2026-07-31,5971685141314,2026-08-03
2213,LIABILITIES,2026-07-31,,2026-08-03
2216,TOTAL LIABILITIES,2026-07-31,248340233630,2026-08-03
2217,Net Asset Value ( = I.10 - II.4),2026-07-31,5723344907684,2026-08-03
2219,Net Asset Value per Fund Certificate,2026-07-31,92966.74,2026-08-03
2208,Securities Trading Receivables,2026-07-31,334210198000,2026-08-03
2203,Cash at Bank,2026-07-31,1191539828610,2026-08-03
2203.1,Cash at bank for Fund's subscription,2026-07-31,160831598740,2026-08-03
2203.2,Cash at bank for Fund's redemption,2026-07-31,31974822870,2026-08-03
2203.3,Cash at bank for Fund's operation,2026-07-31,998762008680,2026-08-03
2203.4,Margin account for trading derivatives,2026-07-31,0,2026-08-03
`

describe('parseTidyPortfolio', () => {
  const portfolio = parseTidyPortfolio(PORTFOLIO_2026_07)

  it('nhận đúng 1 kỳ hợp lệ (bỏ dòng REAL ESTATE / subtotal / junk)', () => {
    expect([...portfolio.keys()]).toEqual(['2026-07-31'])
  })

  it('đếm đúng số cổ phiếu (44 listed, không đếm subtotal/UNLISTED rỗng)', () => {
    const p = portfolio.get('2026-07-31')!
    expect(p.stocks.length).toBe(44)
  })

  it('xếp cổ phiếu giảm theo tỷ trọng, top 1 là VIC 10.08%', () => {
    const p = portfolio.get('2026-07-31')!
    expect(p.stocks[0]!.ticker).toBe('VIC')
    expect(p.stocks[0]!.weightPct).toBeCloseTo(10.08, 2)
    expect(p.stocks[0]!.quantity).toBe(2812600)
    expect(p.stocks[0]!.value).toBe(602177660000)
  })

  it('BOND/CASH/OTHER chỉ gom dòng tổng ticker rỗng, không đếm dòng con có nhãn', () => {
    const a = portfolio.get('2026-07-31')!.allocation
    expect(a.bondValue).toBe(53382400000)
    expect(a.cashValue).toBe(1291539828605)
    expect(a.otherValue).toBe(347183861909)
  })

  it('loại grand-total OTHER SECURITIES (weight > 0.5)', () => {
    // 2255 = 4.332.961 tỷ phải KHÔNG vào otherValue (chỉ 347,2 tỷ tài sản khác).
    const a = portfolio.get('2026-07-31')!.allocation
    expect(a.otherValue).toBeLessThan(1_000_000_000_000)
  })

  it('tổng 4 loại = tổng tài sản báo cáo (5.971.685.141.314)', () => {
    const a = portfolio.get('2026-07-31')!.allocation
    expect(a.totalValue).toBe(5971685141314)
    expect(a.stockValue).toBe(4279579050800)
  })

  it('bỏ dòng rác cuối file (kỳ không hợp lệ) và dòng thiếu weight', () => {
    const junk = PORTFOLIO_2026_07 + '\nTransferable instruments garbage line\n'
    const withJunk = parseTidyPortfolio(junk)
    expect([...withJunk.keys()]).toEqual(['2026-07-31'])
  })

  it('chuẩn hoá ticker cổ phiếu unlisted (tên dài → mã 3 ký tự)', () => {
    // Báo cáo 06/2026 xếp DMX vào mục UNLISTED với tên công ty dài — parser
    // phải trả về DMX (khớp TICKER_ALIAS pipeline), không phải tên dài.
    const unlisted = `period_end,section,code,ticker,quantity,market_price,value,weight,asOf
2026-06-30,"SHARES UNLISTED, UNREGISTERED FOR TRADING, UNLISTED FUND CERTIFICATES",2248.1,Dien May Xanh Investment Joint Stock Co.,1090000,80000,87200000000,0.013620621452305,2026-07-02
2026-06-30,"SHARES UNLISTED, UNREGISTERED FOR TRADING, UNLISTED FUND CERTIFICATES",2248.2,TECHCOM SECURITIES JOINT STOCK COMPANY,100000,50000,5000000000,0.001,2026-07-02
2026-06-30,Total value of portfolio,2263,,,,92200000000,1,2026-07-02
`
    const p = parseTidyPortfolio(unlisted).get('2026-06-30')!
    const dmx = p.stocks.find(s => s.ticker === 'DMX')
    expect(dmx?.value).toBe(87200000000)
    // TECHCOM không có alias — giữ tên dài (đồng bộ pipeline, VPS bị collision).
    expect(p.stocks.find(s => s.ticker === 'TECHCOM SECURITIES JOINT STOCK COMPANY')).toBeTruthy()
  })
})

describe('parseTidyAssets', () => {
  const assets = parseTidyAssets(ASSETS_2026_07)

  it('đọc tổng tài sản / nợ / NAV / NAV mỗi CCQ', () => {
    const s = assets.get('2026-07-31')!
    expect(s.totalAssets).toBe(5971685141314)
    expect(s.liabilities).toBe(248340233630)
    expect(s.nav).toBe(5723344907684)
    expect(s.navPerUnit).toBe(92966.74)
  })

  it('bỏ dòng không có giá trị (2213 LIABILITIES tổng không điền)', () => {
    const s = assets.get('2026-07-31')!
    expect(s.liabilities).toBe(248340233630)
  })

  it('đọc phải thu từ bán chứng khoán chưa về (2208)', () => {
    const s = assets.get('2026-07-31')!
    expect(s.settlementReceivables).toBe(334210198000)
  })

  it('đọc tiền gửi ngân hàng (2203), dùng dòng tổng không phải mục con', () => {
    const s = assets.get('2026-07-31')!
    expect(s.cashAtBank).toBe(1191539828610)
  })
})

const INCOME_2026_07 = `code,line_item,period_end,measure,value,asOf
2220,Income from Investment Activities,2026-07-31,month,18198439421,2026-08-03
2220,Income from Investment Activities,2026-07-31,ytd,78493402529,2026-08-03
2224,Expenses,2026-07-31,month,16457794144,2026-08-03
2224,Expenses,2026-07-31,ytd,119475429021,2026-08-03
2221.1,Dividends income,2026-07-31,month,16994377250,2026-08-03
2222,Interest income,2026-07-31,month,662925513,2026-08-03
2225,Management Fee paid to Fund Management Company,2026-07-31,month,9658563413,2026-08-03
2231,Expenses related to execution of Fund asset transactions,2026-07-31,month,6428700000,2026-08-03
2235,Realised Gain/(Loss) from disposal of investment,2026-07-31,month,-267000000000,2026-08-03
2236,Unrealised Gain/(Loss) due to market price,2026-07-31,month,-201600000000,2026-08-03
2237,Change of NAV due to investment activities,2026-07-31,month,-466800000000,2026-08-03
2239.3,Change of NAV due to subscription/redemption,2026-07-31,month,119436724650,2026-08-03
2239.3.1,Change of NAV due to subscription during the period,2026-07-31,month,219709890392,2026-08-03
2239.3.2,Change of NAV due to redemption during the period,2026-07-31,month,-100273165742,2026-08-03
`

const INDICATORS_2026_07 = `code,line_item,period_end,measure,value,asOf
2277,Number of Fund Certificates subscribed during the period,2026-07-31,month,2303883.97,2026-08-03
22781,Number of Fund Certificates redeemed during the period,2026-07-31,month,-1045212.25,2026-08-03
2281,Total number of outstanding Fund Certificate at the end of the period,2026-07-31,month,61563355,2026-08-03
2270,Portfolio turnover rate (%),2026-07-31,month,6.83990677817426,2026-08-03
22841,Number of investors of the Fund at the end of the period,2026-07-31,month,74212,2026-08-03
2265,Management fee paid to the fund management company/Average NAV (%),2026-07-31,month,0.0195019586247306,2026-08-03
2269,Expense/Average NAV (%),2026-07-31,month,0.0209987443942776,2026-08-03
2282,Fund Management Company and related parties' ownership ratio,2026-07-31,month,0.0151,2026-08-03
2283,Top 10 investors' ownership ratio,2026-07-31,month,0.0857,2026-08-03
2284,Foreign investors' ownership ratio,2026-07-31,month,0.0891,2026-08-03
`

describe('parseTidyIncome', () => {
  const income = parseTidyIncome(INCOME_2026_07)

  it('lấy giá trị tháng (bỏ ytd), thu nhập ròng hoạt động = income − expenses', () => {
    const s = income.get('2026-07-31')!
    expect(s.income).toBe(18198439421)
    expect(s.expenses).toBe(16457794144)
    expect(s.netProfit).toBe(1740645277)
  })

  it('đọc cổ tức / phí / lãi-lỗ thực hiện & chưa thực hiện', () => {
    const s = income.get('2026-07-31')!
    expect(s.dividends).toBe(16994377250)
    expect(s.interestIncome).toBe(662925513)
    expect(s.managementFee).toBe(9658563413)
    expect(s.brokerageFee).toBe(6428700000)
    expect(s.realizedGain).toBe(-267000000000)
    expect(s.unrealizedGain).toBe(-201600000000)
  })

  it('bỏ dòng placeholder "(not applicable)" — không để 0 đè phí giao dịch 2231', () => {
    // Era 2025+: code 2231 xuất hiện 2 lần — dòng thật rồi dòng "not applicable"=0.
    // Nếu không lọc, last-wins sẽ reset brokerageFee về 0.
    const dup = `code,line_item,period_end,measure,value,asOf
2231,Expenses related to execution of Fund's asset transactions,2026-07-31,month,6057930816,2026-08-03
2231,Real Estate Management Service fee (not applicable),2026-07-31,month,0,2026-08-03
`
    const s = parseTidyIncome(dup).get('2026-07-31')!
    expect(s.brokerageFee).toBe(6057930816)
  })

  it('lợi nhuận THẬT (2237) là con số độc lập, khác netProfit', () => {
    const s = income.get('2026-07-31')!
    expect(s.investmentProfit).toBe(-466800000000)
    // 2237 ≈ netProfit + realized + unrealized (lệch < 100 triệu do báo cáo làm tròn)
    const sum = s.netProfit + s.realizedGain + s.unrealizedGain
    expect(Math.abs(s.investmentProfit - sum)).toBeLessThan(100_000_000)
  })

  it('đọc thay đổi NAV do dòng tiền mua/bán CCQ (2239.3)', () => {
    const s = income.get('2026-07-31')!
    expect(s.navChangeByFlow).toBe(119436724650)
  })

  it('tách riêng phát hành (2239.3.1, dương) và mua lại (2239.3.2, âm)', () => {
    const s = income.get('2026-07-31')!
    expect(s.subscriptionFlow).toBe(219709890392)
    expect(s.redemptionFlow).toBe(-100273165742)
    expect(s.subscriptionFlow + s.redemptionFlow).toBe(s.navChangeByFlow)
  })

  it('fallback: kỳ thiếu 2237 thì tính từ netProfit + realized + unrealized', () => {
    const no2237 = INCOME_2026_07.replace('2237,Change of NAV due to investment activities,2026-07-31,month,-466800000000,2026-08-03\n', '')
    const s = parseTidyIncome(no2237).get('2026-07-31')!
    expect(s.investmentProfit).toBe(1740645277 - 267000000000 - 201600000000)
  })
})

describe('parseTidyIndicators', () => {
  const flow = parseTidyIndicators(INDICATORS_2026_07)

  it('đọc số CCQ mua/bán, netUnits = mua + bán (bán âm)', () => {
    const s = flow.get('2026-07-31')!
    expect(s.subscribedUnits).toBe(2303883.97)
    expect(s.redeemedUnits).toBe(-1045212.25)
    expect(s.netUnits).toBeCloseTo(1258671.72, 2)
  })

  it('đọc quy mô + chỉ số: CCQ lưu hành, turnover, nhà đầu tư, phí/NAV', () => {
    const s = flow.get('2026-07-31')!
    expect(s.outstandingUnits).toBe(61563355)
    expect(s.turnoverRate).toBeCloseTo(6.8399, 4)
    expect(s.investorCount).toBe(74212)
    expect(s.mgmtFeeRatio).toBeCloseTo(0.01950, 4)
    expect(s.expenseRatio).toBeCloseTo(0.02099, 4)
  })

  it('đọc tỷ lệ sở hữu: công ty quản lý + bên liên quan (2282), top 10 (2283), nước ngoài (2284)', () => {
    const s = flow.get('2026-07-31')!
    expect(s.relatedPartyOwnership).toBeCloseTo(0.0151, 4)
    expect(s.top10Ownership).toBeCloseTo(0.0857, 4)
    expect(s.foreignOwnership).toBeCloseTo(0.0891, 4)
  })
})

describe('fundReportPeriods / resolveReportPeriod', () => {
  const portfolio = parseTidyPortfolio(PORTFOLIO_2026_07)

  it('liệt kê kỳ giảm dần', () => {
    expect(fundReportPeriods(portfolio)).toEqual(['2026-07-31'])
  })

  it('resolve: null → mới nhất; target có trong list → đúng target; sớm hơn → kỳ sớm nhất', () => {
    const periods = ['2026-01-31', '2026-03-31', '2026-07-31']
    expect(resolveReportPeriod(periods, null)).toBe('2026-07-31')
    expect(resolveReportPeriod(periods, '2026-03-31')).toBe('2026-03-31')
    expect(resolveReportPeriod(periods, '2026-02-28')).toBe('2026-01-31')
    expect(resolveReportPeriod(periods, '2025-01-31')).toBe('2026-01-31')
    expect(resolveReportPeriod([], '2026-01-31')).toBeNull()
  })
})
