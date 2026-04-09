import { useState, useEffect } from 'react'

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

export function MoneyInput({ value, onChange, min = 0, className }: MoneyInputProps) {
  const [display, setDisplay] = useState(() => format(value))

  // Sync nếu value thay đổi từ bên ngoài (ví dụ reset)
  useEffect(() => {
    setDisplay(format(value))
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
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
      type="text"
      inputMode="numeric"
      className={className}
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  )
}
