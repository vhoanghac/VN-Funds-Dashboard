import Papa from 'papaparse'

/**
 * Phân tích báo cáo tài chính tháng của quỹ (Thông tư 98/2020/TT-BTC) đã được
 * chuyển sang dạng tidy CSV. Tab "Phân Tích Quỹ" đọc trực tiếp:
 *   public/data/<FUND>/tidied/tidy_portfolio.csv  (danh mục đầu tư)
 *   public/data/<FUND>/tidied/tidy_assets.csv     (tổng tài sản, NAV)
 *
 * Lõi thuần TS (papaparse là util không-React), không import React/Recharts —
 * đúng ranh giới core purity. Quy tắc gom loại tài sản PHẢI khớp pipeline
 * scripts/fund_report/fund_reports_to_holdings.py, không được lệch:
 *   - Cổ phiếu = section chứa SHARES/EQUITY/FUND CERTIFICATES + ticker không rỗng
 *     (ticker 3 ký tự, hoặc section UNLISTED giữ tên công ty dài). Dòng tổng phụ
 *     (subtotal) có ticker rỗng → không phải cổ phiếu.
 *   - BOND/CASH/OTHER = dòng TỔNG của section (ticker rỗng). Các dòng con (vd
 *     2259 "Cash, Cash Equivalent") có ticker là nhãn → bị loại bởi `!ticker`.
 *   - Section OTHER SECURITIES có dòng grand-total (weight > 0.5, bằng tổng
 *     stocks+bonds+other) phải LOẠI — nó không phải "tài sản khác".
 *
 * Dòng rác cuối file (kỳ không hợp lệ, header sót) bị lọc bằng regex ngày.
 */

const VALID_PERIOD_RE = /^\d{4}-\d{2}-\d{2}$/
const SECTION_RE = /SHARES|EQUITY|FUND CERTIFICATES/i
const TICKER_RE = /^[A-Z0-9]{3}$/

/**
 * Chuẩn hoá ticker cổ phiếu unlisted: báo cáo ghi tên công ty dài làm ticker
 * (vd 'Dien May Xanh Investment Joint Stock Co.'), gom về mã 3 ký tự để đồng
 * bộ với các kỳ/nguồn khác. PHẢI khớp TICKER_ALIAS trong
 * scripts/fund_report/fund_reports_to_holdings.py — không thêm mã ở một bên.
 * Cố tình KHÔNG map TECHCOM/VPBANK Securities (VPS đã là mã công ty nhựa khác
 * trong industry_map; collision) — các kỳ đó giữ tên dài, giống tab Overlap.
 */
const TICKER_ALIAS: Record<string, string> = {
  'Dien May Xanh Investment Joint Stock Co.': 'DMX',
}

/** Một cổ phiếu trong danh mục kỳ báo cáo. */
export interface FundStockHolding {
  ticker: string
  /** Khối lượng nắm giữ (số cổ phiếu / đơn vị). 0 nếu nguồn không trả. */
  quantity: number
  marketPrice: number
  /** Tổng giá trị thị trường (VND). */
  value: number
  /** Tỷ trọng trong NAV, % (weight phân số × 100). */
  weightPct: number
}

/** Giá trị 4 loại tài sản + tổng (VND). Tổng luôn = 4 loại cộng lại. */
export interface FundAssetAllocation {
  stockValue: number
  bondValue: number
  cashValue: number
  otherValue: number
  totalValue: number
}

/** Tóm tắt một kỳ báo cáo từ tidy_portfolio. */
export interface FundPeriodSummary {
  /** YYYY-MM-DD cuối tháng (vd 2026-07-31). */
  periodEnd: string
  /** Cổ phiếu, xếp giảm theo tỷ trọng. */
  stocks: FundStockHolding[]
  allocation: FundAssetAllocation
}

/** Một kỳ từ tidy_assets (tổng tài sản / nợ / NAV / NAV mỗi CCQ). */
export interface FundAssetsSnapshot {
  periodEnd: string
  totalAssets: number
  liabilities: number
  nav: number
  navPerUnit: number
  /** Phải thu từ bán chứng khoán chưa về (2208) — rủi ro kẹt dòng tiền. */
  settlementReceivables: number
  /** Tiền gửi ngân hàng (2203) — phần lớn tiền mặt, tách khỏi tương đương tiền. */
  cashAtBank: number
}

