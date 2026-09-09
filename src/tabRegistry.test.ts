import { describe, expect, it } from 'vitest'
import { TAB_REGISTRY } from './tabRegistry'

describe('TAB_REGISTRY', () => {
  it('keeps simulation tabs mounted so committed results survive tab switches', () => {
    expect(TAB_REGISTRY.find(tab => tab.id === 'dca')?.keepMounted).toBe(true)
    expect(TAB_REGISTRY.find(tab => tab.id === 'stockdca')?.keepMounted).toBe(true)
  })

  it('labels the stock simulation tab as DCA Cổ phiếu', () => {
    expect(TAB_REGISTRY.find(tab => tab.id === 'stockdca')?.label).toBe('DCA Cổ phiếu')
  })

  it('labels the fund simulation tab as DCA quỹ', () => {
    expect(TAB_REGISTRY.find(tab => tab.id === 'dca')?.label).toBe('DCA quỹ')
  })
})
