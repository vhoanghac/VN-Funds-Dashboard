import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { formatStockAxisVND, StockDcaPanel } from './StockDcaPanel'
import type { Portfolio } from '../types'
import type { ShareUrlState, StockDcaShareState } from '../utils/shareUrl'

const PRICE_CSV = `date,adjusted_price,unadjusted_price
2026-01-05,100,100
2026-01-06,100,100
2026-02-05,100,100
`

const ACTIONS_CSV = `kind,ex_date,record_date,pay_date,last_date,settlement_date,amount_per_share,tax_rate,shares_per_share,rights_per_share,subscription_price,choice,funding,source
cash_dividend,2026-01-06,2026-01-06,2026-01-06,,,700,0.05,,,,,,VCI event cash-1
stock_dividend,2026-01-06,2026-01-06,2026-01-06,,,,,0.13,,,,,VCI event stock-1
`
const PENDING_ACTIONS_CSV = `kind,ex_date,record_date,ratio,subscription_price,source
stock_dividend,2026-01-20,2026-01-21,0.15,,VCI event pending-stock
`

const DIFFERENT_START_PRICES: Record<string, string> = {
  ACB: `date,adjusted_price,unadjusted_price
2026-01-05,100,100
2026-01-06,100,100
2026-02-05,100,100
`,
  MBB: `date,adjusted_price,unadjusted_price
2026-01-06,100,100
2026-01-07,100,100
2026-02-05,100,100
`,
}

const MBB_NO_DATA_IN_SELECTION = `date,adjusted_price,unadjusted_price
2025-01-02,100,100
2026-12-31,100,100
`

function stockShareUrl(stockIds: string[] = ['ACB']): ShareUrlState<Partial<StockDcaShareState>> {
  const portfolios: Portfolio[] = stockIds.map(stockId => ({
    name: stockId,
    slots: [{ fundId: stockId, weight: 100 }],
    rebalFreq: 'monthly',
    transactionCostRates: { buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0 },
  }))
  return {
    key: 'stockdca:test',
    hasExplicitPayload: true,
    parsedPayload: {
      portfolios,
      dateMode: 'all',
      yearsBack: 5,
      dateFrom: '2026-01-05',
      dateTo: '2026-02-05',
      initialAmount: 1_000_000,
      cashflowSchedule: [{ amount: 0, freq: 'monthly', until: null }],
      annualContributionIncreaseAmount: 0,
    },
  }
}

function emptyStockShareUrl(): ShareUrlState<Partial<StockDcaShareState>> {
  const shareUrl = stockShareUrl()
  return {
    ...shareUrl,
    parsedPayload: { ...shareUrl.parsedPayload, portfolios: [] },
  }
}

