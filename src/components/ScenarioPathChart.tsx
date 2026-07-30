import { memo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { PathPoint, LSvsDCAScenario } from '../utils/lsVsDca'

import { formatVND, formatVNDFull } from '../utils/vndFormat'

interface Props {
  path: PathPoint[]
  /** Toàn bộ kịch bản, sắp theo ngày, dùng cho thanh trượt. */
  scenarios: LSvsDCAScenario[]
  worstStart: string
  medianStart: string
  bestStart: string
  selectedStart: string
  onSelectStart: (startDate: string) => void
  totalCapital: number
  dcaMonths: number
}

function fmtMonth(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(0, 4)}`
}

/**
 * Một tháng khởi đầu cụ thể chạy ra sao.
 *
 * Heatmap và bảng chi phí đều là con số gộp của hàng nghìn lần thử. Người đọc
 * gật đầu với con số gộp nhưng vẫn không hình dung được chuyện gì xảy ra với
 * tiền của mình. Khối này phóng to đúng một lần thử: hai đường tiền đi song
 * song từ cùng một điểm xuất phát, tách ra ở đâu, gặp lại nhau lúc nào.
 *
 * Ba nút chọn sẵn lấy thẳng từ danh sách kịch bản của histogram, nên đây chính
 * là một cột trong histogram được mở ra xem bên trong.
 */
function ScenarioPathChartImpl({
  path, scenarios, worstStart, medianStart, bestStart,
  selectedStart, onSelectStart, totalCapital, dcaMonths,
}: Props) {
  if (path.length === 0) return null

  const last = path[path.length - 1]!
  const diffMoney = last.dcaValue - last.lsValue
  const dcaWon = diffMoney > 0

  // Khoảng cách lớn nhất giữa hai đường trong kỳ, để nói về đoạn giữa chứ
  // không chỉ nói về đích. Đây là chỗ người DCA thấy sốt ruột nhất.
  const widestGap = path.reduce((acc, p) => {
    const gap = p.lsValue - p.dcaValue
    return Math.abs(gap) > Math.abs(acc.gap) ? { gap, date: p.date } : acc
  }, { gap: 0, date: path[0]!.date })

  const selectedIdx = scenarios.findIndex(s => s.startDate === selectedStart)

  const presets: [string, string, string][] = [
    ['Tệ nhất cho đầu tư một lần', worstStart, 'Tháng khởi đầu mà đầu tư một lần thua DCA đậm nhất'],
    ['Thường gặp', medianStart, 'Tháng khởi đầu nằm giữa, không may cũng không rủi'],
    ['Tốt nhất cho đầu tư một lần', bestStart, 'Tháng khởi đầu mà đầu tư một lần thắng DCA đậm nhất'],
  ]

  return (
    <div className="perf-table-container">
      <div className="chart-header">
        <h3>Bắt đầu đúng vào một tháng thì khoản đầu tư sẽ ra sao?</h3>
        <span
          className="chart-tooltip-icon"
          title="Cùng số vốn, cùng ngày bắt đầu, cùng ngày kết thúc. Đường DCA cộng cả phần tiền chưa giải ngân, nên hai đường xuất phát từ cùng một điểm."
        >?</span>
      </div>

      <p className="holdcost-intro">
        Những biểu đồ trên là kết quả của việc gộp hàng nghìn lần thử. Còn biểu đồ bên dưới
        cho bạn biết 1 trường hợp duy nhất mà bạn muốn xem kết quả.
        Bạn đầu tư <strong>{formatVND(totalCapital)}</strong> vào
        tháng <strong>{fmtMonth(selectedStart)}</strong>, một bên đầu tư hết ngay, bên kia chia
        đều {dcaMonths} tháng, cả hai cùng bán vào tháng <strong>{fmtMonth(last.date)}</strong>.
      </p>

      <div className="scnpath-presets">
        {presets.map(([label, date, hint]) => (
          <button
            key={label}
            className={`lsdca-horizon-btn ${selectedStart === date ? 'lsdca-horizon-btn-active' : ''}`}
            onClick={() => onSelectStart(date)}
            title={hint}
          >
            {label}
            <span className="scnpath-preset-date">{fmtMonth(date)}</span>
          </button>
        ))}
      </div>

      <div className="scnpath-slider-row">
        <span className="scnpath-slider-label">Kéo để đổi tháng bắt đầu</span>
        <input
          type="range"
          className="scnpath-slider"
          min={0}
          max={scenarios.length - 1}
          value={selectedIdx < 0 ? 0 : selectedIdx}
          onChange={e => onSelectStart(scenarios[Number(e.target.value)]!.startDate)}
        />
        <span className="scnpath-slider-value">{fmtMonth(selectedStart)}</span>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={path} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickFormatter={fmtMonth}
            minTickGap={40}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => formatVND(v)}
            domain={['auto', 'auto']}
            width={64}
          />
          <Tooltip
            formatter={(value: number, name: string) => [formatVNDFull(value), name]}
            labelFormatter={(d: string) => `Ngày ${d.split('-').reverse().join('/')}`}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            iconType="line"
          />
          <ReferenceLine
            y={totalCapital}
            stroke="#9CA3AF"
            strokeDasharray="4 4"
            label={{ value: 'Vốn ban đầu', position: 'insideTopLeft', fontSize: 10, fill: '#6B7280' }}
          />
          <Line
            type="monotone"
            dataKey="lsValue"
            name="Đầu tư một lần"
            stroke="#059669"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="dcaValue"
            name="DCA, gồm cả tiền chưa giải ngân"
            stroke="#DC2626"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="scnpath-endstats">
        <div className="scnpath-endstat">
          <span className="scnpath-endstat-label">Đầu tư một lần về đích</span>
          <span className="scnpath-endstat-value lsdca-ls-color">{formatVND(last.lsValue)}</span>
        </div>
        <div className="scnpath-endstat">
          <span className="scnpath-endstat-label">DCA về đích</span>
          <span className="scnpath-endstat-value lsdca-dca-color">{formatVND(last.dcaValue)}</span>
        </div>
        <div className="scnpath-endstat">
          <span className="scnpath-endstat-label">Chênh nhau</span>
          <span className={`scnpath-endstat-value ${dcaWon ? 'cycle-pos' : 'cycle-neg'}`}>
            {dcaWon ? '+' : '−'}{formatVND(Math.abs(diffMoney))}
          </span>
        </div>
      </div>

      <div className="holdcost-note">
        <p>
          <strong>Hai đường xuất phát từ cùng một chỗ.</strong> Đường DCA cộng cả phần tiền
          chưa giải ngân, vì tiền chưa mua quỹ thì vẫn còn nguyên trong túi bạn.
        </p>
        <p>
          Bắt đầu tháng {fmtMonth(selectedStart)}, sau{' '}
          {dcaMonths} tháng góp thì bên DCA mới đầu tư hết vốn vào thị trường. Tới ngày bán,
          bên đầu tư một lần cầm <strong>{formatVND(last.lsValue)}</strong>, bên DCA
          cầm <strong>{formatVND(last.dcaValue)}</strong>.{' '}
          {dcaWon
            ? <>DCA hơn <strong>{formatVND(Math.abs(diffMoney))}</strong>. Rải tiền có lợi ở
              đoạn này, vì thị trường xuống sau ngày bắt đầu nên phần vốn góp sau mua được
              giá rẻ hơn.</>
            : <>Đầu tư một lần hơn <strong>{formatVND(Math.abs(diffMoney))}</strong>. Phần
              tiền ngồi chờ của bên DCA lỡ mất đoạn tăng.</>}
        </p>
        {Math.abs(widestGap.gap) > Math.abs(diffMoney) * 1.2 && (
          <p>
            <strong>Đoạn giữa còn khó chịu hơn lúc về đích.</strong> Vào tháng{' '}
            {fmtMonth(widestGap.date)}, hai bên cách nhau{' '}
            <strong>{formatVND(Math.abs(widestGap.gap))}</strong>, rộng hơn khoảng cách lúc
            bán. Đó là con số bạn phải nhìn hàng ngày trên tài khoản, và cũng là chỗ nhiều
            người bỏ cuộc giữa chừng.
          </p>
        )}
      </div>
    </div>
  )
}

export const ScenarioPathChart = memo(ScenarioPathChartImpl)
