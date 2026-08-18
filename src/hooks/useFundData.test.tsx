import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import {
  useFundSeries,
  useFundSeriesMap,
  useMultiFundSeries,
} from './useFundData'

type MockResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
  json: () => Promise<unknown>
}

const CSV: Record<string, string> = {
  DCDS: 'date,price\n2024-01-01,100\n2024-01-02,110',
  DCBF: 'date,price\n2024-01-01,200\n2024-01-02,220',
  DCDE: 'date,price\n2024-01-02,100\n2024-01-03,90',
  GOLD_SJC: 'date,price,buy,sell\n2024-01-01,900,1000,1100\n2024-01-02,950,1050,1150',
  EMPTY: 'date,price\n',
}

let fetchMock: ReturnType<typeof vi.fn>

function response(body: string, ok = true, status = 200): MockResponse {
  return {
    ok,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  }
}

function csvCalls(): string[] {
  return fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter(url => url.endsWith('.csv'))
}

function summary(map: Map<string, Array<{ date: string; price: number }>>): string {
  return JSON.stringify(Array.from(map.entries()).map(([id, points]) => ({
    id,
    length: points.length,
    first: points[0] ?? null,
    last: points[points.length - 1] ?? null,
  })))
}

function MapProbe({
  ids,
  dualPriceFundIds = new Set<string>(),
}: {
  ids: string[]
  dualPriceFundIds?: ReadonlySet<string>
}) {
  const state = useFundSeriesMap(ids, { dualPriceFundIds })
  return (
    <>
      <output data-testid="loading">{String(state.loading)}</output>
      <output data-testid="data">{summary(state.data)}</output>
      <output data-testid="raw">{summary(state.raw)}</output>
      <output data-testid="purchase">{summary(state.purchase)}</output>
      <output data-testid="errors">{JSON.stringify(Array.from(state.errors.entries()))}</output>
    </>
  )
}

function SingleProbe({ fundId }: { fundId: string | null }) {
  const state = useFundSeries(fundId)
  return (
    <>
      <output data-testid="single-loading">{String(state.loading)}</output>
      <output data-testid="single-prices">{state.prices ? state.prices.length : 'null'}</output>
      <output data-testid="single-error">{state.error ?? 'null'}</output>
    </>
  )
}