function localStockShareUrl(): ShareUrlState<Partial<StockDcaShareState>> {
  return {
    key: 'stockdca:local',
    hasExplicitPayload: false,
    parsedPayload: null,
  }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

/** Mở khối Chất lượng dữ liệu và trả về đoạn nêu khoảng so sánh thực tế đã căn chỉnh. */
async function alignedRangeText(): Promise<string> {
  const header = screen.getByRole('button', { name: /Chất lượng dữ liệu:|Dữ liệu đầy đủ/ })
  if (header.getAttribute('aria-expanded') !== 'true') {
    await userEvent.setup().click(header)
  }
  return screen.getByText(/Khoảng so sánh thực tế đã được căn chỉnh/).textContent ?? ''
}

describe('StockDcaPanel', () => {
  it('uses compact axis labels for account-value charts', () => {
    expect(formatStockAxisVND(2_500_000_000)).toBe('2.5B')
    expect(formatStockAxisVND(5_000_000)).toBe('5M')
    expect(formatStockAxisVND(750)).toBe('750')
  })

  it('loads stock CSVs, hydrates dates, and commits a run', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      return Promise.resolve({
        ok: true,
        status: 200,
       text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    render(<StockDcaPanel active shareUrl={stockShareUrl()} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled())
    expect(screen.getByDisplayValue('2026-01-05')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2026-02-05')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/data/stocks/ACB.csv')
    expect(fetchMock).toHaveBeenCalledWith('/data/stocks/ACB_div.csv')
    expect(fetchMock).toHaveBeenCalledWith('/data/stocks/ACB_pending.csv')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())
    expect(screen.getByText('Tích Lũy Cổ Phiếu')).toBeInTheDocument()
    expect(screen.getByTitle(/So sánh lợi nhuận các cổ phiếu/)).toBeInTheDocument()
    expect(screen.getByText(/giá cổ phiếu cần tăng thêm/)).toBeInTheDocument()
    expect(screen.getByText(/thay vì mua cổ phiếu/)).toBeInTheDocument()
    expect(screen.getAllByText(/lịch sử cổ phiếu/).length).toBeGreaterThan(0)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Hiệu suất đầu tư' }))
    const yearlyReturns = screen.getByRole('heading', { name: 'Hiệu suất danh mục của bạn từng năm' })
    const bankComparison = screen.getByRole('heading', { name: 'So với gửi tiết kiệm ngân hàng thì sao?' })
    expect(yearlyReturns.compareDocumentPosition(bankComparison) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: /Vì sao có 3 con số/ }))
    expect(screen.getByText(/CAGR thuần của cổ phiếu/)).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cổ tức' }))
    expect(screen.queryByRole('heading', { name: 'So với gửi tiết kiệm ngân hàng thì sao?' })).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Rủi ro & biến động' }))
    expect(screen.getAllByRole('button', { name: 'Tất cả' }).some(button => button.className.includes('dca-results-filter-btn'))).toBe(false)

    expect(screen.queryByRole('combobox', { name: 'Danh mục đang xem' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cổ tức' }))
    expect(screen.getByRole('button', { name: /^ACB$/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Cổ tức hằng năm' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Số lượng cổ phiếu nắm giữ theo thời gian' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cổ tức tiền mặt' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cổ tức bằng cổ phiếu' })).toBeInTheDocument()
    expect(screen.getByLabelText('Cách tính giá trị tham chiếu cổ tức bằng cổ phiếu')).toHaveAttribute('title', expect.stringContaining('giá đóng cửa chưa điều chỉnh'))
    expect(screen.getByText('VCI đã công bố các sự kiện này, nhưng chưa có ngày cổ phiếu về. Dashboard chỉ hiển thị để theo dõi, chưa cộng vào sổ tài khoản.')).toBeInTheDocument()
  })

  it('hydrates saved portfolios after reload without running DCA', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    localStorage.setItem('stockdca_portfolios', JSON.stringify([{
      name: 'ACB đã lưu',
      slots: [{ fundId: 'ACB', weight: 100 }],
      rebalFreq: 'monthly',
      transactionCostRates: { buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0 },
    }]))

    render(<StockDcaPanel active shareUrl={localStockShareUrl()} />)

    await waitFor(() => expect(screen.getByText('ACB · Ngân hàng Á Châu')).toBeInTheDocument())
    expect(screen.getByDisplayValue('ACB đã lưu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Đã cập nhật' })).not.toBeInTheDocument()
  })

  it('shows the all-portfolios risk filter when multiple portfolios are available', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    render(<StockDcaPanel active shareUrl={stockShareUrl(['ACB', 'MBB'])} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hiệu suất đầu tư' }))
    const bankComparisonBlock = screen.getByRole('heading', { name: 'So với gửi tiết kiệm ngân hàng thì sao?' }).closest('.dca-block')
    expect(bankComparisonBlock).not.toBeNull()
    expect(bankComparisonBlock).toHaveTextContent('ACB')
    expect(bankComparisonBlock).toHaveTextContent('MBB')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Rủi ro & biến động' }))

    expect(screen.getAllByRole('button', { name: 'Tất cả' }).some(button => button.className.includes('dca-results-filter-btn'))).toBe(true)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Phân bổ' }))

    expect(screen.queryByLabelText('Chọn danh mục trong Phân bổ')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Tỷ trọng tài sản của ACB')).toBeInTheDocument()
    expect(screen.getByLabelText('Tỷ trọng tài sản của MBB')).toBeInTheDocument()
  })

  it('starts multiple stock portfolios on their common first date', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      const symbol = path.match(/\/stocks\/([A-Z]+)(?:_div|_pending)?\.csv/)?.[1] ?? ''
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : DIFFERENT_START_PRICES[symbol] ?? PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    const shareUrl = stockShareUrl(['ACB', 'MBB'])
    shareUrl.parsedPayload = { ...shareUrl.parsedPayload, dateFrom: '', dateTo: '' }
    render(<StockDcaPanel active shareUrl={shareUrl} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hiệu suất đầu tư' }))

    const aligned = await alignedRangeText()
    expect(aligned).toContain('06/01/2026')
    expect(aligned).toContain('05/02/2026')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Rủi ro & biến động' }))
    const mbbFilter = screen.getAllByRole('button', { name: 'MBB' }).find(button => button.className.includes('dca-results-filter-btn'))
    expect(mbbFilter).toBeDefined()
    await userEvent.setup().click(mbbFilter!)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hiệu suất đầu tư' }))
    expect(await alignedRangeText()).toContain('06/01/2026')
  })

  it('warns instead of silently dropping a portfolio with no price in the selected period', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      const symbol = path.match(/\/stocks\/([A-Z]+)(?:_div|_pending)?\.csv/)?.[1] ?? ''
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV
          : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV
            : symbol === 'MBB' ? MBB_NO_DATA_IN_SELECTION : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    render(<StockDcaPanel active shareUrl={stockShareUrl(['ACB', 'MBB'])} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())
    expect(screen.getByText(/Không đủ dữ liệu giá trong khoảng đang chọn cho: MBB/)).toBeInTheDocument()
    expect(screen.getByText('Tích Lũy Cổ Phiếu')).toBeInTheDocument()
  })

  it('allows a one-day inclusive date range when a price exists', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    const shareUrl = stockShareUrl()
    shareUrl.parsedPayload = { ...shareUrl.parsedPayload, dateTo: '2026-01-05' }
    render(<StockDcaPanel active shareUrl={shareUrl} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())
    expect(screen.getByText('Tích Lũy Cổ Phiếu')).toBeInTheDocument()
    expect(screen.queryByText('Khoảng thời gian đang chọn chưa có dữ liệu giá cho danh mục nào.')).not.toBeInTheDocument()
  })

  it('trims all portfolios to the common dates after a long price gap', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      const symbol = path.match(/\/stocks\/([A-Z]+)(?:_div|_pending)?\.csv/)?.[1] ?? ''
      const mbbWithLongGap = `date,adjusted_price,unadjusted_price
2026-01-05,100,100
2026-01-06,100,100
`
      const acbThroughMarch = `${PRICE_CSV.trimEnd()}
2026-03-01,100,100
`
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV
          : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV
            : symbol === 'MBB' ? mbbWithLongGap : acbThroughMarch,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    const shareUrl = stockShareUrl(['ACB', 'MBB'])
    shareUrl.parsedPayload = { ...shareUrl.parsedPayload, dateFrom: '', dateTo: '' }
    render(<StockDcaPanel active shareUrl={shareUrl} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hiệu suất đầu tư' }))
    const aligned = await alignedRangeText()
    expect(aligned).toContain('05/01/2026')
    expect(aligned).toContain('06/01/2026')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cổ tức' }))
    const mbbFilter = screen.getAllByRole('button', { name: 'MBB' }).find(button => button.className.includes('dca-results-filter-btn'))
    expect(mbbFilter).toBeDefined()
    await userEvent.setup().click(mbbFilter!)
    expect(await alignedRangeText()).toContain('05/01/2026')
  })

  it('keeps each stock ledger on its own raw quote dates inside the shared period', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      const symbol = path.match(/\/stocks\/([A-Z]+)(?:_div|_pending)?\.csv/)?.[1] ?? ''
      const prices = symbol === 'MBB'
        ? `date,adjusted_price,unadjusted_price
2026-01-05,100,100
2026-01-06,100,100
2026-02-05,100,100
`
        : `date,adjusted_price,unadjusted_price
2026-01-05,100,100
2026-01-25,100,100
2026-02-05,100,100
`
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : prices,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    const shareUrl = stockShareUrl(['ACB', 'MBB'])
    shareUrl.parsedPayload = {
      ...shareUrl.parsedPayload,
      dateFrom: '',
      dateTo: '',
      cashflowSchedule: [{ amount: 1_000_000, freq: 'weekly', until: null }],
    }
    render(<StockDcaPanel active shareUrl={shareUrl} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())

    expect(screen.getAllByText('3.000.000 đ').length).toBeGreaterThan(0)
  })

  it('reports when portfolios have data but no shared period', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      const symbol = path.match(/\/stocks\/([A-Z]+)(?:_div|_pending)?\.csv/)?.[1] ?? ''
      const prices = symbol === 'MBB'
        ? 'date,adjusted_price,unadjusted_price\n2026-02-05,100,100\n2026-02-06,100,100\n'
        : 'date,adjusted_price,unadjusted_price\n2026-01-05,100,100\n2026-01-06,100,100\n'
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : prices,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    const shareUrl = stockShareUrl(['ACB', 'MBB'])
    shareUrl.parsedPayload = { ...shareUrl.parsedPayload, dateFrom: '', dateTo: '' }
    render(<StockDcaPanel active shareUrl={shareUrl} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))

    await waitFor(() => expect(screen.getByText('Các danh mục có dữ liệu, nhưng không cùng một khoảng ngày để so sánh.')).toBeInTheDocument())
  })

  it('keeps a valid portfolio visible when another stock fails to load', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      const symbol = path.match(/\/stocks\/([A-Z]+)(?:_div|_pending)?\.csv/)?.[1] ?? ''
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV
          : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV
            : symbol === 'MBB' ? 'date,adjusted_price,unadjusted_price\n' : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    render(<StockDcaPanel active shareUrl={stockShareUrl(['ACB', 'MBB'])} />)
    await waitFor(() => expect(screen.getByText('Không có dữ liệu giá cho MBB')).toBeInTheDocument())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())
    expect(screen.getByText(/Không đủ dữ liệu giá trong khoảng đang chọn cho: MBB/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hiệu suất đầu tư' }))
    expect(screen.getByRole('heading', { name: 'Bảng thống kê' })).toBeInTheDocument()
  })

  it('shows stock data quality before and after running DCA', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    const shareUrl = stockShareUrl(['ACB'])
    shareUrl.parsedPayload = { ...shareUrl.parsedPayload, dateFrom: '2026-01-01' }
    render(<StockDcaPanel active shareUrl={shareUrl} />)
    const qualityButton = await screen.findByRole('button', { name: /Chất lượng dữ liệu:|Dữ liệu đầy đủ/ })

    await userEvent.setup().click(qualityButton)
    expect(screen.getByText(/Mỗi cổ phiếu có lịch sử dữ liệu khác nhau/)).toBeInTheDocument()
    expect(screen.getByText(/Cổ phiếu bắt đầu từ/)).toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())
    expect(screen.getByText(/Khoảng so sánh thực tế đã được căn chỉnh/)).toBeInTheDocument()
  })

  it('keeps the setup form mounted while a newly added stock loads', async () => {
    type FetchResponse = { ok: boolean; status: number; text: () => Promise<string> }
    const resolvers: Array<(response: FetchResponse) => void> = []
    const fetchMock = vi.fn(() => new Promise<FetchResponse>(resolve => resolvers.push(resolve)))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    render(<StockDcaPanel active shareUrl={emptyStockShareUrl()} />)
    await userEvent.setup().click(screen.getByRole('button', { name: '+ Thêm Danh Mục' }))

    await waitFor(() => expect(screen.getByText('Đang tải chuỗi giá cổ phiếu...')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Thông số' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Danh mục' })).toBeInTheDocument()
    expect(screen.getByText('ACB · Ngân hàng Á Châu')).toBeInTheDocument()
    expect(resolvers).toHaveLength(3)
  })

  it('adds a second stock slot to the same portfolio and can equalize its weights', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    render(<StockDcaPanel active shareUrl={stockShareUrl(['ACB'])} />)
    await waitFor(() => expect(screen.getByTitle('Thêm cổ phiếu')).toBeEnabled())

    await userEvent.setup().click(screen.getByTitle('Thêm cổ phiếu'))

    expect(screen.getByText('BID · BIDV')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByTitle('Chia đều tỷ trọng'))
    expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Phân bổ' }))
    expect(screen.getAllByText('ACB').length).toBeGreaterThan(0)
    expect(screen.getAllByText('BID').length).toBeGreaterThan(0)
  })

  it('defaults the dividend section to "Tất cả" and hides per-stock blocks until a stock is picked', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    render(<StockDcaPanel active shareUrl={stockShareUrl(['ACB'])} />)
    await waitFor(() => expect(screen.getByTitle('Thêm cổ phiếu')).toBeEnabled())
    await userEvent.setup().click(screen.getByTitle('Thêm cổ phiếu'))
    await userEvent.setup().click(screen.getByTitle('Chia đều tỷ trọng'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cổ tức' }))
    const stockToolbar = screen.getByLabelText('Chọn cổ phiếu trong danh mục')
    expect(within(stockToolbar).getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Cổ tức hằng năm' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Số lượng cổ phiếu nắm giữ theo thời gian' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Chi tiết khoản đầu tư' })).not.toBeInTheDocument()
    expect(document.querySelector('.stock-position-dividends-block')).toBeNull()
    // Chi tiết tài khoản cuối kỳ luôn là bản tổng của cả danh mục.
    expect(screen.getByText('Số mã đang nắm giữ')).toBeInTheDocument()
    // Sổ tài khoản ở "Tất cả" là sổ chung của danh mục.
    await userEvent.setup().click(screen.getByText(/Hiện theo tháng/))
    expect(screen.getByRole('columnheader', { name: 'Tiền mặt' })).toBeInTheDocument()

    await userEvent.setup().click(within(stockToolbar).getByRole('button', { name: 'ACB' }))
    expect(within(stockToolbar).getByRole('button', { name: 'ACB' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Số lượng cổ phiếu nắm giữ theo thời gian' })).toBeInTheDocument()
    const dividendsBlock = screen.getByRole('heading', { name: 'Chi tiết khoản đầu tư' }).closest('.stock-position-dividends-block') as HTMLElement
    expect(within(dividendsBlock).getByText('Giá trị hiện tại')).toBeInTheDocument()
    expect(within(dividendsBlock).getByText('Số cổ phiếu')).toBeInTheDocument()
    expect(within(dividendsBlock).getByText('Tổng tiền đã giải ngân')).toBeInTheDocument()
    const investedStat = within(dividendsBlock).getByText('Tổng tiền đã giải ngân').closest('.dca-journey-stat') as HTMLElement
    expect(investedStat.querySelector('.chart-tooltip-icon')?.getAttribute('title')).toMatch(/tái cân bằng/i)
    // Lợi nhuận/% tạm ẩn tới khi có externalCapital + TWRR theo mã.
    expect(within(dividendsBlock).queryByText('Lợi nhuận')).not.toBeInTheDocument()
    expect(within(dividendsBlock).getByText('Cổ tức tiền mặt đã nhận')).toBeInTheDocument()
    expect(within(dividendsBlock).getByText('Cổ tức bằng cổ phiếu đã nhận')).toBeInTheDocument()
    expect(screen.getByText('Số mã đang nắm giữ')).toBeInTheDocument()
    expect(screen.queryByText('Cổ phiếu ACB cuối kỳ')).not.toBeInTheDocument()
    // Sổ tài khoản đổi sang sổ riêng của mã.
    expect(screen.queryByRole('columnheader', { name: 'Tiền mặt' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Tổng cổ phiếu' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Đã đầu tư' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Giá trị phân bổ' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Cổ tức tiền đã nhận' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Cổ tức cổ phiếu đã nhận' })).toBeInTheDocument()
  })

  it('resets the stock-dividend unit per scope and blocks share mode for "Tất cả"', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    render(<StockDcaPanel active shareUrl={stockShareUrl(['ACB'])} />)
    await waitFor(() => expect(screen.getByTitle('Thêm cổ phiếu')).toBeEnabled())
    await userEvent.setup().click(screen.getByTitle('Thêm cổ phiếu'))
    await userEvent.setup().click(screen.getByTitle('Chia đều tỷ trọng'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cổ tức' }))
    const stockToolbar = screen.getByLabelText('Chọn cổ phiếu trong danh mục')
    const unitToggle = screen.getByRole('group', { name: 'Đơn vị chart cổ tức bằng cổ phiếu' })
    const sharesBtn = within(unitToggle).getByRole('button', { name: 'Số cổ phiếu' })
    const valueBtn = within(unitToggle).getByRole('button', { name: 'Giá trị tham chiếu' })

    // "Tất cả" mặc định "Giá trị tham chiếu", nút "Số cổ phiếu" bị khoá.
    expect(valueBtn).toHaveAttribute('aria-pressed', 'true')
    expect(sharesBtn).toHaveAttribute('aria-pressed', 'false')
    expect(sharesBtn).toBeDisabled()

    // Chọn một mã thì bật lại "Số cổ phiếu" và tự chuyển về shares.
    await userEvent.setup().click(within(stockToolbar).getByRole('button', { name: 'BID' }))
    expect(sharesBtn).toBeEnabled()
    expect(sharesBtn).toHaveAttribute('aria-pressed', 'true')
    expect(valueBtn).toHaveAttribute('aria-pressed', 'false')

    // Đổi tay sang value rồi đổi scope phải reset về default của scope mới.
    await userEvent.setup().click(valueBtn)
    expect(valueBtn).toHaveAttribute('aria-pressed', 'true')
    await userEvent.setup().click(within(stockToolbar).getByRole('button', { name: 'Tất cả' }))
    expect(valueBtn).toHaveAttribute('aria-pressed', 'true')
    expect(sharesBtn).toBeDisabled()
    await userEvent.setup().click(within(stockToolbar).getByRole('button', { name: 'ACB' }))
    expect(sharesBtn).toBeEnabled()
    expect(sharesBtn).toHaveAttribute('aria-pressed', 'true')
    expect(valueBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('defaults the performance section to All and filters every block to the picked portfolio', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    render(<StockDcaPanel active shareUrl={stockShareUrl(['ACB', 'MBB'])} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hiệu suất đầu tư' }))

    const perfToolbar = screen.getByLabelText('Chọn danh mục trong Hiệu suất đầu tư')
    expect(within(perfToolbar).getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'true')
    const allBank = screen.getByRole('heading', { name: 'So với gửi tiết kiệm ngân hàng thì sao?' }).closest('.dca-block') as HTMLElement
    expect(allBank).toHaveTextContent('ACB')
    expect(allBank).toHaveTextContent('MBB')
    // "Tất cả" là nhiều series cạnh nhau, không gộp thành một danh mục mới.
    expect(screen.queryAllByRole('heading', { name: /^Giá trị phân bổ - / })).toHaveLength(0)

    await userEvent.setup().click(within(perfToolbar).getByRole('button', { name: 'ACB' }))
    expect(within(perfToolbar).getByRole('button', { name: 'ACB' })).toHaveAttribute('aria-pressed', 'true')
    const acbBank = screen.getByRole('heading', { name: 'So với gửi tiết kiệm ngân hàng thì sao?' }).closest('.dca-block') as HTMLElement
    expect(acbBank).toHaveTextContent('ACB')
    expect(acbBank).not.toHaveTextContent('MBB')
  })

  it('shows one allocated-value chart per stock for a single portfolio, with no performance toolbar', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    render(<StockDcaPanel active shareUrl={stockShareUrl(['ACB'])} />)
    await waitFor(() => expect(screen.getByTitle('Thêm cổ phiếu')).toBeEnabled())
    await userEvent.setup().click(screen.getByTitle('Thêm cổ phiếu'))
    await userEvent.setup().click(screen.getByTitle('Chia đều tỷ trọng'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hiệu suất đầu tư' }))

    expect(screen.queryByLabelText('Chọn danh mục trong Hiệu suất đầu tư')).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: /^Giá trị phân bổ - / })).toHaveLength(2)
  })

  it('keeps the dividend stock filter independent from the performance scope', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    const shareUrl = stockShareUrl(['ACB'])
    shareUrl.parsedPayload = {
      ...shareUrl.parsedPayload,
      dateFrom: '',
      dateTo: '',
      portfolios: [
        { name: 'P1', slots: [{ fundId: 'ACB', weight: 50 }, { fundId: 'BID', weight: 50 }], rebalFreq: 'monthly', transactionCostRates: { buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0 } },
        { name: 'P2', slots: [{ fundId: 'ACB', weight: 50 }, { fundId: 'BID', weight: 50 }], rebalFreq: 'monthly', transactionCostRates: { buyFeeRate: 0, sellFeeRate: 0, sellTaxRate: 0 } },
      ],
    }
    render(<StockDcaPanel active shareUrl={shareUrl} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cổ tức' }))
    const stockToolbar = screen.getByLabelText('Chọn cổ phiếu trong danh mục')
    await userEvent.setup().click(within(stockToolbar).getByRole('button', { name: 'BID' }))
    expect(within(stockToolbar).getByRole('button', { name: 'BID' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Hiệu suất đầu tư' }))
    const perfToolbar = screen.getByLabelText('Chọn danh mục trong Hiệu suất đầu tư')
    await userEvent.setup().click(within(perfToolbar).getByRole('button', { name: 'P2' }))

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cổ tức' }))
    const stockToolbarAfter = screen.getByLabelText('Chọn cổ phiếu trong danh mục')
    expect(within(stockToolbarAfter).getByRole('button', { name: 'BID' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(stockToolbarAfter).getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('lets the user type a custom savings rate in the bank comparison', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input)
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => path.endsWith('_div.csv') ? ACTIONS_CSV : path.endsWith('_pending.csv') ? PENDING_ACTIONS_CSV : PRICE_CSV,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    render(<StockDcaPanel active shareUrl={stockShareUrl(['ACB'])} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chạy DCA' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đã cập nhật' })).toBeDisabled())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hiệu suất đầu tư' }))

    const rateInput = screen.getByLabelText('Lãi suất tiết kiệm tự nhập')
    expect(rateInput).toHaveValue('6,5')
    await userEvent.setup().clear(rateInput)
    await userEvent.setup().type(rateInput, '9,5')

    const bankBlock = screen.getByRole('heading', { name: 'So với gửi tiết kiệm ngân hàng thì sao?' }).closest('.dca-block') as HTMLElement
    expect(bankBlock).toHaveTextContent('9.5%/năm')
  })
})
