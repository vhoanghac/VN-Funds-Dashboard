import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Canh chặn lỗi đã sửa ngày 05/08/2026: gõ vào ô "Vùng đệm" làm trang đứng hình.
 *
 * Nguyên nhân: mọi ô nhập của tab Chiến Thuật Phân Bổ giữ state ở panel cha, nên
 * mỗi phím gõ là một lần cha render lại. Khối kết quả vẽ 2 biểu đồ Recharts trên
 * toàn bộ chuỗi ngày, đo được 116ms mỗi phím. Bọc `memo` xong đo lại còn 0.
 *
 * Test quét thẳng mã nguồn thay vì render component, cùng cách với
 * `corePurity.test.ts`. Lý do: dựng được một `TacticalBacktestResult` thật để
 * render tốn nhiều công hơn giá trị nó canh, mà thứ cần canh chỉ là một dòng dễ
 * bị xoá lúc refactor.
 */
const SOURCE = readFileSync(join(__dirname, 'TacticalAllocationPanel.tsx'), 'utf8')

describe('TacticalResults phải được bọc memo', () => {
  it('có dòng memo(TacticalResultsImpl)', () => {
    expect(SOURCE).toMatch(/const\s+TacticalResults\s*=\s*memo\(\s*TacticalResultsImpl\s*\)/)
  })

  it('thân hàm nặng vẫn mang tên Impl, không bị đổi về TacticalResults', () => {
    // Nếu ai xoá lớp memo rồi đổi tên hàm về như cũ thì test trên vẫn đỏ, còn
    // test này chỉ ra đúng chỗ họ đã sửa.
    expect(SOURCE).toMatch(/function\s+TacticalResultsImpl\s*\(/)
  })

  it('panel cha cũng còn memo', () => {
    expect(SOURCE).toMatch(/export\s+const\s+TacticalAllocationPanel\s*=\s*memo\(/)
  })

  it('chỗ dùng trong JSX gọi bản đã bọc memo, không gọi thẳng bản Impl', () => {
    expect(SOURCE).toMatch(/<TacticalResults\b/)
    expect(SOURCE).not.toMatch(/<TacticalResultsImpl\b/)
  })
})
