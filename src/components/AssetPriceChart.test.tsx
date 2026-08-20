import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AssetPriceChart } from './AssetPriceChart'

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: ResizeObserverCallback) {}

    observe() {
      this.callback(
        [{ contentRect: { width: 800, height: 300 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      )
    }

    unobserve() {}
    disconnect() {}
  })
})

describe('AssetPriceChart', () => {
  it('shows buy and sell legend entries for a dual-price asset', async () => {
    const { container } = render(
      <AssetPriceChart
        metadata={[goldMetadata]}
        series={[{
          assetId: 'GOLD_SJC',
          name: 'GOLD_SJC',
          color: '#c96442',
          data: [
            { date: '2024-01-01', value: 1000 },
            { date: '2024-01-02', value: 1050 },
          ],
          secondaryData: [
            { date: '2024-01-01', value: 1100 },
            { date: '2024-01-02', value: 1150 },
          ],
        }]}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Giá mua vào')).toBeInTheDocument()
      expect(screen.getByText('Giá bán ra')).toBeInTheDocument()
      expect(Array.from(container.querySelectorAll('.recharts-line-curve')).map(line => line.getAttribute('stroke')))
        .toEqual(expect.arrayContaining(['#c96442', '#d97706']))
    })
  })

  it('keeps a single legend entry for a normal asset', async () => {
    render(
      <AssetPriceChart
        metadata={[fundMetadata]}
        series={[{
          assetId: 'DCDS',
          name: 'DCDS',
          color: '#c96442',
          data: [{ date: '2024-01-01', value: 1000 }],
        }]}
      />,
    )

    await waitFor(() => {
      expect(screen.getAllByText('DCDS')).toHaveLength(2)
      expect(screen.queryByText('Giá bán ra')).not.toBeInTheDocument()
    })
  })

  it('toggles logarithmic scale for every price panel', async () => {
    render(
      <AssetPriceChart
        metadata={[goldMetadata]}
        series={[{
          assetId: 'GOLD_SJC',
          name: 'GOLD_SJC',
          color: '#c96442',
          data: [{ date: '2024-01-01', value: 1000 }],
        }]}
      />,
    )

    const button = screen.getByRole('button', { name: 'Log' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)

    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'))
  })

  it('zooms the dual-price axis and switches to a separate spread chart', async () => {
    const { container } = render(
      <AssetPriceChart
        metadata={[goldMetadata]}
        series={[{
          assetId: 'GOLD_SJC',
          name: 'GOLD_SJC',
          color: '#2563eb',
          data: [
            { date: '2024-01-01', value: 1000 },
            { date: '2024-01-02', value: 1050 },
          ],
          secondaryData: [
            { date: '2024-01-01', value: 1100 },
            { date: '2024-01-02', value: 1150 },
          ],
        }]}
      />,
    )

    const zoomButton = screen.getByRole('button', { name: 'Giãn trục' })
    const spreadButton = screen.getByRole('button', { name: 'Chênh lệch' })
    expect(zoomButton).toHaveAttribute('aria-pressed', 'false')
    expect(spreadButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(zoomButton)
    fireEvent.click(spreadButton)

    await waitFor(() => {
      expect(zoomButton).toHaveAttribute('aria-pressed', 'true')
      expect(spreadButton).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText('Chênh lệch (bán - mua)')).toBeInTheDocument()
      expect(screen.queryByText('Giá mua vào')).not.toBeInTheDocument()
      expect(screen.queryByText('Giá bán ra')).not.toBeInTheDocument()
      expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(1)
    })
  })
})

const goldMetadata = {
  id: 'GOLD_SJC',
  name_vi: 'Vàng SJC',
  type: 'gold' as const,
  start_date: '2024-01-01',
  csv_file: 'GOLD_SJC.csv',
}

const fundMetadata = {
  id: 'DCDS',
  name_vi: 'DCDS',
  type: 'mutual_fund' as const,
  start_date: '2024-01-01',
  csv_file: 'DCDS.csv',
}
