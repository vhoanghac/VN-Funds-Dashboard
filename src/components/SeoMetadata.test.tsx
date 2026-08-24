import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { SeoMetadata } from './SeoMetadata'

describe('SeoMetadata', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta name="description" content="" />
      <meta property="og:title" content="" />
      <meta property="og:description" content="" />
      <meta name="twitter:title" content="" />
      <meta name="twitter:description" content="" />
      <meta name="robots" content="" />
    `
    document.title = ''
  })

  it('updates the document metadata when the active tab changes', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <SeoMetadata tab="compare" />
      </MemoryRouter>,
    )

    expect(document.title).toBe('So sánh quỹ mở và ETF Việt Nam | Fund Dashboard')
    expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      expect.stringContaining('CAGR'),
    )

    unmount()
    render(
      <MemoryRouter initialEntries={['/?tab=calculator']}>
        <SeoMetadata tab="calculator" />
      </MemoryRouter>,
    )

    expect(document.title).toBe('Máy tính đầu tư và lãi kép | Fund Dashboard')
    expect(document.head.querySelector('meta[property="og:title"]')).toHaveAttribute(
      'content',
      'Máy tính đầu tư và lãi kép | Fund Dashboard',
    )
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://fund.vohoanghac.com/',
    )
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow')
  })

  it('marks shared state URLs as non-indexable and canonicalizes them to the base tab', () => {
    render(
      <MemoryRouter initialEntries={['/?tab=dca&funds=DCDS,E1VFVN30&from=2020-01-01']}>
        <SeoMetadata tab="dca" />
      </MemoryRouter>,
    )

    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow')
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://fund.vohoanghac.com/',
    )
  })
})
