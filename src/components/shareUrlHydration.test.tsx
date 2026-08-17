import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, useSearchParams } from 'react-router-dom'
import { compressToEncodedURIComponent } from 'lz-string'
import { DCAPanel } from './DCAPanel'
import { LumpSumDCAPanel } from './LumpSumDCAPanel'
import { useUrlState } from '../hooks/useUrlState'
import { loadLS, saveLS } from '../utils/localStorage'

function DcaHarness() {
  const { dcaUrlParams } = useUrlState()
  const [, setSearchParams] = useSearchParams()
  return (
    <>
      <DCAPanel funds={[]} active shareUrl={dcaUrlParams} />
      <button onClick={() => setSearchParams({
        tab: 'dca',
        s: compressToEncodedURIComponent(JSON.stringify({ i: 2_000_000 })),
      })}>
        Replace DCA link
      </button>
    </>
  )
}

function LsDcaHarness() {
  const { lsDcaUrlParams } = useUrlState()
  const [, setSearchParams] = useSearchParams()
  return (
    <>
      <LumpSumDCAPanel funds={[]} active shareUrl={lsDcaUrlParams} />
      <button onClick={() => setSearchParams({
        tab: 'lsdca',
        s: compressToEncodedURIComponent(JSON.stringify({ cap: 200_000_000 })),
      })}>
        Replace LS-DCA link
      </button>
    </>
  )
}

function firstMoneyInput(): HTMLInputElement {
  return document.querySelector('.dca-amount-input input') as HTMLInputElement
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('share URL hydration', () => {
  it('rehydrates DCA inputs without persisting the shared values', async () => {
    saveLS('dca_initialAmount', 9_000_000)
    window.history.replaceState({}, '', `/?tab=dca&s=${compressToEncodedURIComponent(JSON.stringify({ i: 1_000_000 }))}`)
    const user = userEvent.setup()

    render(
      <BrowserRouter>
        <DcaHarness />
      </BrowserRouter>,
    )

    expect(firstMoneyInput().value).toBe('1.000.000')
    await user.click(screen.getByRole('button', { name: 'Replace DCA link' }))
    await waitFor(() => expect(firstMoneyInput().value).toBe('2.000.000'))

    expect(loadLS('dca_initialAmount', 0)).toBe(9_000_000)
  })

  it('rehydrates LS-DCA inputs without persisting the shared values', async () => {
    saveLS('lsdca_totalCapital', 900_000_000)
    window.history.replaceState({}, '', `/?tab=lsdca&s=${compressToEncodedURIComponent(JSON.stringify({ cap: 100_000_000 }))}`)
    const user = userEvent.setup()

    render(
      <BrowserRouter>
        <LsDcaHarness />
      </BrowserRouter>,
    )

    expect(firstMoneyInput().value).toBe('100.000.000')
    await user.click(screen.getByRole('button', { name: 'Replace LS-DCA link' }))
    await waitFor(() => expect(firstMoneyInput().value).toBe('200.000.000'))

    expect(loadLS('lsdca_totalCapital', 0)).toBe(900_000_000)
  })
})
