/**
 * DcaStormBlock: "Kiên trì qua bão".
 *
 * Retail VN không quen nhìn max drawdown. Họ cảm nhận trực tiếp tâm lý:
 * "Lúc tệ nhất tôi lỗ bao nhiêu? Mất bao lâu để hồi phục?"
 *
 * Block này kể lại cơn bão tệ nhất trong kỳ DCA, có reference
 * giai đoạn bear lịch sử VN (2018-2019, COVID 3/2020, 2022).
 */
import { useMemo, memo } from 'react'
import {
  Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, ReferenceLine,
} from 'recharts'
import type { DCAStormStats } from '../utils/dca'
import { drawdownEpisodes } from '../utils/drawdownStats'

export interface StormPortfolio {
  id: string
  name: string
  color: string
  storm: DCAStormStats
  /** TWRR drawdown series, đã loại noise cashflow, khớp với s.maxDrawdown trong storm stats */
  drawdown: { date: string; value: number }[]
  /** Giá trị danh mục theo thời gian, để tính DD trên số dư tài khoản thực tế */
  valueSeries: { date: string; value: number }[]
}

interface Props {
  portfolios: StormPortfolio[]
}

const BEAR_LABEL: Record<NonNullable<DCAStormStats['inBearPeriod']>, string> = {
  bear2018: 'bear market 2018-2019',
  covid2020: 'cú sập COVID tháng 3/2020',
  bear2022: 'bear market 2022',
}

function DcaStormBlockImpl({ portfolios }: Props) {
  if (portfolios.length === 0) return null

  // Lọc portfolio có bão đáng kể (DD ≤ -10%)
  const stormed = portfolios.filter(p => p.storm.maxDrawdown <= -0.10)

  // Nếu không có portfolio nào có bão đáng kể
  if (stormed.length === 0) {
    const worstDD = Math.min(...portfolios.map(p => p.storm.maxDrawdown))
    return (
      <div className="dca-storm-block dca-storm-block--calm">
        <h3 className="dca-storm-title">⛅ Giai đoạn êm ả</h3>
        <p className="dca-storm-calm-text">
          Suốt kỳ đầu tư này, danh mục không trải qua cơn bão nào đáng kể.
          Drawdown tệ nhất chỉ <strong>{(worstDD * 100).toFixed(1)}%</strong>.
          Thị trường chứng khoán Việt Nam là thị trường cận biên, từ bull sang
          bear diễn ra chóng vánh, có thể bạn đang ở giai đoạn thuận lợi. Đừng
          vội kết luận DCA luôn êm ả như vậy. Thử chọn khoảng thời gian dài hơn
          (bao trùm 2018-2019 hoặc 2022) để thấy bức tranh đầy đủ hơn.
        </p>
      </div>
    )
  }

  // Tìm portfolio có bão tệ nhất (sâu nhất)
  const worst = [...stormed].sort((a, b) => a.storm.maxDrawdown - b.storm.maxDrawdown)[0]!
  const s = worst.storm
  const bearName = s.inBearPeriod ? BEAR_LABEL[s.inBearPeriod] : null

  return (
    <div className="dca-storm-block">
      <h3 className="dca-storm-title">🌊 Kiên trì qua bão</h3>
      <p className="dca-storm-sub">
        Hành trình DCA không bao giờ là một đường thẳng. Đây là những cơn bão
        mà danh mục {portfolios.length > 1 ? 'của bạn' : `${worst.name} của bạn`} đã trải qua.
      </p>

      <div className="dca-storm-grid">
        <div className="dca-storm-stat">
          <div className="dca-storm-stat-label">Drawdown tệ nhất</div>
          <div className="dca-storm-stat-value dca-storm-stat-value--neg">
            {(s.maxDrawdown * 100).toFixed(1)}%
          </div>
          <div className="dca-storm-stat-sub">
            cần +{recoveryNeededPct(s.maxDrawdown).toFixed(0)}% để hòa vốn
          </div>
          {portfolios.length > 1 && (
            <div className="dca-storm-stat-sub" style={{ color: worst.color }}>
              ở {worst.name}
            </div>
          )}
        </div>

        <div className="dca-storm-stat">
          <div className="dca-storm-stat-label">Thời điểm chạm đáy</div>
          <div className="dca-storm-stat-value">{formatMonthYear(s.maxDDDate)}</div>
          {bearName && (
            <div className="dca-storm-stat-sub">trùng {bearName}</div>
          )}
        </div>

        <div className="dca-storm-stat">
          <div className="dca-storm-stat-label">Thời gian hồi phục</div>
          <div className="dca-storm-stat-value">
            {s.recoveryMonths !== null
              ? `${s.recoveryMonths} tháng`
              : 'chưa hồi phục'}
          </div>
          {s.stormsCount > 1 && (
            <div className="dca-storm-stat-sub">tổng {s.stormsCount} cơn bão trong kỳ</div>
          )}
        </div>
      </div>

      <MarketDrawdownChart portfolios={portfolios} />
      <AccountDrawdownChart portfolios={portfolios} worstPortfolioId={worst.id} marketMaxDD={s.maxDrawdown} />

      <DrawdownEpisodesSection portfolios={portfolios} />

      <StormTakeaway storm={s} worstName={worst.name} multi={portfolios.length > 1} />
    </div>
  )
}

