import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSearchParams, BrowserRouter } from 'react-router-dom'
import { compressToEncodedURIComponent } from 'lz-string'
import { useUrlState } from './useUrlState'
import { hasDcaSharePayload, hasLsDcaSharePayload } from '../utils/shareUrl'

function Probe() {
  const { state, updateState, dcaUrlParams, lsDcaUrlParams } = useUrlState()
  const [, setSearchParams] = useSearchParams()
  return (
    <>
      <output data-testid="tab">{state.tab}</output>
      <output data-testid="dca-amount">{dcaUrlParams.parsedPayload?.initialAmount ?? 'null'}</output>
      <output data-testid="lsdca-capital">{lsDcaUrlParams.parsedPayload?.totalCapital ?? 'null'}</output>
      <button onClick={() => updateState({ tab: 'lsdca' })}>LS-DCA</button>
      <button onClick={() => updateState({ tab: 'dca' })}>DCA</button>
      <button onClick={() => updateState({ tab: 'compare' })}>Compare</button>
      <button
        onClick={() => setSearchParams({
          tab: 'dca',
          s: compressToEncodedURIComponent(JSON.stringify({ i: 2_000_000 })),
        })}
      >
        Load second DCA link
      </button>
      <button
        onClick={() => setSearchParams({
          tab: 'lsdca',
          s: compressToEncodedURIComponent(JSON.stringify({ cap: 300_000_000 })),
        })}
      >
        Load second LS-DCA link
      </button>
    </>
  )
}

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

describe('useUrlState share payload ownership', () => {
  it('removes a DCA payload before switching to LS-DCA', async () => {
    window.history.replaceState({}, '', '/?tab=dca&s=not-actually-compressed')
    const user = userEvent.setup()

    render(
      <BrowserRouter>
        <Probe />
      </BrowserRouter>,
    )

    expect(hasDcaSharePayload()).toBe(true)
    await user.click(screen.getByRole('button', { name: 'LS-DCA' }))

    expect(screen.getByTestId('tab')).toHaveTextContent('lsdca')
    expect(window.location.search).toBe('?tab=lsdca')
    expect(hasDcaSharePayload()).toBe(false)
    expect(hasLsDcaSharePayload()).toBe(false)
  })

  it('removes an LS-DCA payload before switching back to DCA', async () => {
    window.history.replaceState({}, '', '/?tab=lsdca&s=not-actually-compressed')
    const user = userEvent.setup()

    render(
      <BrowserRouter>
        <Probe />
      </BrowserRouter>,
    )

    expect(hasLsDcaSharePayload()).toBe(true)
    await user.click(screen.getByRole('button', { name: 'DCA' }))

    expect(screen.getByTestId('tab')).toHaveTextContent('dca')
    expect(window.location.search).toBe('?tab=dca')
    expect(hasDcaSharePayload()).toBe(false)
    expect(hasLsDcaSharePayload()).toBe(false)
  })

  it('removes legacy payload keys as well as compact payloads', async () => {
    window.history.replaceState({}, '', '/?tab=dca&init=1000&freq=monthly&from=2020-01-01&p1=DCDS:100')
    const user = userEvent.setup()

    render(
      <BrowserRouter>
        <Probe />
      </BrowserRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'LS-DCA' }))

    expect(window.location.search).toBe('?tab=lsdca')
  })

  it('preserves global date filters when DCA has no share payload', async () => {
    window.history.replaceState({}, '', '/?tab=dca&from=2020-01-01&to=2024-01-01')
    const user = userEvent.setup()

    render(
      <BrowserRouter>
        <Probe />
      </BrowserRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Compare' }))

    expect(window.location.search).toBe('?tab=compare&from=2020-01-01&to=2024-01-01')
  })

  it('reparses a new DCA share payload when the URL changes', async () => {
    window.history.replaceState({}, '', `/?tab=dca&s=${compressToEncodedURIComponent(JSON.stringify({ i: 1_000_000 }))}`)
    const user = userEvent.setup()

    render(
      <BrowserRouter>
        <Probe />
      </BrowserRouter>,
    )

    expect(screen.getByTestId('dca-amount')).toHaveTextContent('1000000')
    await user.click(screen.getByRole('button', { name: 'Load second DCA link' }))

    expect(screen.getByTestId('dca-amount')).toHaveTextContent('2000000')
  })

  it('reparses a new LS-DCA share payload when the URL changes', async () => {
    window.history.replaceState({}, '', `/?tab=lsdca&s=${compressToEncodedURIComponent(JSON.stringify({ cap: 200_000_000 }))}`)
    const user = userEvent.setup()

    render(
      <BrowserRouter>
        <Probe />
      </BrowserRouter>,
    )

    expect(screen.getByTestId('lsdca-capital')).toHaveTextContent('200000000')
    await user.click(screen.getByRole('button', { name: 'Load second LS-DCA link' }))

    expect(screen.getByTestId('lsdca-capital')).toHaveTextContent('300000000')
  })
})
