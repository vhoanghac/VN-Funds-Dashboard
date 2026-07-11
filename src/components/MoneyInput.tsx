import { useState, useEffect, useLayoutEffect, useRef } from 'react'

interface MoneyInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  className?: string
}

function format(n: number): string {
  if (!n) return ''
  return n.toLocaleString('de-DE') // dùng de-DE để có dấu "." phân cách hàng nghìn
}

function parse(s: string): number {
  return parseInt(s.replace(/\./g, ''), 10) || 0
}

/** Đếm số chữ số đứng trước vị trí `pos` trong chuỗi `s` (bỏ qua dấu ".") */
function digitsBefore(s: string, pos: number): number {
  return s.slice(0, pos).replace(/[^\d]/g, '').length
}

/** Tìm vị trí trong `s` sao cho có đúng `count` chữ số đứng trước nó */
function positionForDigitCount(s: string, count: number): number {
  if (count <= 0) return 0
  let seen = 0
  for (let i = 0; i < s.length; i++) {
    if (/\d/.test(s[i]!)) {
      seen++
      if (seen === count) return i + 1
    }
  }
  return s.length
}

export function MoneyInput({ value, onChange, min = 0, className }: MoneyInputProps) {
  const [display, setDisplay] = useState(() => format(value))
  const inputRef = useRef<HTMLInputElement>(null)
  // Số chữ số cần đứng trước con trỏ sau khi format lại; null = không cần khôi phục
  const pendingCursorDigits = useRef<number | null>(null)

  // Sync nếu value thay đổi từ bên ngoài (ví dụ reset)
  useEffect(() => {
    setDisplay(format(value))
  }, [value])

  // Con trỏ phải được khôi phục theo SỐ CHỮ SỐ đứng trước nó, không phải theo
  // index ký tự thô — vì dấu "." phân cách hàng nghìn dịch chuyển vị trí mỗi
  // khi số chữ số đổi bậc (999 → 1.000). Thiếu bước này, React ghi đè .value
  // sau mỗi keystroke và trình duyệt tự đẩy con trỏ về cuối input, gây cảm
  // giác giật/nhảy khi gõ số ở giữa (không phải vấn đề hiệu năng CPU).
  useLayoutEffect(() => {
    if (pendingCursorDigits.current === null || !inputRef.current) return
    const pos = positionForDigitCount(display, pendingCursorDigits.current)
    inputRef.current.setSelectionRange(pos, pos)
    pendingCursorDigits.current = null
  }, [display])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const cursorPos = e.target.selectionStart ?? e.target.value.length
    pendingCursorDigits.current = digitsBefore(e.target.value, cursorPos)

    const raw = e.target.value.replace(/[^\d]/g, '') // chỉ giữ chữ số
    if (raw === '') {
      setDisplay('')
      onChange(0)
      return
    }
    const num = parseInt(raw, 10)
    setDisplay(num.toLocaleString('de-DE'))
    onChange(num)
  }

  function handleBlur() {
    const num = parse(display)
    const clamped = Math.max(min, num)
    setDisplay(clamped ? format(clamped) : '')
    onChange(clamped)
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      className={className}
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  )
}
