/**
 * DcaConsistencyBlock: "Nếu bạn hoảng loạn dừng nạp khi thấy đỏ?"
 *
 * Re-simulates DCA với biến thể hành vi: dừng nạp khi TWRR drawdown sụt sâu quá ngưỡng.
 * So sánh 3 kịch bản: (i) nạp đều đặn bất chấp, (ii) dừng khi DD < -15%, (iii) dừng khi DD < -25%.
 *
 * Mental model: retail VN điển hình không miss tháng ngẫu nhiên. Họ đóng băng lệnh nạp
 * đúng lúc thị trường giảm sâu, rồi chần chừ không dám nạp lại cho đến khi hồi phục.
 * Block này đo đạc cái giá thực của tâm lý đó, bằng chính dữ liệu lịch sử quỹ của user.
 *
 * Lưu ý: TWRR drawdown invariant với cashflow schedule, nên việc tính DD dựa trên giá
 * quỹ mà không phụ thuộc kịch bản nạp là hợp lệ.
 */
import { useMemo, memo } from 'react'
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart,
} from 'recharts'
import type { PricePoint, RebalanceFrequency } from '../types'
import { simulateDCA, type DCASlot, type DCAFrequency } from '../utils/dca'
import { formatVND } from '../utils/vndFormat'

export interface ConsistencyPortfolio {
  id: string
  name: string
  color: string
  totalInvested: number
  finalValue: number
  valueSeries: { date: string; value: number }[]
  simulationInputs: {
    filteredPrices: Map<string, PricePoint[]>
    slots: DCASlot[]
    params: { initialAmount: number; cashflowAmount: number; cashflowFreq: DCAFrequency }
    rebalFreq: RebalanceFrequency
    purchasePrices: Map<string, PricePoint[]>
  } | null
}

interface Props {
  portfolios: ConsistencyPortfolio[]
}

function DcaConsistencyBlockImpl({ portfolios }: Props) {
  if (portfolios.length === 0) return null
  const valid = portfolios.filter(p => p.simulationInputs !== null && p.valueSeries.length > 0)
  if (valid.length === 0) return null

  return (
    <div className="dca-consist-block">
      <h3 className="dca-consist-title">Nếu bạn hoảng loạn dừng đầu tư khi thấy đỏ?</h3>
      <p className="dca-consist-sub">
        Retail Việt Nam điển hình không bỏ đầu tư tháng ngẫu nhiên. Họ đóng băng lệnh đầu tư
        đúng lúc quỹ giảm sâu vì sợ mất thêm, rồi chần chừ không dám đầu tư lại cho đến khi
        hồi phục. Đây là phép đối chứng bằng chính dữ liệu quỹ của bạn: so sánh đầu tư đều
        đặn bất chấp biến động với hai biến thể hành vi dừng đầu tư khi quỹ giảm <strong>-15%</strong>{' '}
        và <strong>-25%</strong> từ đỉnh.
      </p>

      {valid.map(p => (
        <ConsistencyForPortfolio key={p.id} portfolio={p} />
      ))}
    </div>
  )
}

export const DcaConsistencyBlock = memo(DcaConsistencyBlockImpl)

