import { StrictMode, useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { saveLS } from '../utils/localStorage'
import type { ShareUrlState } from '../utils/shareUrl'
import { useSharePersistence } from './useSharePersistence'

interface ProbeProps {
  hasPayload: boolean
  parsedPayload: string | null
  writeOnMount?: boolean
}

function Probe({ hasPayload, parsedPayload, writeOnMount = false }: ProbeProps) {
  const source: ShareUrlState<string> = {
    key: hasPayload ? 'payload' : 'none',
    hasExplicitPayload: hasPayload,
    parsedPayload: hasPayload ? parsedPayload : null,
  }
  const persistence = useSharePersistence({
    source,
  })
  const localValue = persistence.readLocal('share-probe', 'fallback')

  useEffect(() => {
    if (writeOnMount && !persistence.skipUrlPersist) saveLS('share-probe-write', 'written')
  }, [writeOnMount])

  return (
    <>
      <output data-testid="has-payload">{String(persistence.hasExplicitPayload)}</output>
      <output data-testid="parsed-payload">{persistence.parsedPayload ?? 'null'}</output>
      <output data-testid="local-value">{localValue}</output>
      <output data-testid="skip-persist">{String(persistence.skipUrlPersist)}</output>
    </>
  )
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('useSharePersistence', () => {
  it('gives an explicit URL payload precedence over localStorage', async () => {
    saveLS('share-probe', 'private')

    render(
      <StrictMode>
        <Probe hasPayload parsedPayload="from-url" />
      </StrictMode>,
    )

    expect(screen.getByTestId('has-payload')).toHaveTextContent('true')
    expect(screen.getByTestId('parsed-payload')).toHaveTextContent('from-url')
    expect(screen.getByTestId('local-value')).toHaveTextContent('fallback')
    await waitFor(() => expect(screen.getByTestId('skip-persist')).toHaveTextContent('false'))
  })

  it('keeps malformed explicit payloads from falling back to localStorage', () => {
    saveLS('share-probe', 'private')

    render(<Probe hasPayload parsedPayload={null} />)

    expect(screen.getByTestId('has-payload')).toHaveTextContent('true')
    expect(screen.getByTestId('parsed-payload')).toHaveTextContent('null')
    expect(screen.getByTestId('local-value')).toHaveTextContent('fallback')
  })

  it('reads localStorage only when there is no explicit payload', () => {
    saveLS('share-probe', 'private')

    render(<Probe hasPayload={false} parsedPayload="ignored" />)

    expect(screen.getByTestId('has-payload')).toHaveTextContent('false')
    expect(screen.getByTestId('parsed-payload')).toHaveTextContent('null')
    expect(screen.getByTestId('local-value')).toHaveTextContent('private')
    expect(screen.getByTestId('skip-persist')).toHaveTextContent('false')
  })

  it('blocks the initial persist effect while hydrating a share link', () => {
    render(
      <StrictMode>
        <Probe hasPayload parsedPayload="from-url" writeOnMount />
      </StrictMode>,
    )

    expect(localStorage.getItem('share-probe-write')).toBeNull()
  })
})