/** Một kỳ từ tidy_income (kết quả hoạt động theo THÁNG). */
export interface FundIncomeSummary {
  periodEnd: string
  /** Thu nhập từ hoạt động đầu tư trong tháng (2220, measure=month). */
  income: number
  /** Chi phí trong tháng (2224, measure=month). */
  expenses: number
  /** Thu nhập ròng hoạt động = income − expenses (tương đương 2233). */
  netProfit: number
  /** Cổ tức nhận được (2221.1). */
  dividends: number
  /** Lãi tiền gửi / lãi khác (2222). */
  interestIncome: number
  /** Phí quản lý quỹ (2225). */
  managementFee: number
  /** Phí giao dịch chứng khoán (2231). */
  brokerageFee: number
  /** Lãi/lỗ THỰC HIỆN khi bán tài sản (2235). */
  realizedGain: number
  /** Lãi/lỗ CHƯA thực hiện theo giá thị trường (2236). */
  unrealizedGain: number
  /**
   * Lợi nhuận THẬT của quỹ = thay đổi NAV do hoạt động đầu tư (2237)
   * = thu nhập ròng (2233) + lãi/lỗ thực hiện (2235) + lãi/lỗ chưa thực hiện (2236).
   * Đây là con số khớp với diễn biến NAV/CCQ — KHÔNG phải income − expenses.
   */
  investmentProfit: number
  /**
   * Thay đổi NAV do nhà đầu tư MUA/BÁN chứng chỉ quỹ trong kỳ (2239.3).
   * Dương = tiền mới vào nhiều hơn rút. Cùng với investmentProfit:
   * ΔNAV tổng = đầu tư + dòng tiền — phân biệt "hiệu quả" với "tiền mới".
   */
  navChangeByFlow: number
  /** Thay đổi NAV do PHÁT HÀNH chứng chỉ quỹ trong kỳ (2239.3.1, dương). */
  subscriptionFlow: number
  /** Thay đổi NAV do MUA LẠI chứng chỉ quỹ trong kỳ (2239.3.2, âm). */
  redemptionFlow: number
}

/** Một kỳ từ tidy_indicators (mua/bán + quy mô + chỉ số theo THÁNG). */
export interface FundFlowSummary {
  periodEnd: string
  /** Số chứng chỉ quỹ đăng ký mua trong kỳ (2277, dương). */
  subscribedUnits: number
  /** Số chứng chỉ quỹ bị mua lại trong kỳ (22781, báo cáo ghi âm). */
  redeemedUnits: number
  /** Số chứng chỉ ròng = mua − bán (dương = mua nhiều hơn). */
  netUnits: number
  /** Số chứng chỉ quỹ đang lưu hành cuối kỳ (2281). */
  outstandingUnits: number
  /** Portfolio turnover rate (%) — tỷ lệ danh mục giao dịch trong kỳ (2270). */
  turnoverRate: number
  /** Số nhà đầu tư cuối kỳ (22841). */
  investorCount: number
  /** Tỷ lệ sở hữu của Công ty quản lý quỹ + bên liên quan (2282, 0-1). */
  relatedPartyOwnership: number
  /** Tỷ lệ sở hữu của 10 nhà đầu tư lớn nhất (2283, 0-1). */
  top10Ownership: number
  /** Tỷ lệ sở hữu của nhà đầu tư nước ngoài (2284, 0-1). */
  foreignOwnership: number
  /** Phí quản lý / NAV bình quân (%) — suất hằng năm (2265). */
  mgmtFeeRatio: number
  /** Tổng chi phí / NAV bình quân (%) — suất hằng năm (2269). */
  expenseRatio: number
}

/** Dòng thô tidy_portfolio.csv (tên cột = header file). */
interface TidyPortfolioRow {
  period_end: string
  section: string
  code: string
  ticker: string
  quantity: string
  market_price: string
  value: string
  weight: string
  asOf: string
}

/** Dòng thô tidy_assets.csv. */
interface TidyAssetRow {
  code: string
  line_item: string
  period_end: string
  value: string
  asOf: string
}

/** Dòng thô tidy_income.csv (có cột measure: 'month' | 'ytd'). */
interface TidyIncomeRow {
  code: string
  line_item: string
  period_end: string
  measure: string
  value: string
  asOf: string
}

/** Dòng thô tidy_indicators.csv. */
interface TidyIndicatorRow {
  code: string
  line_item: string
  period_end: string
  measure: string
  value: string
  asOf: string
}

function isStockRow(section: string, ticker: string): boolean {
  if (!SECTION_RE.test(section)) return false
  if (!ticker) return false
  if (TICKER_RE.test(ticker)) return true
  return section.toUpperCase().includes('UNLISTED')
}

function num(v: unknown): number {
  const n = parseFloat(String(v ?? ''))
  return Number.isNaN(n) ? 0 : n
}

/**
 * Parse tidy_portfolio.csv → Map<periodEnd, FundPeriodSummary>.
 * Kỳ nào không phải dạng ngày hợp lệ (dòng rác cuối file) bị bỏ.
 */
