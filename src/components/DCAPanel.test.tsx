import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DCAPanel } from './DCAPanel'
import type { FundMeta } from '../types'

const FUNDS: FundMeta[] = [
  { id: 'TEST', name_vi: 'Quỹ kiểm thử', type: 'mutual_fund', start_date: '2020-01-01', csv_file: 'TEST.csv' },
]

const CSV = [
  'date,price',
  '2020-01-01,100',
  '2020-02-01,110',
  '2020-03-01,121',
].join('\n')

const SHARE_URL = {
  key: 'dca-test',
  hasExplicitPayload: true,
  parsedPayload: {
    dateMode: 'all' as const,
    dateFrom: '',
    dateTo: '',
    initialAmount: 1_000_000,
    cashflowAmount: 1_000_000,
    cashflowFreq: 'monthly' as const,
    portfolios: [
      { name: 'Danh mục A', slots: [{ fundId: 'TEST', weight: 100 }], rebalFreq: 'yearly' as const },
      { name: 'Danh mục B', slots: [{ fundId: 'TEST', weight: 100 }], rebalFreq: 'yearly' as const },
    ],
  },
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DCAPanel performance scope', () => {
  it('lọc toàn bộ khối Hiệu suất đầu tư và hiện giá trị phân bổ khi chọn một danh mục', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    vi.stubGlobal('fetch', vi.fn(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => CSV,
        json: async () => ({}),
      })
    }))

    render(<DCAPanel funds={FUNDS} active shareUrl={SHARE_URL} />)
    const user = userEvent.setup()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy DCA' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Chạy DCA' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chạy lại DCA' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Hiệu suất đầu tư' }))

    const toolbar = screen.getByLabelText('Chọn danh mục trong Hiệu suất đầu tư')
    expect(within(toolbar).getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('heading', { name: 'Giá trị tài sản' })).toHaveLength(1)
    expect(screen.queryAllByRole('heading', { name: /^Giá trị phân bổ - / })).toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'So với gửi tiết kiệm ngân hàng thì sao?' }).closest('.dca-block')).toHaveTextContent('Danh mục A')
    expect(screen.getByRole('heading', { name: 'So với gửi tiết kiệm ngân hàng thì sao?' }).closest('.dca-block')).toHaveTextContent('Danh mục B')

    await user.click(within(toolbar).getByRole('button', { name: 'Danh mục A' }))
    expect(within(toolbar).getByRole('button', { name: 'Danh mục A' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('heading', { name: /^Giá trị phân bổ - / })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'So với gửi tiết kiệm ngân hàng thì sao?' }).closest('.dca-block')).not.toHaveTextContent('Danh mục B')
  })
})
