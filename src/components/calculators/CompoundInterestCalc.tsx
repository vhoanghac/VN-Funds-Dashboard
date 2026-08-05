import { useState, useMemo } from 'react'
import { compoundInterest, compoundInterestSeries } from '../../utils/calculators'
import { formatVNDFull, vndComparison } from '../../utils/vndFormat'
import { MoneyField, PercentField, YearsField, ResultRow } from './CalcFields'
import { CompoundInterestChart } from './CompoundInterestChart'

/**
 * Máy tính lãi kép, có tuỳ chọn góp thêm hàng tháng.
 *
 * Self-contained: không đọc funds, portfolio hay bất kỳ state chung nào. Nhờ vậy
 * sau này tách ra route riêng (`/may-tinh-lai-kep`) thì bê nguyên xi, không phải
 * gỡ phụ thuộc.
 *
 * Mọi ô đều có sẵn số mặc định. Form trống thì người ta đóng tab luôn, còn có sẵn
 * số thì họ sửa.
 */
export function CompoundInterestCalc() {
  const [principal, setPrincipal] = useState(100_000_000)
  const [annualRate, setAnnualRate] = useState(0.08)
  const [years, setYears] = useState(20)
  const [monthlyContribution, setMonthlyContribution] = useState(0)

  const result = useMemo(
    () => compoundInterest({ principal, annualRate, years, monthlyContribution }),
    [principal, annualRate, years, monthlyContribution],
  )

  const series = useMemo(
    () => compoundInterestSeries({ principal, annualRate, years, monthlyContribution }),
    [principal, annualRate, years, monthlyContribution],
  )

  const nhanBaoNhieuLan = result.contributions > 0 ? result.finalValue / result.contributions : 0
  const vatSoSanh = vndComparison(result.interestEarned)

  return (
    <div className="calc-body">
      <div className="dca-params-card">
        <h3 className="dca-section-title">Thông số</h3>

        <MoneyField label="Vốn ban đầu" value={principal} onChange={setPrincipal} />
        <PercentField label="Lợi nhuận mỗi năm" value={annualRate} onChange={setAnnualRate} max={50} />
        <YearsField label="Số năm đầu tư" value={years} onChange={setYears} />
        <MoneyField
          label="Góp thêm mỗi tháng"
          value={monthlyContribution}
          onChange={setMonthlyContribution}
          hint="Để 0 nếu chỉ bỏ vốn một lần rồi để yên"
        />
      </div>

      <div className="calc-result-card">
        <h3 className="dca-section-title">Sau {years} năm</h3>

        <ResultRow label="Giá trị cuối kỳ" value={formatVNDFull(result.finalValue)} primary tone="good" />
        <ResultRow label="Tổng tiền bạn đầu tư" value={formatVNDFull(result.contributions)} />
        <ResultRow label="Phần lãi kép sinh ra" value={formatVNDFull(result.interestEarned)} tone="good" />

        <p className="calc-takeaway">
          Bạn đầu tư <strong>{formatVNDFull(result.contributions)}</strong>, sau {years} năm còn lại{' '}
          <strong>{formatVNDFull(result.finalValue)}</strong>, tức là gấp{' '}
          <strong>{nhanBaoNhieuLan.toFixed(2).replace('.', ',')} lần</strong>. Phần chênh{' '}
          {formatVNDFull(result.interestEarned)} không phải do bạn nạp thêm đồng nào
          {vatSoSanh ? `, đủ mua ${vatSoSanh}` : ''}.
        </p>

        <CompoundInterestChart series={series} />
      </div>
    </div>
  )
}