export const DcaStormBlock = memo(DcaStormBlockImpl)

/**
 * MarketDrawdownChart: DD của giá quỹ (TWRR, đã loại noise cashflow).
 *
 * Phản ánh đúng "bão thị trường": giá quỹ sập bao nhiêu % từ đỉnh. Con số khớp
 * với stat "Drawdown tệ nhất -X%" trong storm stats.
 */
function MarketDrawdownChart({ portfolios }: { portfolios: StormPortfolio[] }) {
  const { data, minDD } = useMemo(
    () => computeSeriesDD(portfolios, p => p.drawdown.map(pt => ({ date: pt.date, dd: pt.value * 100 }))),
    [portfolios],
  )

  if (data.length === 0) return null

  const floorPct = Math.floor(minDD / 5) * 5

  return (
    <div className="dca-storm-chart">
      <div className="dca-storm-chart-title">Giá quỹ sập bao nhiêu?</div>
      <div className="dca-storm-chart-sub">
        Khoảng cách từ đỉnh giá quỹ. Đây là "bão thị trường thật", đo bằng TWRR
        nên đã loại ảnh hưởng của việc bạn nạp tiền đều đặn.
      </div>
      {renderUnderwaterChart(data, portfolios, floorPct, 'mkt')}
    </div>
  )
}

/**
 * AccountDrawdownChart: DD của số dư tài khoản (value/peak).
 *
 * Đây là thứ user nhìn thấy thực tế: "số dư có lúc nào thấp hơn đỉnh bao nhiêu".
 * Con số này thường NÔNG hơn DD giá quỹ vì khi giá sập bạn vẫn nạp tiền, kéo peak
 * của số dư lên chậm hơn. Khoảng chênh = phần DCA "cứu vớt" được.
 */
