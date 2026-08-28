/**
 * DcaStormBlock: "Kiên trì qua bão".
 *
 * Retail VN không quen nhìn max drawdown. Họ cảm nhận trực tiếp tâm lý:
 * "Lúc tệ nhất tôi lỗ bao nhiêu? Mất bao lâu để hồi phục?"
 *
 * Block này kể lại cơn bão tệ nhất trong kỳ DCA, có reference
 * giai đoạn bear lịch sử VN (2018-2019, COVID 3/2020, 2022).
 */
import { useMemo, memo, useState } from 'react'
import {
  Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Line, LineChart, ReferenceLine,
} from 'recharts'
import type { DCAStormStats } from '../utils/dca'
import {
  drawdownEpisodes,
  drawdownEpisodesFromValueSeries,
  recoveryPercentFromDrawdown,
  summarizeDrawdownEpisodes,
} from '../utils/drawdownStats'
import type { DrawdownEpisode } from '../utils/drawdownStats'
import { daysBetween } from '../utils/dateMath'
import { DcaBlock } from './DcaLayout'
import { DcaRecoveryChart } from './DcaRecoveryChart'

export interface StormPortfolio {
  id: string
  name: string
  color: string
  assetCount: number
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
  const singlePortfolioEpisodes = portfolios.length === 1
    ? drawdownEpisodes(portfolios[0]!.drawdown)
    : []

  // Nếu không có portfolio nào có bão đáng kể
  if (stormed.length === 0) {
    const worstDD = Math.min(...portfolios.map(p => p.storm.maxDrawdown))
    return (
      <DcaBlock title="⛅ Giai đoạn êm ả">
        <p className="dca-storm-calm-text">
          Suốt kỳ đầu tư này, danh mục không trải qua cơn bão nào đáng kể.
          Drawdown tệ nhất chỉ <strong>{(worstDD * 100).toFixed(1)}%</strong>.
          Thị trường chứng khoán Việt Nam là thị trường cận biên, từ bull sang
          bear diễn ra chóng vánh, có thể bạn đang ở giai đoạn thuận lợi. Đừng
          vội kết luận DCA luôn êm ả như vậy. Thử chọn khoảng thời gian dài hơn
          (bao trùm 2018-2019 hoặc 2022) để thấy bức tranh đầy đủ hơn.
        </p>
        <DrawdownSummaryTable episodes={singlePortfolioEpisodes} />
      </DcaBlock>
    )
  }

  // Tìm portfolio có bão tệ nhất (sâu nhất)
  const worst = [...stormed].sort((a, b) => a.storm.maxDrawdown - b.storm.maxDrawdown)[0]!
  const s = worst.storm
  const bearName = s.inBearPeriod ? BEAR_LABEL[s.inBearPeriod] : null

  return (
    <>
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
      <DcaRecoveryChart portfolios={portfolios} />
      <DrawdownSummaryTable episodes={singlePortfolioEpisodes} />

      <DrawdownEpisodesSection portfolios={portfolios} />

    </>
  )
}

export const DcaStormBlock = memo(DcaStormBlockImpl)

