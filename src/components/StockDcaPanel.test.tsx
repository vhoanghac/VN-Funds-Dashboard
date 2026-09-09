import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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
    await userEvent.setup().click(screen.getByRole('button', { name: /Giải Thích Khái Niệm/ }))
    expect(screen.getByText(/CAGR thuần của cổ phiếu/)).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Hiệu suất đầu tư' }))
    const yearlyReturns = screen.getByRole('heading', { name: 'Hiệu suất danh mục của bạn từng năm' })
    const bankComparison = screen.getByRole('heading', { name: 'So với gửi tiết kiệm ngân hàng thì sao?' })
    expect(yearlyReturns.compareDocumentPosition(bankComparison) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

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

    expect(screen.getByText('DCA từ 06/01/2026 đến 05/02/2026')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Rủi ro & biến động' }))
    const mbbFilter = screen.getAllByRole('button', { name: 'MBB' }).find(button => button.className.includes('dca-results-filter-btn'))
    expect(mbbFilter).toBeDefined()
    await userEvent.setup().click(mbbFilter!)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hiệu suất đầu tư' }))
    expect(screen.getByText('DCA từ 06/01/2026 đến 05/02/2026')).toBeInTheDocument()
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
})