export function parseTidyPortfolio(csvText: string): Map<string, FundPeriodSummary> {
  const result = Papa.parse<TidyPortfolioRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  })

  const byPeriod = new Map<string, FundPeriodSummary>()

  for (const raw of result.data) {
    const periodEnd = String(raw.period_end ?? '').trim()
    if (!VALID_PERIOD_RE.test(periodEnd)) continue

    const section = String(raw.section ?? '').trim()
    const ticker = String(raw.ticker ?? '').trim()
    const weight = num(raw.weight)
    const value = num(raw.value)
    if (Number.isNaN(weight) || !isFinite(weight)) continue

    let p = byPeriod.get(periodEnd)
    if (!p) {
      p = {
        periodEnd,
        stocks: [],
        allocation: { stockValue: 0, bondValue: 0, cashValue: 0, otherValue: 0, totalValue: 0 },
      }
      byPeriod.set(periodEnd, p)
    }

    if (isStockRow(section, ticker)) {
      p.stocks.push({
        ticker: TICKER_ALIAS[ticker] ?? ticker,
        quantity: num(raw.quantity),
        marketPrice: num(raw.market_price),
        value,
        weightPct: weight * 100,
      })
      p.allocation.stockValue += value
    } else if (section === 'BONDS' && !ticker) {
      p.allocation.bondValue += value
    } else if (section === 'CASH' && !ticker) {
      p.allocation.cashValue += value
    } else if (section === 'OTHER ASSETS' && !ticker) {
      p.allocation.otherValue += value
    } else if (section === 'OTHER SECURITIES' && !ticker) {
      // Loại grand-total (tổng toàn bộ chứng khoán) — không phải tài sản khác.
      if (!(weight > 0.5)) {
        p.allocation.otherValue += value
      }
    }
  }

  for (const p of byPeriod.values()) {
    const a = p.allocation
    a.totalValue = a.stockValue + a.bondValue + a.cashValue + a.otherValue
    p.stocks.sort((x, y) => y.weightPct - x.weightPct)
  }

  return byPeriod
}

/**
 * Parse tidy_assets.csv → Map<periodEnd, FundAssetsSnapshot>.
 * Mã cột ổn định qua các era template: 2212 tổng tài sản, 2216 nợ,
 * 2217 NAV, 2219 NAV/CCQ.
 */
export function parseTidyAssets(csvText: string): Map<string, FundAssetsSnapshot> {
  const result = Papa.parse<TidyAssetRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  })

  const byPeriod = new Map<string, FundAssetsSnapshot>()

  for (const raw of result.data) {
    const periodEnd = String(raw.period_end ?? '').trim()
    if (!VALID_PERIOD_RE.test(periodEnd)) continue

    const code = String(raw.code ?? '').trim()
    const value = num(raw.value)
    if (Number.isNaN(value)) continue

    let snap = byPeriod.get(periodEnd)
    if (!snap) {
      snap = { periodEnd, totalAssets: 0, liabilities: 0, nav: 0, navPerUnit: 0, settlementReceivables: 0, cashAtBank: 0 }
      byPeriod.set(periodEnd, snap)
    }
    if (code === '2212') snap.totalAssets = value
    else if (code === '2216') snap.liabilities = value
    else if (code === '2217') snap.nav = value
    else if (code === '2219') snap.navPerUnit = value
    else if (code === '2208') snap.settlementReceivables = value
    else if (code === '2203') snap.cashAtBank = value
  }

  return byPeriod
}

/**
 * Parse tidy_income.csv → Map<periodEnd, FundIncomeSummary>.
 * Chỉ lấy dòng measure='month' (một tháng); bỏ 'ytd' (cộng dồn từ đầu năm).
 * Mã ổn định qua các era: 2220 thu nhập, 2224 chi phí, 2221.1 cổ tức,
 * 2222 lãi, 2225 phí quản lý, 2231 phí giao dịch, 2235 lãi/lỗ thực hiện,
 * 2236 lãi/lỗ chưa thực hiện, 2237 lợi nhuận (đổi NAV do đầu tư).
 */
