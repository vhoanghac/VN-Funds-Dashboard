import { useState, useRef } from 'react'
import { DIMMED_COLOR } from '../utils/chartPlumbing'

/**
 * Trạng thái "bấm vào legend để làm mờ/hiện một series" — dùng chung cho mọi
 * chart nhiều đường. Trước đây cụm này (state + reset theo seriesKey +
 * handleLegendClick + màu DIMMED_COLOR) được copy nguyên vẹn vào 5 file chart.
 * Gom về một hook: sửa hành vi một chỗ, mọi chart ăn theo.
 */
export function useDimLegend(seriesKey: string) {
  const [dimmed, setDimmed] = useState<Set<string>>(new Set())

  // Reset khi series đổi (người dùng chọn quỹ khác) — nếu giữ trạng thái cũ thì
  // đường mới vẫn bị mờ oan. Đặt trong lúc render (không phải effect) vì cả 5
  // chart cũ đều làm vậy và việc setState ngay trong render là hợp lệ ở đây:
  // nó chỉ reset về rỗng khi key thật sự đổi, không lặp vô hạn.
  const prevKeyRef = useRef(seriesKey)
  if (prevKeyRef.current !== seriesKey) {
    prevKeyRef.current = seriesKey
    if (dimmed.size > 0) setDimmed(new Set())
  }

  function handleLegendClick(payload: { value?: string | number }) {
    const key = typeof payload.value === 'string' ? payload.value : undefined
    if (!key) return
    setDimmed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function isDimmed(name: string): boolean {
    return dimmed.has(name)
  }

  return { dimmed, handleLegendClick, isDimmed }
}

export { DIMMED_COLOR }