function MultiProbe({ ids }: { ids: string[] }) {
  const state = useMultiFundSeries(ids)
  return (
    <>
      <output data-testid="multi-data">{String(state.data instanceof Map)}</output>
      <output data-testid="multi-loading">{String(state.loading)}</output>
      <output data-testid="multi-errors">{String(state.errors instanceof Map)}</output>
    </>
  )
}

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/data/dividends.json') {
      return response(JSON.stringify({
        DCDE: [{
          exDate: '2024-01-03',
          payDate: '2024-01-04',
          amountPerCert: 10,
          taxRate: 0,
        }],
      }))
    }
    const id = url.match(/^\/data\/(.+)\.csv$/)?.[1]
    return id && CSV[id]
      ? response(CSV[id])
      : response('', false, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useFundSeriesMap', () => {
  it('fetches, parses and dividend-adjusts a normal fund', async () => {
    render(<MapProbe ids={['DCDS']} />)

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    expect(screen.getByTestId('data')).toHaveTextContent('"id":"DCDS"')
    expect(screen.getByTestId('raw')).toHaveTextContent('"first":{"date":"2024-01-01","price":100}')
  })

  it('generates savings locally without fetching a CSV from the network', async () => {
    const before = csvCalls().length
    render(<MapProbe ids={['SAVINGS:6']} />)

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    expect(csvCalls()).toHaveLength(before)
    expect(screen.getByTestId('data')).toHaveTextContent('"date":"2000-01-01"')
    expect(screen.getByTestId('raw')).toHaveTextContent('"date":"2000-01-01"')
  })

  it('keeps buy in data/raw and sell in purchase for a dual-price fund', async () => {
    render(<MapProbe ids={['GOLD_SJC']} dualPriceFundIds={new Set(['GOLD_SJC'])} />)

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    expect(screen.getByTestId('data')).toHaveTextContent('"price":1000')
    expect(screen.getByTestId('raw')).toHaveTextContent('"price":1000')
    expect(screen.getByTestId('purchase')).toHaveTextContent('"price":1100')
  })

  it('keeps raw different from adjusted data for a dividend fund', async () => {
    render(<MapProbe ids={['DCDE']} />)

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    expect(screen.getByTestId('raw')).toHaveTextContent('"price":100')
    expect(screen.getByTestId('data')).toHaveTextContent('"price":90')
  })

  it('fetches only the newly requested fund when the list grows', async () => {
    const view = render(<MapProbe ids={['DCDS']} />)
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    view.rerender(<MapProbe ids={['DCDS', 'DCBF']} />)
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('"id":"DCBF"'))

    expect(csvCalls().filter(url => url.endsWith('/DCDS.csv'))).toHaveLength(1)
    expect(csvCalls().filter(url => url.endsWith('/DCBF.csv'))).toHaveLength(1)
  })

  it('does not refetch when order changes or duplicate IDs are added', async () => {
    const view = render(<MapProbe ids={['DCDS', 'DCBF']} />)
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    view.rerender(<MapProbe ids={['DCBF', 'DCDS', 'DCDS']} />)
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    expect(csvCalls().filter(url => url.endsWith('/DCDS.csv'))).toHaveLength(1)
    expect(csvCalls().filter(url => url.endsWith('/DCBF.csv'))).toHaveLength(1)
  })

  it('prunes unused savings when the list changes without a new fetch', async () => {
    const view = render(<MapProbe ids={['SAVINGS:6', 'DCDS']} />)
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    const callsBefore = csvCalls().length
    view.rerender(<MapProbe ids={['DCDS']} />)
    await waitFor(() => expect(screen.getByTestId('data')).not.toHaveTextContent('SAVINGS:6'))

    expect(csvCalls()).toHaveLength(callsBefore)
  })

  it('keeps a savings ID when it remains in the full requested snapshot list', async () => {
    const view = render(<MapProbe ids={['SAVINGS:6', 'SAVINGS:7']} />)
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    view.rerender(<MapProbe ids={['SAVINGS:6']} />)
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('SAVINGS:6'))

    expect(screen.getByTestId('data')).not.toHaveTextContent('SAVINGS:7')
  })

  it('reports HTTP, empty-CSV and per-ID errors while allowing good IDs to settle', async () => {
    render(<MapProbe ids={['MISSING', 'EMPTY', 'DCDS']} />)

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    expect(screen.getByTestId('errors')).toHaveTextContent('MISSING')
    expect(screen.getByTestId('errors')).toHaveTextContent('HTTP 404')
    expect(screen.getByTestId('errors')).toHaveTextContent('EMPTY')
    expect(screen.getByTestId('errors')).toHaveTextContent('Chưa có dữ liệu')
    expect(screen.getByTestId('data')).toHaveTextContent('DCDS')
  })

  it('settles loading after an HTTP error instead of waiting for data forever', async () => {
    render(<MapProbe ids={['MISSING']} />)

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('errors')).toHaveTextContent('HTTP 404')
  })

  it('does not report loading for an empty ID list', async () => {
    render(<MapProbe ids={[]} />)

    expect(screen.getByTestId('loading')).toHaveTextContent('false')
  })

  it('ignores a late request result after unmount', async () => {
    let resolveSlow: ((value: MockResponse) => void) | undefined
    fetchMock.mockImplementationOnce((url: string) => {
      if (url === '/data/SLOW.csv') {
        return new Promise<MockResponse>(resolve => { resolveSlow = resolve })
      }
      return response('', false, 404)
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = render(<MapProbe ids={['SLOW']} />)
    view.unmount()

    await act(async () => {
      resolveSlow?.(response('date,price\n2024-01-01,100'))
    })

    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('reprocesses an ID when it changes from normal to dual-price mode', async () => {
    const view = render(<MapProbe ids={['GOLD_SJC']} />)
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('data')).toHaveTextContent('"price":900')

    view.rerender(<MapProbe ids={['GOLD_SJC']} dualPriceFundIds={new Set(['GOLD_SJC'])} />)
    await waitFor(() => expect(screen.getByTestId('purchase')).toHaveTextContent('"price":1100'))

    expect(csvCalls().filter(url => url.endsWith('/GOLD_SJC.csv'))).toHaveLength(2)
  })
})

describe('useFundData wrappers', () => {
  it('resets useFundSeries when fundId becomes null', async () => {
    const view = render(<SingleProbe fundId={null} />)
    expect(screen.getByTestId('single-loading')).toHaveTextContent('false')
    expect(screen.getByTestId('single-prices')).toHaveTextContent('null')
    expect(screen.getByTestId('single-error')).toHaveTextContent('null')

    view.rerender(<SingleProbe fundId="DCDS" />)
    await waitFor(() => expect(screen.getByTestId('single-loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('single-prices')).toHaveTextContent('2')

    view.rerender(<SingleProbe fundId={null} />)
    expect(screen.getByTestId('single-loading')).toHaveTextContent('false')
    expect(screen.getByTestId('single-prices')).toHaveTextContent('null')
    expect(screen.getByTestId('single-error')).toHaveTextContent('null')
  })

  it('keeps the multi-fund wrapper shape', async () => {
    render(<MultiProbe ids={['DCDS']} />)

    await waitFor(() => expect(screen.getByTestId('multi-loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('multi-data')).toHaveTextContent('true')
    expect(screen.getByTestId('multi-errors')).toHaveTextContent('true')
  })
})
