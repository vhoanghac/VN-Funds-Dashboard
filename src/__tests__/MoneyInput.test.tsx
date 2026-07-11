import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MoneyInput } from '../components/MoneyInput'

describe('MoneyInput', () => {
  it('formats value with thousand separators', () => {
    render(<MoneyInput value={1234567} onChange={() => {}} />)
    expect(screen.getByRole('textbox')).toHaveValue('1.234.567')
  })

  it('shows empty string when value is 0', () => {
    render(<MoneyInput value={0} onChange={() => {}} />)
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('calls onChange with parsed number on input', () => {
    const onChange = vi.fn()
    render(<MoneyInput value={0} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '5000' } })
    expect(onChange).toHaveBeenCalledWith(5000)
  })

  it('clears value and calls onChange(0) when input is emptied', () => {
    const onChange = vi.fn()
    render(<MoneyInput value={5000} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(0)
    expect(input).toHaveValue('')
  })

  it('clamps to min on blur', () => {
    const onChange = vi.fn()
    render(<MoneyInput value={0} onChange={onChange} min={1000} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '500' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(1000)
  })

  it('keeps cursor right after the digit just typed, instead of jumping to the end', () => {
    // Regression test cho lỗi "giật nhẹ khi gõ số ở giữa": trước khi sửa, React
    // ghi đè .value sau mỗi keystroke mà không khôi phục selectionRange, khiến
    // trình duyệt tự đẩy con trỏ về cuối input thay vì giữ đúng vị trí vừa gõ.
    function Wrapper() {
      const [value, setValue] = useState(1122334)
      return <MoneyInput value={value} onChange={setValue} />
    }
    render(<Wrapper />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input).toHaveValue('1.122.334')

    // Gõ "9" ngay sau "1.122" (index 5) -> browser chèn thành "1.1229.334"
    // và tự đẩy con trỏ tới index 6 (ngay sau ký tự vừa gõ).
    fireEvent.change(input, { target: { value: '1.1229.334', selectionStart: 6 } })

    expect(input).toHaveValue('11.229.334')
    expect(input.selectionStart).toBe(6) // ngay sau số "9", KHÔNG phải cuối chuỗi (10)
  })
})
