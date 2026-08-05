import { useState, useMemo } from 'react'
import { fundFeeErosion, fundFeeErosionSeries } from '../../utils/calculators'
import { formatVNDFull, vndComparison } from '../../utils/vndFormat'
import { MoneyField, PercentField, YearsField, ResultRow } from './CalcFields'
import { FundFeeErosionChart } from './FundFeeErosionChart'

/**
 * Phí quỹ ăn mòn bao nhiêu tài sản sau N năm.
 *
 * Self-contained, không đọc state chung. Xem ghi chú ở CompoundInterestCalc.
 */
export function FundFeeErosionCalc() {
  const [principal, setPrincipal] = useState(100_000_000)
  const [growthRate, setGrowthRate] = useState(0.10)
  const [feeRate, setFeeRate] = useState(0.02)
  const [years, setYears] = useState(20)

  const result = useMemo(
    () => fundFeeErosion({ principal, growthRate, feeRate, years }),
    [principal, growthRate, feeRate, years],
  )

  const series = useMemo(
    () => fundFeeErosionSeries({ principal, growthRate, feeRate, years }),
    [principal, growthRate, feeRate, years],
  )

  const mat = result.finalValueNoFee - result.finalValueWithFee
  const vatSoSanh = vndComparison(mat)
  const pct = (x: number) => (x * 100).toFixed(2).replace('.', ',') + '%'

  return (
    <div className="calc-body">
      <div className="dca-params-card">
        <h3 className="dca-section-title">Thông số</h3>

        <MoneyField label="Vốn đầu tư" value={principal} onChange={setPrincipal} />
        <PercentField label="Quỹ lời mỗi năm" value={growthRate} onChange={setGrowthRate} max={50} />
        <PercentField
          label="Phí quỹ mỗi năm"
          value={feeRate}
          onChange={setFeeRate}
          step={0.1}
          max={10}
          hint="Quỹ mở VN thường thu 1,5% đến 2,5%/năm"
        />
        <YearsField label="Số năm nắm giữ" value={years} onChange={setYears} />
      </div>

      <div className="calc-result-card">
        <h3 className="dca-section-title">Sau {years} năm</h3>

        <ResultRow label="Nếu không mất phí" value={formatVNDFull(result.finalValueNoFee)} />
        <ResultRow label="Thực nhận sau phí" value={formatVNDFull(result.finalValueWithFee)} primary />
        <ResultRow label="Phí lấy mất" value={formatVNDFull(mat)} tone="bad" />
        <ResultRow label="Tỷ lệ ăn mòn" value={pct(result.erosionPct)} tone="bad" />

        <p className="calc-takeaway">
          Phí {pct(feeRate)} mỗi năm nghe nhỏ. Nhưng sau {years} năm nó lấy mất{' '}
          <strong>{formatVNDFull(mat)}</strong>, tức <strong>{pct(result.erosionPct)}</strong> phần
          tài sản đáng lẽ bạn có{vatSoSanh ? `, bằng ${vatSoSanh}` : ''}.
        </p>

        <FundFeeErosionChart series={series} />

        <p className="calc-note">
          Phí quỹ thu trên tài sản ròng mỗi năm, không phải trừ vào phần lời. Vì vậy tỷ lệ ăn
          mòn không đổi dù quỹ lời nhiều hay lời ít, cũng không đổi dù bạn bỏ vào 100 triệu hay
          10 tỷ. Chỉ có hai thứ quyết định: mức phí và số năm bạn nắm giữ. Đây cũng là lý do vì
          sao chênh lệch 0,5% phí giữa hai quỹ nhìn thì không đáng gì, nhưng giữ 20 năm thì
          thành một khoản lớn.
        </p>
      </div>
    </div>
  )
}
