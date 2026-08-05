export interface PortfolioStats {
  name: string
  color: string
  cumReturn: number
  cagrValue: number
  stdev: number
  /**
   * CAGR ÷ biến động. `null` khi danh mục gần như không biến động (vd 100%
   * tiết kiệm ngân hàng): chia cho gần-0 không ra "hiệu quả vô hạn" mà là
   * KHÔNG ĐỊNH NGHĨA ĐƯỢC. Sharpe sinh ra để so hai tài sản đều có rủi ro,
   * áp lên tài sản không rủi ro là dùng sai thước.
   */
  sharpe: number | null
  maxDD: number
  worstWeek: number    // negative return, e.g. -0.12 = -12% in the worst single week
  worstMonth: number   // negative return, worst 4-week rolling window
}

interface Props {
  stats: PortfolioStats[]
}

export function PerformanceTable({ stats }: Props) {
  if (stats.length === 0) return null

  const bestCumReturn = Math.max(...stats.map(s => s.cumReturn))
  const bestCagr     = Math.max(...stats.map(s => s.cagrValue))
  const bestStdev    = Math.min(...stats.map(s => s.stdev))   // thấp hơn = tốt hơn
  const bestMaxDD    = Math.max(...stats.map(s => s.maxDD))   // gần 0 nhất = tốt hơn

  // Chỉ xếp hạng Sharpe giữa các danh mục THỰC SỰ có rủi ro. Danh mục không
  // biến động (sharpe = null) bị loại khỏi cuộc đua, nếu không nó luôn "thắng"
  // bằng một con số vô nghĩa.
  const sharpeValues = stats.map(s => s.sharpe).filter((v): v is number => v !== null)
  const bestSharpe = sharpeValues.length > 0 ? Math.max(...sharpeValues) : null

  const isBest = (val: number, best: number) => Math.abs(val - best) < 1e-9
  const isBestSharpe = (val: number | null) =>
    val !== null && bestSharpe !== null && isBest(val, bestSharpe)

  const winnerCagr   = stats.find(s => isBest(s.cagrValue, bestCagr))
  const winnerSharpe = stats.find(s => isBestSharpe(s.sharpe))
  const winnerDD     = stats.find(s => isBest(s.maxDD, bestMaxDD))

  return (
    <div className="perf-table-container">
      <div className="chart-header">
        <h3>Thành quả hoạt động</h3>
        <span
          className="chart-tooltip-icon"
          title="Tổng hợp các chỉ số hiệu suất của từng danh mục. Giá trị in đậm là tốt nhất trong nhóm. Sharpe = CAGR ÷ Biến động (Rf = 0%)."
        >?</span>
      </div>
      <div className="perf-table-wrap">
        <table className="perf-table">
          <thead>
            <tr>
              <th className="perf-th-name">Danh mục</th>
              <th title="Tổng lợi nhuận tích lũy từ đầu kỳ đến cuối kỳ">Lợi nhuận tích lũy</th>
              <th title="Lợi nhuận trung bình mỗi năm, quy về gốc kép (CAGR)">Hiệu suất trung bình năm</th>
              <th title="Độ biến động giá quy năm: đo mức dao động của danh mục. Thấp hơn = ổn định hơn.">Rủi ro biến động giá (quy năm)</th>
              <th title="Tỷ số Sharpe quy năm = CAGR ÷ Biến động (Rf = 0%). Cao hơn = hiệu quả sinh lời trên rủi ro tốt hơn.">Tỷ số Sharpe (quy năm)</th>
              <th title="Mức sụt giảm vốn lớn nhất từ đỉnh đến đáy trong toàn bộ kỳ. Gần 0 hơn = ít rủi ro hơn.">Mức độ sụt giảm vốn lớn nhất</th>
            </tr>
          </thead>
          <tbody>
            {stats.map(s => (
              <tr key={s.name}>
                <td className="perf-td-name">
                  <span className="perf-dot" style={{ background: s.color }} />
                  {s.name}
                </td>
                <td className={cls(s.cumReturn >= 0 ? 'perf-pos' : 'perf-neg', isBest(s.cumReturn, bestCumReturn) && 'perf-best')}>
                  {fmtPct(s.cumReturn)}
                </td>
                <td className={cls(s.cagrValue >= 0 ? 'perf-pos' : 'perf-neg', isBest(s.cagrValue, bestCagr) && 'perf-best')}>
                  {fmtPct(s.cagrValue)}
                </td>
                <td className={cls('perf-neutral', isBest(s.stdev, bestStdev) && 'perf-best')}>
                  {fmtPct(s.stdev)}
                </td>
                <td
                  className={cls('perf-neutral', isBestSharpe(s.sharpe) && 'perf-best')}
                  title={s.sharpe === null
                    ? 'Danh mục gần như không biến động nên không tính được tỷ số Sharpe: mẫu số bằng 0. Không phải hiệu quả vô hạn, mà là thước đo này không dùng được ở đây.'
                    : undefined}
                >
                  {s.sharpe === null ? '—' : s.sharpe.toFixed(2)}
                </td>
                <td className={cls('perf-neg', isBest(s.maxDD, bestMaxDD) && 'perf-best')}>
                  {fmtPct(s.maxDD)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {winnerCagr && winnerSharpe && winnerSharpe.sharpe !== null && winnerDD && stats.length > 1 && (
        <div className="chart-takeaway chart-takeaway--blue">
          <span className="chart-takeaway-icon">🏆</span>
          <div className="chart-takeaway-body">
            {winnerCagr.name === winnerSharpe.name ? (
              <>
                <strong>{winnerCagr.name}</strong> thắng cả 2 mặt: lợi nhuận cao nhất (
                <strong>{fmtPct(winnerCagr.cagrValue)}/năm</strong>) và hiệu quả rủi ro tốt nhất
                (Sharpe <strong>{winnerSharpe.sharpe.toFixed(2)}</strong>).
                {' '}Ít sụt giảm nhất là <strong>{winnerDD.name}</strong> (
                {fmtPct(winnerDD.maxDD)}).
              </>
            ) : (
              <>
                Lợi nhuận cao nhất: <strong>{winnerCagr.name}</strong> (
                <strong>{fmtPct(winnerCagr.cagrValue)}/năm</strong>). Nhưng hiệu quả sinh lời
                trên rủi ro tốt nhất thuộc về <strong>{winnerSharpe.name}</strong> (Sharpe
                {' '}<strong>{winnerSharpe.sharpe.toFixed(2)}</strong>), ít sụt giảm nhất
                {' '}<strong>{winnerDD.name}</strong> ({fmtPct(winnerDD.maxDD)}).
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function fmtPct(value: number): string {
  return (value * 100).toFixed(2) + '%'
}

function cls(...args: (string | false | undefined | null)[]): string {
  return args.filter(Boolean).join(' ')
}
