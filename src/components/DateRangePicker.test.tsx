import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DateRangePicker } from './DateRangePicker'

describe('DateRangePicker', () => {
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
