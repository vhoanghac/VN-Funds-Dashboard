import { useState, useMemo } from 'react'
import { cagrFromValues } from '../../utils/calculators'
import { formatVNDFull } from '../../utils/vndFormat'
import { MoneyField, YearsField, ResultRow } from './CalcFields'

/**
 * Quy đổi hai mốc giá trị thành lợi nhuận kép mỗi năm (CAGR).
 *
 * Self-contained, không đọc state chung. Xem ghi chú ở CompoundInterestCalc.
 */
export function CagrCalc() {
  const [startValue, setStartValue] = useState(100_000_000)
  const [endValue, setEndValue] = useState(200_000_000)
  const [years, setYears] = useState(5)

  const cagr = useMemo(() => cagrFromValues({ startValue, endValue, years }), [startValue, endValue, years])

  const tongLoiNhuan = startValue > 0 ? endValue / startValue - 1 : 0
  const pct = (x: number) => (x * 100).toFixed(2).replace('.', ',') + '%'
  const dangLo = endValue < startValue

  return (
    <div className="calc-body">
      <div className="dca-params-card">
        <h3 className="dca-section-title">Thông số</h3>

        <MoneyField label="Giá trị lúc đầu" value={startValue} onChange={setStartValue} />
        <MoneyField label="Giá trị lúc sau" value={endValue} onChange={setEndValue} />
        <YearsField label="Số năm nắm giữ" value={years} onChange={setYears} />
      </div>

      <div className="calc-result-card">
        <h3 className="dca-section-title">Kết quả</h3>

        <ResultRow
          label="Lợi nhuận kép mỗi năm (CAGR)"
          value={pct(cagr)}
          primary
          tone={dangLo ? 'bad' : 'good'}
        />
        <ResultRow label="Tổng lời lỗ cả kỳ" value={pct(tongLoiNhuan)} tone={dangLo ? 'bad' : 'good'} />
        <ResultRow label="Chênh lệch tuyệt đối" value={formatVNDFull(endValue - startValue)} tone={dangLo ? 'bad' : 'good'} />

        {startValue <= 0 ? (
          <p className="calc-takeaway">Nhập giá trị lúc đầu lớn hơn 0 thì mới quy đổi ra CAGR được.</p>
        ) : (
          <p className="calc-takeaway">
            Trong {years} năm, khoản này {dangLo ? 'lỗ' : 'lời'} tổng cộng{' '}
            <strong>{pct(Math.abs(tongLoiNhuan))}</strong>. Chia đều ra thì mỗi năm{' '}
            {dangLo ? 'lỗ' : 'lời'} <strong>{pct(Math.abs(cagr))}</strong>.
          </p>
        )}

        <p className="calc-note">
          CAGR là con số làm phẳng. Nó trả lời câu hỏi mỗi năm lời đều đặn bao nhiêu thì ra
          đúng kết quả đó, chứ không phải năm nào cũng lời chừng ấy. Hai danh mục cùng CAGR
          {' '}{pct(Math.abs(cagr))} có thể đi hai con đường hoàn toàn khác nhau: một cái lên
          từ từ, một cái lên dựng đứng rồi sập một nửa. Muốn thấy đoạn đường thì phải nhìn
          biểu đồ, không nhìn một con số.
        </p>
      </div>
    </div>
  )
}