export function parseTidyIncome(csvText: string): Map<string, FundIncomeSummary> {
  const result = Papa.parse<TidyIncomeRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  })

  const byPeriod = new Map<string, FundIncomeSummary>()
  const zero = (periodEnd: string): FundIncomeSummary => ({
    periodEnd,
    income: 0, expenses: 0, netProfit: 0,
    dividends: 0, interestIncome: 0,
    managementFee: 0, brokerageFee: 0,
    realizedGain: 0, unrealizedGain: 0,
    investmentProfit: 0, navChangeByFlow: 0, subscriptionFlow: 0, redemptionFlow: 0,
  })

  for (const raw of result.data) {
    const periodEnd = String(raw.period_end ?? '').trim()
    if (!VALID_PERIOD_RE.test(periodEnd)) continue
    if (String(raw.measure ?? '').trim() !== 'month') continue

    const code = String(raw.code ?? '').trim()
    const value = num(raw.value)
    if (Number.isNaN(value)) continue

    // Bỏ dòng placeholder "(not applicable)" (vd "Real Estate Management Service
    // fee (not applicable)") — chúng là ô trống của quỹ không áp dụng, KHÔNG phải
    // chi phí thật. Nếu không lọc, dòng 0 này đè lên dòng 2231 thật (last-wins).
    const lineItem = String(raw.line_item ?? '').toLowerCase()
    if (lineItem.includes('(not applicable)')) continue

    let snap = byPeriod.get(periodEnd)
    if (!snap) {
      snap = zero(periodEnd)
      byPeriod.set(periodEnd, snap)
    }
    if (code === '2220') snap.income = value
    else if (code === '2224') snap.expenses = value
    else if (code === '2221.1') snap.dividends = value
    else if (code === '2222') snap.interestIncome = value
    else if (code === '2225') snap.managementFee = value
    else if (code === '2231') snap.brokerageFee = value
    else if (code === '2235') snap.realizedGain = value
    else if (code === '2236') snap.unrealizedGain = value
    else if (code === '2237') snap.investmentProfit = value
    else if (code === '2239.3') snap.navChangeByFlow = value
    else if (code === '2239.3.1') snap.subscriptionFlow = value
    else if (code === '2239.3.2') snap.redemptionFlow = value
  }

  for (const snap of byPeriod.values()) {
    snap.netProfit = snap.income - snap.expenses
    // Fallback nếu kỳ hiếm thiếu dòng 2237: 2237 = 2233 + 2235 + 2236.
    if (snap.investmentProfit === 0 && (snap.netProfit !== 0 || snap.realizedGain !== 0 || snap.unrealizedGain !== 0)) {
      snap.investmentProfit = snap.netProfit + snap.realizedGain + snap.unrealizedGain
    }
  }

  return byPeriod
}

/**
 * Parse tidy_indicators.csv → Map<periodEnd, FundFlowSummary>.
 * 2277 mua, 22781 bán (âm), 2281 CCQ lưu hành cuối kỳ, 2270 turnover rate,
 * 22841 số nhà đầu tư, 2265 phí quản lý/NAV (%), 2269 tổng chi phí/NAV (%).
 */
export function parseTidyIndicators(csvText: string): Map<string, FundFlowSummary> {
  const result = Papa.parse<TidyIndicatorRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  })

  const byPeriod = new Map<string, FundFlowSummary>()
  const zero = (periodEnd: string): FundFlowSummary => ({
    periodEnd,
    subscribedUnits: 0, redeemedUnits: 0, netUnits: 0,
    outstandingUnits: 0, turnoverRate: 0, investorCount: 0,
    mgmtFeeRatio: 0, expenseRatio: 0,
    relatedPartyOwnership: 0, top10Ownership: 0, foreignOwnership: 0,
  })

  for (const raw of result.data) {
    const periodEnd = String(raw.period_end ?? '').trim()
    if (!VALID_PERIOD_RE.test(periodEnd)) continue

    const code = String(raw.code ?? '').trim()
    const value = num(raw.value)
    if (Number.isNaN(value)) continue

    let snap = byPeriod.get(periodEnd)
    if (!snap) {
      snap = zero(periodEnd)
      byPeriod.set(periodEnd, snap)
    }
    if (code === '2277') snap.subscribedUnits = value
    else if (code === '22781') snap.redeemedUnits = value
    else if (code === '2281') snap.outstandingUnits = value
    else if (code === '2270') snap.turnoverRate = value
    else if (code === '22841') snap.investorCount = value
    else if (code === '2265') snap.mgmtFeeRatio = value
    else if (code === '2269') snap.expenseRatio = value
    else if (code === '2282') snap.relatedPartyOwnership = value
    else if (code === '2283') snap.top10Ownership = value
    else if (code === '2284') snap.foreignOwnership = value
  }

  for (const snap of byPeriod.values()) {
    snap.netUnits = snap.subscribedUnits + snap.redeemedUnits
  }

  return byPeriod
}

/** Các kỳ báo cáo có trong danh mục, sắp giảm dần (mới nhất đầu). */
export function fundReportPeriods(portfolio: Map<string, FundPeriodSummary>): string[] {
  return [...portfolio.keys()].sort().reverse()
}

/**
 * Kỳ sẽ dùng khi người dùng chọn `targetPeriod`:
 * - null → kỳ mới nhất.
 * - kỳ gần nhất KHÔNG MUỘN HƠN target; target sớm hơn mọi kỳ → kỳ sớm nhất.
 */
export function resolveReportPeriod(periods: string[], targetPeriod: string | null): string | null {
  const sorted = [...periods].sort()
  if (sorted.length === 0) return null
  if (!targetPeriod) return sorted[sorted.length - 1]!
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]! <= targetPeriod) return sorted[i]!
  }
  return sorted[0]!
}
