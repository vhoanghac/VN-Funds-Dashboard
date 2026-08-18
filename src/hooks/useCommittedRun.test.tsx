import { describe, expect, it } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useCommittedRun } from './useCommittedRun'
import type { PricePoint } from '../types'

type Snapshot = {
  params: { amount: number }
  data: Map<string, PricePoint[]>
}

function Probe({
  ready,
  valid = true,
  amount,
  data,
}: {
  ready: boolean
  valid?: boolean
  amount: number
  data: Map<string, PricePoint[]>
}) {
  const state = useCommittedRun({
    ready,
    valid,
    liveParams: { amount },
    captureSnapshot: (): Snapshot => ({
      params: { amount },
      data: new Map(data),
    }),
    compute: snapshot => snapshot.data.get('DCDS')?.[0]?.price ?? null,
  })

  return (
    <>
      <output data-testid="result">{state.result ?? 'null'}</output>
      <output data-testid="dirty">{String(state.dirty)}</output>
      <output data-testid="pending">{String(state.pendingRun)}</output>
      <output data-testid="committed-amount">{state.committed?.params.amount ?? 'null'}</output>
      <button onClick={state.run}>run</button>
      <button onClick={state.reset}>reset</button>
    </>
  )
}

function price(value: number): Map<string, PricePoint[]> {
  return new Map([['DCDS', [{ date: '2024-01-01', price: value }]]])
}

describe('useCommittedRun', () => {
  it('captures the live params and data when run is ready', async () => {
    render(<Probe ready amount={100} data={price(10)} />)

    await act(async () => { screen.getByRole('button', { name: 'run' }).click() })

    expect(screen.getByTestId('committed-amount')).toHaveTextContent('100')
    expect(screen.getByTestId('result')).toHaveTextContent('10')
    expect(screen.getByTestId('pending')).toHaveTextContent('false')
  })

  it('marks live params dirty without recomputing the committed result', async () => {
    const view = render(<Probe ready amount={100} data={price(10)} />)
    await act(async () => { screen.getByRole('button', { name: 'run' }).click() })

    view.rerender(<Probe ready amount={200} data={price(10)} />)

    expect(screen.getByTestId('dirty')).toHaveTextContent('true')
    expect(screen.getByTestId('result')).toHaveTextContent('10')
  })

  it('does not recompute when a live data Map changes identity', async () => {
    const view = render(<Probe ready amount={100} data={price(10)} />)
    await act(async () => { screen.getByRole('button', { name: 'run' }).click() })

    view.rerender(<Probe ready amount={100} data={price(99)} />)

    expect(screen.getByTestId('result')).toHaveTextContent('10')
    expect(screen.getByTestId('dirty')).toHaveTextContent('false')
  })

  it('clears the old result and commits after a pending run becomes ready', async () => {
    const view = render(<Probe ready amount={100} data={price(10)} />)
    await act(async () => { screen.getByRole('button', { name: 'run' }).click() })

    view.rerender(<Probe ready={false} amount={200} data={price(20)} />)
    await act(async () => { screen.getByRole('button', { name: 'run' }).click() })

    expect(screen.getByTestId('result')).toHaveTextContent('null')
    expect(screen.getByTestId('committed-amount')).toHaveTextContent('null')
    expect(screen.getByTestId('pending')).toHaveTextContent('true')

    view.rerender(<Probe ready amount={200} data={price(20)} />)
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('20'))
    expect(screen.getByTestId('committed-amount')).toHaveTextContent('200')
    expect(screen.getByTestId('pending')).toHaveTextContent('false')
  })

  it('reset clears both committed data and a pending run', async () => {
    const view = render(<Probe ready={false} amount={100} data={price(10)} />)
    await act(async () => { screen.getByRole('button', { name: 'run' }).click() })
    await act(async () => { screen.getByRole('button', { name: 'reset' }).click() })

    view.rerender(<Probe ready data={price(20)} amount={100} />)
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('null'))

    expect(screen.getByTestId('result')).toHaveTextContent('null')
    expect(screen.getByTestId('committed-amount')).toHaveTextContent('null')
    expect(screen.getByTestId('pending')).toHaveTextContent('false')
  })

  it('does not duplicate a pending commit after repeated clicks', async () => {
    const view = render(<Probe ready={false} amount={100} data={price(10)} />)
    const run = screen.getByRole('button', { name: 'run' })

    await act(async () => {
      run.click()
      run.click()
    })

    view.rerender(<Probe ready amount={100} data={price(10)} />)
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('10'))
    expect(screen.getByTestId('pending')).toHaveTextContent('false')
  })

  it('cancels a pending run when the live configuration becomes invalid', async () => {
    const view = render(<Probe ready={false} valid amount={100} data={price(10)} />)
    await act(async () => { screen.getByRole('button', { name: 'run' }).click() })

    view.rerender(<Probe ready={false} valid={false} amount={100} data={price(10)} />)
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('false'))

    view.rerender(<Probe ready valid amount={100} data={price(20)} />)
    expect(screen.getByTestId('result')).toHaveTextContent('null')
  })
})