function AccountDrawdownChart({
  portfolios,
  worstPortfolioId,
  marketMaxDD,
}: {
  portfolios: StormPortfolio[]
  worstPortfolioId: string
  marketMaxDD: number
}) {
  const { data, minDD, accountMaxDDByPortfolio } = useMemo(() => {
    const result = computeSeriesDD(portfolios, p => {
      let peak = 0
      return p.valueSeries.map(pt => {
        if (pt.value > peak) peak = pt.value
        const dd = peak > 0 ? (pt.value / peak - 1) * 100 : 0
        return { date: pt.date, dd }
      })
    })
    // Track max account DD per portfolio for commentary
    const maxByPortfolio: Record<string, number> = {}
    for (const p of portfolios) {
      let peak = 0
      let worst = 0
      for (const pt of p.valueSeries) {
        if (pt.value > peak) peak = pt.value
        const dd = peak > 0 ? (pt.value / peak - 1) * 100 : 0
        if (dd < worst) worst = dd
      }
      maxByPortfolio[p.id] = worst
    }
    return { ...result, accountMaxDDByPortfolio: maxByPortfolio }
  }, [portfolios])

  if (data.length === 0) return null

  const floorPct = Math.floor(minDD / 5) * 5

  // Commentary: so sánh market DD với account DD của portfolio tệ nhất
  const accountDD = accountMaxDDByPortfolio[worstPortfolioId] ?? 0
  const marketDDPct = Math.abs(marketMaxDD * 100)
  const accountDDPct = Math.abs(accountDD)
  const softenedBy = marketDDPct - accountDDPct
  const softenedSignificant = softenedBy > 3 // chỉ note nếu chênh đáng kể

  return (
    <div className="dca-storm-chart">
      <div className="dca-storm-chart-title">Số dư tài khoản sập bao nhiêu?</div>
      <div className="dca-storm-chart-sub">
        Khoảng cách từ đỉnh số dư tài khoản thực tế của bạn. Đây là thứ bạn thấy khi mở app quỹ.
      </div>
      {renderUnderwaterChart(data, portfolios, floorPct, 'acc')}
      {softenedSignificant && (
        <div className="dca-storm-chart-note">
          Giá quỹ sập <strong>-{marketDDPct.toFixed(1)}%</strong>, nhưng số dư tài khoản
          lúc tệ nhất chỉ <strong>-{accountDDPct.toFixed(1)}%</strong>. Khoảng chênh{' '}
          <strong>{softenedBy.toFixed(1)} điểm %</strong> là phần DCA cứu vớt: mỗi lần bạn
          nạp thêm tiền giữa bão, peak số dư được kéo lên chậm, đáy cũng không sập sâu như
          giá quỹ.
        </div>
      )}
    </div>
  )
}

interface DrawdownRow {
  date: string
  [portfolioName: string]: string | number | null
}

/** Gom DD series từ nhiều portfolio thành 1 bảng data cho Recharts. */
function computeSeriesDD(
  portfolios: StormPortfolio[],
  extractSeries: (p: StormPortfolio) => { date: string; dd: number }[],
): { data: DrawdownRow[]; minDD: number } {
  const allDates = new Set<string>()
  const ddByPortfolio: Record<string, Map<string, number>> = {}

  for (const p of portfolios) {
    const ddMap = new Map<string, number>()
    for (const pt of extractSeries(p)) {
      ddMap.set(pt.date, Math.min(pt.dd, 0))
      allDates.add(pt.date)
    }
    ddByPortfolio[p.id] = ddMap
  }

  const sortedDates = Array.from(allDates).sort()
  let minDD = 0
  const data: DrawdownRow[] = sortedDates.map(date => {
    const row: DrawdownRow = { date }
    for (const p of portfolios) {
      const v = ddByPortfolio[p.id]?.get(date) ?? null
      row[p.name] = v
      if (v !== null && v < minDD) minDD = v
    }
    return row
  })

  return { data, minDD: Math.min(minDD, -5) }
}

