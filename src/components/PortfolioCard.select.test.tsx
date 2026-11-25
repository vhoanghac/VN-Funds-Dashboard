import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PortfolioCard } from './PortfolioCard'
import type { PortfolioCardState } from '../types'

const PORTFOLIO: PortfolioCardState = {
  id: 'p1',
  num: 1,
  name: 'Danh mục 1',
  isNameCustom: false,
  slots: [{ fundId: 'DCDS', weight: 100 }],
  rebalFreq: 'quarterly',
}

describe('PortfolioCard rebalance menu', () => {
  it('lets the user pick the no-rebalance option', async () => {
    const onUpdate = vi.fn()
    render(
      <PortfolioCard
        portfolio={PORTFOLIO}
        pIdx={0}
        funds={[]}
        fundOptions={[{ value: 'DCDS', label: 'DCDS' }]}
        onUpdate={onUpdate}
        onRemove={() => {}}
        onAddSlot={() => {}}
        onRemoveSlot={() => {}}
        onUpdateSlot={() => {}}
        onSetEqualWeights={() => {}}
      />,
    )

    await userEvent.selectOptions(screen.getByDisplayValue('Quý'), 'none')

    expect(onUpdate).toHaveBeenCalledWith({ rebalFreq: 'none' })
  })
})
