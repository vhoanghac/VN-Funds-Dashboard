/**
 * Ô nhập lãi suất cho tài sản "tiết kiệm ngân hàng".
 *
 * Lãi suất được mã hoá thẳng trong id ("SAVINGS:6"), nên mỗi lần đổi số là
 * đổi luôn id tài sản, kéo theo sinh lại toàn bộ chuỗi giá và căn lại lưới
 * ngày của cả màn hình. Vì vậy ô này giữ state gõ riêng và chỉ đẩy giá trị
 * lên trên sau 300ms ngừng gõ hoặc khi rời khỏi ô, thay vì mỗi phím gõ.
 *
 * Dùng chung ở các tab: DCA, So Sánh, Tái Cân Bằng, Bitcoin.
 */
import { useEffect, useRef, useState } from 'react'
import { parseSavingsRate } from '../utils/savingsAsset'

interface Props {
  /** Id tài sản tiết kiệm hiện tại, dạng "SAVINGS:<rate>". */
  fundId: string
  /** Gọi khi người dùng chốt một mức lãi suất mới (%/năm). */
  onCommit: (rate: number) => void
  className?: string
}

export function SavingsRateInput({ fundId, onCommit, className = 'portfolio-rate-input' }: Props) {
  const [text, setText] = useState(() => String(parseSavingsRate(fundId)))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Đồng bộ lại khi fundId đổi từ bên ngoài (vd người dùng chọn quỹ khác rồi quay lại)
  useEffect(() => {
    setText(String(parseSavingsRate(fundId)))
  }, [fundId])

  // Dọn timer khi unmount, tránh commit vào component đã biến mất
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  function scheduleCommit(value: string) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onCommit(Math.max(0, Number(value) || 0))
    }, 300)
  }

  function flushCommit(value: string) {
    if (timerRef.current) clearTimeout(timerRef.current)
    onCommit(Math.max(0, Number(value) || 0))
  }

  return (
    <div className={className} title="Lãi suất tiết kiệm giả định, %/năm">
      <input
        type="number"
        min={0}
        max={100}
        step={0.1}
        value={text}
        onChange={e => {
          setText(e.target.value)
          scheduleCommit(e.target.value)
        }}
        onBlur={e => flushCommit(e.target.value)}
      />
      <span>%/năm</span>
    </div>
  )
}