/** Shared chart renderer để 2 chart underwater trông giống hệt nhau. */
function renderUnderwaterChart(
  data: DrawdownRow[],
  portfolios: StormPortfolio[],
  floorPct: number,
  keyPrefix: string,
) {
  // Mỗi danh mục dùng đúng màu của nó (giống biểu đồ "Giá trị tài sản"),
  // dễ phân biệt hơn nhiều so với tô đồng loạt màu đỏ + dash pattern.
  const multi = portfolios.length > 1

  return (
    <>
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <defs>
          {portfolios.map(p => (
            <linearGradient key={p.id} id={`${keyPrefix}-grad-${p.id}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={p.color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={p.color} stopOpacity={0.03} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatMonthYearShort}
          tick={{ fontSize: 11, fill: '#6b7280' }}
          minTickGap={40}
        />
        <YAxis
          domain={[floorPct, 0]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11, fill: '#6b7280' }}
          width={44}
        />
        <Tooltip
          labelFormatter={formatDateFull}
          formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name]}
          contentStyle={{ fontSize: 12, borderRadius: 6 }}
        />
        <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1} />
        <ReferenceLine y={-10} stroke="#d1d5db" strokeDasharray="2 2" />
        {portfolios.map(p => (
          <Area
            key={p.id}
            type="monotone"
            dataKey={p.name}
            stroke={p.color}
            strokeWidth={1.8}
            fill={`url(#${keyPrefix}-grad-${p.id})`}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
    {multi && (
      <div className="dca-storm-chart-legend">
        {portfolios.map(p => (
          <div key={p.id} className="dca-storm-chart-legend-item">
            <svg width="22" height="10" aria-hidden="true">
              <line
                x1="0" y1="5" x2="22" y2="5"
                stroke={p.color}
                strokeWidth="2"
              />
            </svg>
            <span>{p.name}</span>
          </div>
        ))}
      </div>
    )}
    </>
  )
}

/**
 * DrawdownEpisodesSection: bảng "Các đợt sụt giảm lớn nhất" kiểu Testfolio.
 *
 * Khối stats phía trên chỉ kể về cơn bão TỆ NHẤT; bảng này liệt kê top 5 đợt
 * sụt ≥ 5% của từng danh mục: sâu bao nhiêu, đỉnh/đáy lúc nào, mất bao lâu để
 * vượt lại đỉnh cũ. Người mới nhìn vào sẽ thấy: sụt sâu đã từng xảy ra N lần
 * trong lịch sử, và (đa số) đều đã hồi phục.
 */
function DrawdownEpisodesSection({ portfolios }: { portfolios: StormPortfolio[] }) {
  const perPortfolio = useMemo(() => portfolios.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    episodes: drawdownEpisodes(p.drawdown).slice(0, 5),
  })).filter(p => p.episodes.length > 0), [portfolios])

  if (perPortfolio.length === 0) return null

  return (
    <div className="dca-episodes-section">
      <div className="dca-storm-chart-title">Các đợt sụt giảm lớn nhất</div>
      <div className="dca-storm-chart-sub">
        Top 5 đợt sụt từ 5% trở lên của mỗi danh mục. "Dưới đỉnh" là tổng thời
        gian từ lúc lập đỉnh đến khi vượt lại đỉnh cũ.
      </div>

      {perPortfolio.map(p => (
        <div key={p.id} className="dca-episodes-portfolio">
          {portfolios.length > 1 && (
            <div className="dca-episodes-name">
              <span className="perf-dot" style={{ background: p.color }} />
              {p.name}
            </div>
          )}
          <div className="dca-stats-table-scroll">
            <table className="dca-stats-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Sụt giảm</th>
                  <th>Từ đỉnh</th>
                  <th>Chạm đáy</th>
                  <th>Hồi phục</th>
                  <th>Dưới đỉnh</th>
                </tr>
              </thead>
              <tbody>
                {p.episodes.map((e, i) => (
                  <tr key={e.peakDate}>
                    <td>{i + 1}</td>
                    <td className="dca-loss">{(e.depth * 100).toFixed(1)}%</td>
                    <td>{formatMonthYear(e.peakDate)}</td>
                    <td>{formatMonthYear(e.troughDate)}</td>
                    <td>{e.recoveryDate ? formatMonthYear(e.recoveryDate) : 'chưa hồi phục'}</td>
                    <td>{formatEpisodeDuration(e.totalDays)}{e.recoveryDate === null ? ' *' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {perPortfolio.some(p => p.episodes.some(e => e.recoveryDate === null)) && (
        <div className="dca-eoy-footnote">
          * Đợt sụt giảm vẫn đang diễn ra, thời gian tính đến ngày dữ liệu gần nhất.
        </div>
      )}
    </div>
  )
}

/**
 * % cần tăng để hòa vốn sau 1 đợt sụt giảm. Toán học bất đối xứng của
 * drawdown: -42% cần +72% mới về lại đỉnh cũ, -82% cần +456%. Vì vậy
 * drawdown quan trọng ngang lợi nhuận, không chỉ là con số phụ.
 */
function recoveryNeededPct(maxDrawdown: number): number {
  return (1 / (1 - Math.abs(maxDrawdown)) - 1) * 100
}

/** Số ngày → "2.5 năm" / "8 tháng" / "45 ngày" */
function formatEpisodeDuration(days: number): string {
  if (days >= 365) return (days / 365.25).toFixed(1) + ' năm'
  if (days >= 60) return Math.round(days / 30.44) + ' tháng'
  return days + ' ngày'
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
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

interface TakeawayProps {
  storm: DCAStormStats
  worstName: string
  multi: boolean
}

function StormTakeaway({ storm, worstName, multi }: TakeawayProps) {
  const s = storm
  const bearName = s.inBearPeriod ? BEAR_LABEL[s.inBearPeriod] : null
  const ddPct = Math.abs(s.maxDrawdown * 100).toFixed(1)
  const recoveryPct = recoveryNeededPct(s.maxDrawdown).toFixed(0)

  // Case 1: Đã hồi phục, message kiên trì được đền đáp
  if (s.recoveryMonths !== null) {
    return (
      <div className="dca-storm-takeaway">
        <span className="dca-storm-takeaway-icon">⚓</span>
        <div>
          {multi ? (
            <>Đáy sâu nhất của danh mục <strong>{worstName}</strong> là</>
          ) : (
            <>Đáy sâu nhất là</>
          )}
          {' '}<strong>-{ddPct}%</strong> vào{' '}
          <strong>{formatMonthYear(s.maxDDDate)}</strong>
          {bearName && <>, đúng vào {bearName}</>}. Từ đáy đó, giá cần tăng{' '}
          <strong>+{recoveryPct}%</strong> chỉ để hòa vốn, sụt càng sâu thì càng khó gỡ lại.
          Nếu bạn hoảng loạn bán lúc đó, toàn bộ khoản lỗ sẽ hiện thực hóa. Nhưng bạn đã
          kiên trì nạp tiền thêm, và thị trường hồi phục về đỉnh cũ sau{' '}
          <strong>{s.recoveryMonths} tháng</strong>. Đó là lý do vì sao đầu tư đều đặn qua
          từng tháng quan trọng hơn đoán đỉnh đoán đáy thị trường.
        </div>
      </div>
    )
  }

  // Case 2: Chưa hồi phục, message thẳng thắn
  return (
    <div className="dca-storm-takeaway dca-storm-takeaway--ongoing">
      <span className="dca-storm-takeaway-icon">⛈️</span>
      <div>
        {multi ? (
          <>Danh mục <strong>{worstName}</strong> chạm đáy</>
        ) : (
          <>Danh mục chạm đáy</>
        )}
        {' '}<strong>-{ddPct}%</strong> vào <strong>{formatMonthYear(s.maxDDDate)}</strong>
        {bearName && <>, đúng vào {bearName}</>} và hiện vẫn chưa hồi phục về đỉnh cũ. Để
        hòa vốn từ đáy này, giá cần tăng <strong>+{recoveryPct}%</strong>, một lời nhắc
        rằng sụt càng sâu thì càng khó gỡ lại. Thị trường Việt Nam là thị trường cận biên,
        từ bull sang bear diễn ra chóng vánh.
        {' '}Có thể bạn đang trong giai đoạn bão. Hãy kiên trì nạp tiền đều đặn qua từng
        tháng, mua được nhiều chứng chỉ quỹ hơn khi giá thấp. Lịch sử cho thấy các bear
        market trước đây (2018-2019, 2022) đều đã hồi phục.
      </div>
    </div>
  )
}

/** "15/03/2020" → "03/2020" */
function formatMonthYear(dateStr: string): string {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  return `${parts[1]}/${parts[0]}`
}
