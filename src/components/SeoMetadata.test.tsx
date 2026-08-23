import { render } from '@testing-library/react'
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
    `
  })

  it('updates the document metadata when the active tab changes', () => {
    const { rerender } = render(<SeoMetadata tab="compare" />)

    expect(document.title).toBe('So sánh quỹ đầu tư Việt Nam | Fund Dashboard')
    expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      expect.stringContaining('CAGR'),
    )

    rerender(<SeoMetadata tab="calculator" />)

    expect(document.title).toBe('Máy tính đầu tư và lãi kép | Fund Dashboard')
    expect(document.head.querySelector('meta[property="og:title"]')).toHaveAttribute(
      'content',
      'Máy tính đầu tư và lãi kép | Fund Dashboard',
    )
  })
})