function DrawdownSummaryTable({ episodes }: { episodes: ReturnType<typeof drawdownEpisodes> }) {
  if (episodes.length === 0) return null

  const summary = summarizeDrawdownEpisodes(episodes)
  const rows = [
    { label: 'Thấp nhất', key: 'minimum' as const },
    { label: 'Trung vị', key: 'median' as const },
    { label: 'Trung bình', key: 'average' as const },
    { label: 'Sâu nhất', key: 'maximum' as const },
  ]

  return (
      <DcaBlock title="Tóm tắt drawdown" className="dca-drawdown-summary">
      <div className="dca-storm-chart-sub">
        Độ sâu đo từ đỉnh cũ xuống đáy. Thời gian đến đáy tính từ đỉnh đến đáy.
        Thời gian hồi phục tính từ đáy lên đỉnh cũ.
      </div>
      <div className="dca-stats-table-scroll">
        <table className="dca-stats-table dca-drawdown-summary-table">
          <thead>
            <tr>
              <th scope="col">Chỉ số</th>
              <th scope="col">Độ sâu</th>
              <th scope="col">Thời gian đến đáy</th>
              <th scope="col">Thời gian hồi phục</th>
              <th scope="col">Thời gian dưới đỉnh</th>
              <th scope="col">Trung bình drawdown</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td className="dca-loss">{formatSummaryPercent(summary.depth[row.key])}</td>
                <td>{formatSummaryDuration(summary.timeToTroughDays[row.key])}</td>
                <td>{formatSummaryDuration(summary.recoveryDays[row.key])}</td>
                <td>{formatSummaryDuration(summary.totalDays[row.key])}</td>
                <td className="dca-loss">{formatSummaryPercent(summary.averageDrawdown[row.key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dca-eoy-footnote">
        * Thời gian hồi phục chỉ tính các đợt đã quay lại đỉnh cũ. Các thống kê còn lại vẫn
        tính cả đợt đang diễn ra.
      </div>
      </DcaBlock>
  )
}

function formatSummaryPercent(value: number | null): string {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`
}

function formatSummaryDuration(days: number | null): string {
  if (days === null) return '-'
  if (days >= 365) return `${(days / 365.25).toFixed(1).replace('.', ',')} năm`
  if (days >= 60) return `${(days / 30.44).toFixed(1).replace('.', ',')} tháng`
  return `${Math.round(days)} ngày`
}

/**
 * MarketDrawdownChart: DD của giá quỹ (TWRR, đã loại noise cashflow).
 *
 * Phản ánh đúng "bão thị trường": giá quỹ sập bao nhiêu % từ đỉnh. Con số khớp
 * với stat "Drawdown tệ nhất -X%" trong storm stats.
 */
function MarketDrawdownChart({ portfolios }: { portfolios: StormPortfolio[] }) {
  // Với danh mục nhiều quỹ, không gọi drawdown của cả danh mục là "giá quỹ".
  if (portfolios.length !== 1 || portfolios[0]!.assetCount !== 1) return null

  const { data, minDD } = useMemo(
    () => computeSeriesDD(portfolios, p => p.drawdown.map(pt => ({ date: pt.date, dd: pt.value * 100 }))),
    [portfolios],
  )

  if (data.length === 0) return null

  const floorPct = Math.floor(minDD / 5) * 5

  return (
    <DcaBlock title="Giá quỹ sập bao nhiêu?" className="dca-storm-chart">
      <div className="dca-storm-chart-sub">
        Khoảng cách từ đỉnh giá quỹ. Đây là "bão thị trường thật", đo bằng TWRR
        nên đã loại ảnh hưởng của việc bạn nạp tiền đều đặn.
      </div>
      {renderUnderwaterChart(data, portfolios, floorPct, 'mkt')}
    </DcaBlock>
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
    <DcaBlock title="Giá trị danh mục sụt giảm bao nhiêu?" className="dca-storm-chart">
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
    </DcaBlock>
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
    <ResponsiveContainer width="100%" height={350}>
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
 * DrawdownEpisodesSection: so sánh các chu kỳ drawdown trên account equity.
 *
 * Mọi episode bắt đầu tại (0 ngày, 0%) để người dùng so tốc độ rơi và thời gian
 * hồi phục mà không bị ngày lịch của từng episode che mất.
 */
function DrawdownEpisodesSection({ portfolios }: { portfolios: StormPortfolio[] }) {
  const perPortfolio = useMemo(() => portfolios.map(p => {
    // Episodes luôn đo trên giá trị danh mục, kể cả danh mục chỉ có một quỹ.
    const episodes = drawdownEpisodesFromValueSeries(p.valueSeries)
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      episodes: episodes.slice(0, 10),
      totalEpisodes: episodes.length,
    }
  }).filter(p => p.totalEpisodes > 0), [portfolios])

  if (perPortfolio.length === 0) return null

  return (
    <DcaBlock title="So sánh các chu kỳ drawdown" className="dca-episodes-section">
      <div className="dca-storm-chart-sub">
        Một đợt sụt giảm tài sản (drawdown) được tính từ lúc tài khoản đạt đỉnh, rớt xuống đáy
        và kết thúc khi phục hồi lại mức đỉnh ban đầu. Các đợt sụt giảm trên biểu đồ được đưa
        về cùng một vạch xuất phát để bạn dễ dàng so sánh đợt nào rớt nhanh hơn và mất bao lâu
        để "về bờ". Bảng bên dưới thống kê 10 đợt sụt giảm nặng nề nhất
      </div>

      {perPortfolio.map(p => (
        <div key={p.id} className="dca-episodes-portfolio">
          {portfolios.length > 1 && (
            <div className="dca-episodes-name">
              <span className="perf-dot" style={{ background: p.color }} />
              {p.name}
            </div>
            )}
          <EpisodeComparisonChart episodes={p.episodes} />
          <div className="dca-stats-table-scroll">
            <table className="dca-stats-table dca-episodes-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Đỉnh</th>
                  <th>Đáy</th>
                  <th>Hồi phục</th>
                  <th>Sụt giảm</th>
                  <th>Thời gian đến đáy</th>
                  <th>Thời gian hồi phục</th>
                  <th>Thời gian dưới đỉnh</th>
                </tr>
              </thead>
              <tbody>
                {p.episodes.map((e, i) => (
                  <tr key={e.peakDate}>
                    <td>{i + 1}</td>
                    <td>{formatMonthYear(e.peakDate)}</td>
                    <td>{formatMonthYear(e.troughDate)}</td>
                    <td>{e.recoveryDate ? formatMonthYear(e.recoveryDate) : 'chưa hồi phục'}</td>
                    <td className="dca-loss">{(e.depth * 100).toFixed(1)}%</td>
                    <td>{formatEpisodeDuration(e.timeToTroughDays)}</td>
                    <td>{e.recoveryDays === null ? 'chưa hồi phục' : formatEpisodeDuration(e.recoveryDays)}</td>
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
    </DcaBlock>
  )
}

interface EpisodeChartRow {
  elapsedDays: number
  [key: string]: number | null
}

const EPISODE_COLORS = ['#b45309', '#2563eb', '#0f766e', '#7c3aed', '#be123c', '#4d7c0f', '#c2410c', '#0369a1', '#86198f', '#52525b']

function EpisodeComparisonChart({ episodes }: { episodes: DrawdownEpisode[] }) {
  const [hoveredEpisodeIndex, setHoveredEpisodeIndex] = useState<number | null>(null)
  const { data, minDD } = useMemo(() => {
    const rows = new Map<number, EpisodeChartRow>()
    episodes.forEach((episode, index) => {
      const key = episodeKey(index)
      for (const point of episode.points) {
        const elapsedDays = daysBetween(episode.peakDate, point.date)
        const row = rows.get(elapsedDays) ?? { elapsedDays }
        row[key] = point.value * 100
        rows.set(elapsedDays, row)
      }
    })
    const data = [...rows.values()].sort((a, b) => a.elapsedDays - b.elapsedDays)
    const minDD = Math.min(...episodes.map(episode => episode.depth * 100), -5)
    return { data, minDD: Math.floor(minDD / 5) * 5 }
  }, [episodes])

  return (
    <div className="dca-episodes-chart">
      <div className="dca-episodes-chart-title">Chu kỳ bắt đầu từ cùng một đỉnh</div>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            type="number"
            dataKey="elapsedDays"
            domain={[0, 'dataMax']}
            tickFormatter={formatElapsedDays}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            minTickGap={36}
          />
          <YAxis
            domain={[minDD, 0]}
            tickFormatter={value => `${value}%`}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            width={44}
          />
          <Tooltip
            shared={false}
            content={<EpisodeTooltip episodes={episodes} hoveredEpisodeIndex={hoveredEpisodeIndex} />}
            labelFormatter={value => `Sau ${formatElapsedDays(Number(value))}`}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1} />
          {episodes.map((episode, index) => (
            <Line
              key={episodeKey(index)}
              type="monotone"
              dataKey={episodeKey(index)}
              name={`Đỉnh ${formatMonthYear(episode.peakDate)}`}
              stroke={hoveredEpisodeIndex === null
                ? '#9a9890'
                : hoveredEpisodeIndex === index
                  ? EPISODE_COLORS[index % EPISODE_COLORS.length]
                  : '#d8d5ca'}
              strokeWidth={hoveredEpisodeIndex === index ? 2.8 : 1.5}
              strokeOpacity={hoveredEpisodeIndex !== null && hoveredEpisodeIndex !== index ? 0.8 : 1}
              dot={false}
              activeDot={hoveredEpisodeIndex === index ? { r: 4, strokeWidth: 1, fill: '#fff' } : false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
          {episodes.map((_, index) => (
            <Line
              key={`hit-${episodeKey(index)}`}
              className="dca-episodes-hit-line"
              type="monotone"
              dataKey={episodeKey(index)}
              stroke="transparent"
              strokeWidth={18}
              strokeOpacity={0.001}
              dot={false}
              activeDot={false}
              connectNulls
              onMouseEnter={() => setHoveredEpisodeIndex(index)}
              onMouseLeave={() => setHoveredEpisodeIndex(null)}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

interface EpisodeTooltipProps {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number }>
  label?: number | string
  episodes: DrawdownEpisode[]
  hoveredEpisodeIndex: number | null
}

function EpisodeTooltip({ active, payload, label, episodes, hoveredEpisodeIndex }: EpisodeTooltipProps) {
  if (!active || hoveredEpisodeIndex === null || label === undefined) return null
  const episode = episodes[hoveredEpisodeIndex]
  if (!episode) return null
  const entry = payload?.find(item => item.dataKey === episodeKey(hoveredEpisodeIndex))
  if (!entry || typeof entry.value !== 'number') return null

  return (
    <div className="dca-episodes-tooltip">
      <strong>Đỉnh {formatMonthYear(episode.peakDate)} → {episode.recoveryDate ? `hồi phục ${formatMonthYear(episode.recoveryDate)}` : 'đang diễn ra'}</strong>
      <div>Tổng thời gian: {formatEpisodeDuration(episode.totalDays)}</div>
      <div>Sau {formatElapsedDays(Number(label))}: <strong>{entry.value.toFixed(1)}%</strong></div>
    </div>
  )
}

function episodeKey(index: number): string {
  return `episode_${index}`
}

function formatElapsedDays(days: number): string {
  if (days >= 365) return `${(days / 365.25).toFixed(1)} năm`
  if (days >= 60) return `${Math.round(days / 30.44)} tháng`
  return `${Math.round(days)} ngày`
}

/**
 * % cần tăng để hòa vốn sau 1 đợt sụt giảm. Toán học bất đối xứng của
 * drawdown: -42% cần +72% mới về lại đỉnh cũ, -82% cần +456%. Vì vậy
 * drawdown quan trọng ngang lợi nhuận, không chỉ là con số phụ.
 */
function recoveryNeededPct(maxDrawdown: number): number {
  return recoveryPercentFromDrawdown(maxDrawdown) ?? 0
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

/** "15/03/2020" → "03/2020" */
function formatMonthYear(dateStr: string): string {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length < 3) return dateStr
  return `${parts[1]}/${parts[0]}`
}
