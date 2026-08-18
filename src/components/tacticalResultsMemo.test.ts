import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Canh chặn lỗi đã sửa ngày 05/08/2026: gõ vào ô "Vùng đệm" làm trang đứng hình.
 *
 * Nguyên nhân: mọi ô nhập của tab Chiến Thuật Phân Bổ giữ state ở panel cha, nên
 * mỗi phím gõ là một lần cha render lại. Khối kết quả vẽ 3 biểu đồ Recharts trên
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

/**
 * Canh chặn lỗi đã sửa ngày 08/08/2026: chọn quỹ khi màn hình đang có kết quả thì
 * trang đứng hình vài giây.
 *
 * Hai nguyên nhân chồng lên nhau. Một, `result` nằm trong `useMemo([committed,
 * fundData])`, mà chọn quỹ nào cũng làm `fundData` đổi, nên cả backtest chạy lại dù
 * người dùng chưa bấm nút. Hai, `nameA`/`nameB` truyền vào khối kết quả lấy từ tên
 * danh mục đang sống, mà tên đổi ngay khi chọn quỹ khác, nên lớp memo vỡ theo.
 *
 * Đo được sau khi sửa: chọn một quỹ mới (có tải thật file CSV về) cho 0 thay đổi DOM
 * trong khối kết quả và 0 tác vụ dài. Bấm nút thì mới tính, đo được một tác vụ 3,7
 * giây trên bản dev.
 */
describe('backtest chỉ chạy khi bấm nút, props khối kết quả lấy từ snapshot', () => {
  /** Cắt đúng đoạn JSX truyền props cho <TacticalResults ... />. */
  const jsxProps = SOURCE.match(/<TacticalResults\s([\s\S]*?)\/>/)?.[1] ?? ''

  it('lấy được đoạn JSX của TacticalResults để soi', () => {
    expect(jsxProps.length).toBeGreaterThan(0)
  })

  it('không prop nào đọc state đang sống của cha', () => {
    // Đây là chỗ dễ hỏng nhất lúc refactor: thấy sẵn `nameA` trong scope thì tiện tay
    // truyền thẳng vào, thế là lỗi quay lại y như cũ.
    for (const live of ['nameA', 'nameB', 'signalFundName', 'indicatorType', 'period', 'rsiOverbought', 'rsiOversold']) {
      expect(jsxProps).not.toMatch(new RegExp(`${live}=\\{${live}\\}`))
    }
  })

  it('mọi prop đều đi qua committed hoặc chính result đã chốt', () => {
    const propLines = jsxProps.split('\n').map(l => l.trim()).filter(l => l.includes('='))
    expect(propLines.length).toBeGreaterThanOrEqual(8)
    for (const line of propLines) {
      expect(line).toMatch(/=\{(result|committed\.)/)
    }
  })

  it('không còn useMemo tính backtest theo fundData', () => {
    expect(SOURCE).not.toMatch(/runTacticalBacktest[\s\S]{0,2000}?\}, \[committed, fundData\]\)/)
  })

  it('backtest nằm trong compute của hook và chỉ nhận snapshot', () => {
    expect(SOURCE).toMatch(/useCommittedRun\(\{[\s\S]*?compute: snapshot =>[\s\S]*?runTacticalBacktest\(/)
    expect(SOURCE).not.toMatch(/runTacticalBacktest\([\s\S]*?fundData/)
  })

  it('chỉ truyền vào engine đúng những quỹ snapshot cần, không truyền cả cache', () => {
    // Truyền cả `fundData` vào thì quỹ người dùng mới chọn thử cũng chen vào lưới
    // ngày chung, vừa chậm vừa làm kết quả phụ thuộc thứ không liên quan.
    expect(SOURCE).toMatch(/rawPrices: snapshot\.data/)
    expect(SOURCE).not.toMatch(/rawPrices: fundData/)
  })
})
