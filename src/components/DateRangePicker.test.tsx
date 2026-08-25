import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DateRangePicker } from './DateRangePicker'

describe('DateRangePicker', () => {
  it.each([
    ['7 ngày', '7d'],
    ['1 tháng', '1m'],
    ['3 tháng', '3m'],
  ])('selects the %s preset', (label, preset) => {
    const onChangeFrom = vi.fn()
    const onChangeTo = vi.fn()
    const now = new Date()
    const expected = preset === '7d'
      ? new Date(now)
      : new Date(now.getFullYear(), now.getMonth() - (preset === '1m' ? 1 : 3), now.getDate())
    if (preset === '7d') expected.setDate(now.getDate() - 7)

    render(
      <DateRangePicker
        dateFrom={null}
        dateTo={null}
        onChangeFrom={onChangeFrom}
        onChangeTo={onChangeTo}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: label }))

    expect(onChangeTo).toHaveBeenCalledWith(null)
    expect(onChangeFrom).toHaveBeenCalledWith(expected.toISOString().substring(0, 10))
  })

  it('keeps the draft date while typing and commits it on blur', () => {
    const onChangeFrom = vi.fn()
    const onChangeTo = vi.fn()

    render(
      <DateRangePicker
        dateFrom={null}
        dateTo={null}
        onChangeFrom={onChangeFrom}
        onChangeTo={onChangeTo}
      />,
    )

    const input = screen.getByLabelText('Từ ngày')
    fireEvent.change(input, { target: { value: '0020-01-02' } })

    expect(input).toHaveValue('0020-01-02')
    expect(onChangeFrom).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '2025-01-02' } })
    expect(input).toHaveValue('2025-01-02')
    expect(onChangeFrom).not.toHaveBeenCalled()

    fireEvent.blur(input)
    expect(onChangeFrom).toHaveBeenCalledWith('2025-01-02')
    expect(onChangeTo).not.toHaveBeenCalled()
  })
})