function ConsistencyForPortfolio({ portfolio }: { portfolio: ConsistencyPortfolio }) {
  const scenarios = useMemo(() => {
    const inputs = portfolio.simulationInputs!
    const baseline = {
      totalInvested: portfolio.totalInvested,
      finalValue: portfolio.finalValue,
      valueSeries: portfolio.valueSeries,
      skippedCount: 0,
      skippedCash: 0,
    }
    const panic15 = runPanicStop(inputs, -0.15)
    const panic25 = runPanicStop(inputs, -0.25)
    return { baseline, panic15, panic25 }
  }, [portfolio])

  const chartData = useMemo(() => {
    type Row = { date: string; base?: number; p15?: number; p25?: number }
    const byDate = new Map<string, Row>()
    for (const pt of scenarios.baseline.valueSeries) {
      byDate.set(pt.date, { date: pt.date, base: pt.value })
    }
    for (const pt of scenarios.panic15.valueSeries) {
      const r = byDate.get(pt.date) ?? { date: pt.date }
      r.p15 = pt.value
      byDate.set(pt.date, r)
    }
    for (const pt of scenarios.panic25.valueSeries) {
      const r = byDate.get(pt.date) ?? { date: pt.date }
      r.p25 = pt.value
      byDate.set(pt.date, r)
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [scenarios])

  const baseProfit = scenarios.baseline.finalValue - scenarios.baseline.totalInvested
  const p15Profit = scenarios.panic15.finalValue - scenarios.panic15.totalInvested
  const p25Profit = scenarios.panic25.finalValue - scenarios.panic25.totalInvested

  // "Chi phí cơ hội" — KHÔNG phải so trực tiếp giá trị cuối, vì panic bỏ nạp
  // nên vốn ít hơn hẳn, làm chênh lệch bị thổi phồng bởi phần "chưa đầu tư"
  // chứ không phải do đầu tư kém. Giả định số tiền bị bỏ nạp vẫn nằm trong
  // túi bạn dưới dạng tiền mặt (không sinh lời, không mất) — cộng nó lại vào
  // giá trị cuối của kịch bản panic rồi mới so với baseline, để ra đúng phần
  // thiệt hại do mua sai thời điểm + mất lãi kép, tách khỏi việc có ít vốn hơn.
  const gap15 = scenarios.baseline.finalValue - (scenarios.panic15.finalValue + scenarios.panic15.skippedCash)
  const gap25 = scenarios.baseline.finalValue - (scenarios.panic25.finalValue + scenarios.panic25.skippedCash)

  // % lợi nhuận tích lũy (giá trị cuối ÷ đã đầu tư − 1) — cùng công thức với
  // cột "Lợi nhuận tích lũy" ở Bảng thống kê, để 2 nơi nhất quán với nhau.
  const baseReturn = scenarios.baseline.totalInvested > 0
    ? scenarios.baseline.finalValue / scenarios.baseline.totalInvested - 1 : null
  const p15Return = scenarios.panic15.totalInvested > 0
    ? scenarios.panic15.finalValue / scenarios.panic15.totalInvested - 1 : null
  const p25Return = scenarios.panic25.totalInvested > 0
    ? scenarios.panic25.finalValue / scenarios.panic25.totalInvested - 1 : null

  return (
    <div className="dca-consist-card">
      <div className="dca-consist-card-header">
        <span style={{ color: portfolio.color, fontWeight: 700 }}>{portfolio.name}</span>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatMonthYearShort}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={formatMillions}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            width={56}
          />
          <Tooltip
            labelFormatter={formatDateFull}
            formatter={(v: number, name: string) => [formatVND(Math.round(v)), labelForKey(name)]}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Line type="monotone" dataKey="base" name="base" stroke="#111827" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="p15" name="p15" stroke="#f97316" strokeWidth={1.5} dot={false} strokeDasharray="4 2" isAnimationActive={false} />
          <Line type="monotone" dataKey="p25" name="p25" stroke="#dc2626" strokeWidth={1.5} dot={false} strokeDasharray="2 2" isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>

      <div className="dca-consist-chart-legend">
        <LegendItem color="#111827" dash="" label="Đầu tư đều đặn" />
        <LegendItem color="#f97316" dash="4 2" label="Dừng đầu tư khi DD < -15%" />
        <LegendItem color="#dc2626" dash="2 2" label="Dừng đầu tư khi DD < -25%" />
      </div>

      <table className="dca-consist-table">
        <thead>
          <tr>
            <th>Kịch bản</th>
            <th>Đã đầu tư</th>
            <th>Giá trị cuối</th>
            <th>Lời ròng</th>
            <th>% Lợi nhuận</th>
            <th>
              Chi phí cơ hội
              <span
                className="dca-info-icon"
                title="Panic bỏ nạp nên đầu tư ít tiền hơn hẳn — nếu so thẳng giá trị cuối, chênh lệch sẽ bị thổi phồng bởi phần 'chưa đầu tư', không phải do đầu tư kém. Cột này giả định số tiền bị bỏ nạp vẫn nằm trong túi bạn (tiền mặt, không sinh lời), cộng lại vào giá trị cuối của panic rồi mới so với kịch bản nạp đều đặn — ra đúng phần thiệt hại do mua sai thời điểm và mất lãi kép."
              >?</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="dca-consist-row--baseline">
            <td><strong>Đầu tư đều đặn</strong></td>
            <td>{formatVND(scenarios.baseline.totalInvested)}</td>
            <td>{formatVND(Math.round(scenarios.baseline.finalValue))}</td>
            <td>{formatVND(Math.round(baseProfit))}</td>
            <td className={signClass(baseReturn)}>{formatSignedPercent(baseReturn)}</td>
            <td>baseline</td>
          </tr>
          <tr>
            <td>
              Panic -15%{' '}
              <span className="dca-consist-skip">
                ({scenarios.panic15.skippedCount} lần bỏ · giữ {formatVND(scenarios.panic15.skippedCash)} tiền mặt)
              </span>
            </td>
            <td>{formatVND(scenarios.panic15.totalInvested)}</td>
            <td>{formatVND(Math.round(scenarios.panic15.finalValue))}</td>
            <td>{formatVND(Math.round(p15Profit))}</td>
            <td className={signClass(p15Return)}>{formatSignedPercent(p15Return)}</td>
            <td className={gap15 > 0 ? 'dca-consist-gap--neg' : 'dca-consist-gap--pos'}>
              {formatGap(gap15)}
            </td>
          </tr>
          <tr>
            <td>
              Panic -25%{' '}
              <span className="dca-consist-skip">
                ({scenarios.panic25.skippedCount} lần bỏ · giữ {formatVND(scenarios.panic25.skippedCash)} tiền mặt)
              </span>
            </td>
            <td>{formatVND(scenarios.panic25.totalInvested)}</td>
            <td>{formatVND(Math.round(scenarios.panic25.finalValue))}</td>
            <td>{formatVND(Math.round(p25Profit))}</td>
            <td className={signClass(p25Return)}>{formatSignedPercent(p25Return)}</td>
            <td className={gap25 > 0 ? 'dca-consist-gap--neg' : 'dca-consist-gap--pos'}>
              {formatGap(gap25)}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="dca-note">
        * "Chi phí cơ hội" đã cộng lại phần tiền bị bỏ nạp (giả định giữ làm tiền mặt, không
        sinh lời) trước khi so với kịch bản đầu tư đều đặn — nên đây là thiệt hại thực do mua
        sai thời điểm và mất lãi kép, không lẫn với việc panic đơn giản là có ít vốn hơn.
      </p>

      <ConsistencyTakeaway
        baseFinal={scenarios.baseline.finalValue}
        gap15={gap15}
        gap25={gap25}
        skipped15={scenarios.panic15.skippedCount}
        skipped25={scenarios.panic25.skippedCount}
        skippedCash15={scenarios.panic15.skippedCash}
        skippedCash25={scenarios.panic25.skippedCash}
      />
    </div>
  )
}

function LegendItem({ color, dash, label }: { color: string; dash: string; label: string }) {
  return (
    <div className="dca-consist-legend-item">
      <svg width="22" height="10">
        <line x1="0" y1="5" x2="22" y2="5" stroke={color} strokeWidth="2" strokeDasharray={dash || undefined} />
      </svg>
      <span>{label}</span>
    </div>
  )
}

function ConsistencyTakeaway({
  baseFinal, gap15, gap25, skipped15, skipped25, skippedCash15, skippedCash25,
}: {
  baseFinal: number
  gap15: number
  gap25: number
  skipped15: number
  skipped25: number
  skippedCash15: number
  skippedCash25: number
}) {
  // Case 1: Panic không skip lần nào (không có DD vượt -15%) -> thị trường êm ả
  if (skipped15 === 0 && skipped25 === 0) {
    return (
      <div className="dca-consist-takeaway">
        Trong kỳ này quỹ không có cơn sụt nào sâu quá -15%, nên cả ba kịch bản cho kết quả
        giống nhau. Đây là giai đoạn thị trường dễ chịu, bạn chưa bị thử thách về tâm lý.
        Thử kéo dài kỳ backtest để xem mình sẽ xử lý thế nào khi có bão thật.
      </div>
    )
  }

  // Case 2: Panic ăn baseline (hiếm, xảy ra trong bear dài)
  // gap âm nghĩa là panic thắng (tránh mua thêm ở vùng giảm)
  if (gap25 < 0 && Math.abs(gap25) > baseFinal * 0.02) {
    return (
      <div className="dca-consist-takeaway">
        Trong kỳ này, việc dừng đầu tư khi quỹ giảm sâu <strong>-25%</strong> lại cho kết quả
        tốt hơn đầu tư đều đặn một chút (hơn <strong>{formatVND(Math.abs(Math.round(gap25)))}</strong>,
        đã tính cả phần tiền mặt giữ lại chứ không chỉ nhờ đầu tư ít hơn). Lý do: kỳ này quỹ có
        xu hướng đi xuống kéo dài, mua thêm ở vùng giảm bị lỗ tiếp.
        Nhưng cẩn thận trước khi kết luận rằng panic tốt. Chiến lược này chỉ thắng khi bạn
        đoán đúng rằng thị trường sẽ tiếp tục giảm, điều không ai đoán được trước. Với phần
        lớn chu kỳ dài hạn của thị trường Việt Nam, đầu tư đều đặn qua đáy là cách duy nhất
        tận dụng lãi kép sau hồi phục.
      </div>
    )
  }

  // Case 3: Panic thua baseline (trường hợp phổ biến nhất)
  const worstGap = Math.max(gap15, gap25)
  const worstLabel = gap15 >= gap25 ? '-15%' : '-25%'
  const worstSkipped = gap15 >= gap25 ? skipped15 : skipped25
  const worstSkippedCash = gap15 >= gap25 ? skippedCash15 : skippedCash25
  const gapPct = baseFinal > 0 ? (worstGap / baseFinal) * 100 : 0

  return (
    <div className="dca-consist-takeaway">
      Đầu tư đều đặn qua bão là kịch bản tốt nhất. Nếu bạn dừng đầu tư khi quỹ giảm{' '}
      <strong>{worstLabel}</strong> từ đỉnh, bạn đã bỏ lỡ{' '}
      <strong>{worstSkipped}</strong> lần đầu tư (giữ lại{' '}
      <strong>{formatVND(worstSkippedCash)}</strong> tiền mặt, không mất). Nhưng dù đã cộng lại
      đúng số tiền mặt đó, danh mục vẫn kém hơn kịch bản đầu tư đều đặn{' '}
      <strong>{formatVND(Math.round(worstGap))}</strong> (tức khoảng{' '}
      <strong>{gapPct.toFixed(1)}%</strong> giá trị cuối) — đây mới là phần thiệt hại thực,
      không tính phần vốn ít hơn. Lý do đơn giản: những lần đầu tư trong giai đoạn giảm sâu là
      những lần mua được giá rẻ nhất, và khi hồi phục chính các đơn vị đó đẻ nhiều lãi nhất.
      Dừng đầu tư đúng lúc đỏ là bỏ lỡ đáy. Đó là cái giá rất cụ thể của việc để cảm xúc điều
      khiển lệnh đầu tư.
      {gap25 > 0 && gap15 > 0 && Math.abs(gap15 - gap25) > 0 && (
        <> Chú ý: panic -25% (bỏ {skipped25} lần) thậm chí mất{' '}
        <strong>{formatVND(Math.round(gap25))}</strong>,
        panic -15% (bỏ {skipped15} lần) mất{' '}
        <strong>{formatVND(Math.round(gap15))}</strong>.
        Càng panic sớm càng bỏ lỡ nhiều cơ hội.</>
      )}
    </div>
  )
}

/**
 * Re-run DCA với skip predicate: bỏ nạp khi TWRR drawdown hiện tại <= threshold.
 * Returns summary stats + value series + count of skipped contributions.
 */
function runPanicStop(
  inputs: NonNullable<ConsistencyPortfolio['simulationInputs']>,
  threshold: number,
): {
  totalInvested: number
  finalValue: number
  valueSeries: { date: string; value: number }[]
  skippedCount: number
  /** Tiền bị bỏ nạp, giả định vẫn giữ làm tiền mặt (không sinh lời) — dùng để
   * tính "chi phí cơ hội" công bằng thay vì so thẳng giá trị cuối. */
  skippedCash: number
} {
  let skippedCount = 0
  const result = simulateDCA(
    inputs.filteredPrices,
    inputs.slots,
    inputs.params,
    inputs.rebalFreq,
    {
      skipContributionWhen: (_date, dd) => {
        if (dd <= threshold) {
          skippedCount++
          return true
        }
        return false
      },
      purchasePrices: inputs.purchasePrices,
    },
  )
  return {
    totalInvested: result.totalInvested,
    finalValue: result.finalValue,
    valueSeries: result.values,
    skippedCount,
    skippedCash: skippedCount * inputs.params.cashflowAmount,
  }
}

function labelForKey(key: string): string {
  if (key === 'base') return 'Đầu tư đều đặn'
  if (key === 'p15') return 'Panic -15%'
  if (key === 'p25') return 'Panic -25%'
  return key
}

function formatGap(gap: number): string {
  if (Math.abs(gap) < 1) return '0'
  if (gap > 0) return `-${formatVND(Math.round(gap))}`
  return `+${formatVND(Math.abs(Math.round(gap)))}`
}

function signClass(v: number | null): string {
  if (v === null) return ''
  return v >= 0 ? 'dca-profit' : 'dca-loss'
}

function formatSignedPercent(v: number | null): string {
  if (v === null) return '—'
  const pct = v * 100
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
}

function formatMillions(v: number): string {
  if (Math.abs(v) >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + 'B'
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(0) + 'M'
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(0) + 'K'
  return v.toString()
}

function formatMonthYearShort(dateStr: string): string {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  return `${parts[1]!}/${parts[0]!.slice(2)}`
}

function formatDateFull(dateStr: string): string {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  return `${parts[2]!}/${parts[1]!}/${parts[0]!}`
}
