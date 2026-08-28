import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RollingReturnBlock } from './RollingReturnBlock'

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

describe('RollingReturnBlock', () => {
  it('disables every cycle when the selected range cannot produce three windows', () => {
    render(<RollingReturnBlock portfolios={[portfolio('2023-08-28', '2026-08-27')]} />)

    for (const years of [3, 5, 7, 10]) {
      expect(screen.getByRole('button', { name: `${years} năm` })).toBeDisabled()
    }
  })

  it('enables only cycles covered by the selected range', () => {
    render(<RollingReturnBlock portfolios={[portfolio('2020-01-01', '2024-01-01')]} />)

    expect(screen.getByRole('button', { name: '3 năm' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '5 năm' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '7 năm' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '10 năm' })).toBeDisabled()
  })
})

function portfolio(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  const cumulative = []
  let index = 0

  while (start <= end) {
    cumulative.push({
      date: start.toISOString().slice(0, 10),
      value: index * 0.01,
    })
    start.setUTCMonth(start.getUTCMonth() + 1)
    index += 1
  }

  return {
    id: 'test',
    name: 'Danh mục thử',
    color: '#000000',
    cumulative,
  }
}
