import { useState, useEffect, useMemo, memo } from 'react'
import Select from 'react-select'
import {
  BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, CartesianGrid, Tooltip, LabelList,
} from 'recharts'
import type { FundMeta } from '../types'
import { loadLS, saveLS } from '../utils/localStorage'
import { formatVND } from '../utils/vndFormat'
import {
  parseHoldingsCSV, parseIndustryCSV, getAvailablePeriods, resolvePeriod,
  computeOverlap, computeSectorDrift,
  type OverlapResult, type SectorDriftRow, type Holding, type AssetType,
} from '../utils/overlap'

interface Props {
  funds: FundMeta[]
}

interface HoldingsIndexEntry {
  id: string
  update_at: string
  /** Nguồn dữ liệu: 'report' = báo cáo tài chính của quỹ; 'digiinvest' = digiinvest.vn; thiếu = fmarket/vnstock. */
  source?: string
}

interface FundOption {
  value: string
  label: string
}

const DEFAULT_A = 'DCDS'
const DEFAULT_B = 'VESAF'
const POS_COLOR = '#059669'
const NEG_COLOR = '#dc2626'

const selectStyles = {
  control: (base: Record<string, unknown>) => ({
    ...base,
    minHeight: 38,
    borderColor: '#e5e7eb',
    boxShadow: 'none',
    '&:hover': { borderColor: '#2563EB' },
    fontSize: '0.95rem',
  }),
  menu: (base: Record<string, unknown>) => ({ ...base, zIndex: 20 }),
  option: (base: Record<string, unknown>, state: { isFocused: boolean; isSelected: boolean }) => ({
    ...base,
    fontSize: '0.9rem',
    backgroundColor: state.isSelected ? '#2563EB' : state.isFocused ? '#eff6ff' : undefined,
    color: state.isSelected ? 'white' : '#1a1a1a',
  }),
}

function formatPct(v: number, digits = 2): string {
  return `${v.toFixed(digits)}%`
}

/** Nhãn tiếng Việt cho loại tài sản. */
function assetTypeLabel(type: string): string {
  switch (type) {
    case 'BOND': return 'Trái phiếu'
    case 'CASH': return 'Tiền mặt'
    case 'OTHER': return 'Tài sản khác'
    default: return 'Cổ phiếu'
  }
}

/** "2026-07-01" → "Tháng 7/2026" */
function formatPeriodLabel(dateStr: string): string {
  const [y, m] = dateStr.split('-')
  if (!y || !m) return dateStr
  return `Tháng ${Number(m)}/${y}`
}

/** Domain X đối xứng quanh 0 với lề 25% để bar dài nhất không chạm mép chart
 *  và LabelList (vị trí "right") không bị tràn/đè lên label.
 *  Bound được làm tròn lên bước "đẹp" (1/2/5/10/25...) và trả ticks tường minh
 *  để trục X không hiện số thập phân dài (vd 9.712499999999999%). */
function symmetricDomain(rows: SectorDriftRow[]): { domain: [number, number]; ticks: number[] } {
  const maxAbs = Math.max(1e-9, ...rows.map(r => Math.abs(r.drift)))
  const target = maxAbs * 1.25

  let step: number
  if (maxAbs < 1) step = 0.5
  else if (maxAbs < 2.5) step = 1
  else if (maxAbs < 5) step = 2
  else if (maxAbs < 10) step = 5
  else if (maxAbs < 25) step = 10
  else if (maxAbs < 50) step = 25
  else step = 50

  const bound = Math.ceil(target / step) * step
  return {
    domain: [-bound, bound],
    ticks: [-bound, -bound / 2, 0, bound / 2, bound],
  }
}

function OverlapPanelImpl({ funds }: Props) {
  const [index, setIndex] = useState<HoldingsIndexEntry[] | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [fundA, setFundA] = useState<string>(() => loadLS<string>('overlap_a', DEFAULT_A))
  const [fundB, setFundB] = useState<string>(() => loadLS<string>('overlap_b', DEFAULT_B))
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null)
  const [holdingsTextA, setHoldingsTextA] = useState<string | null>(null)
  const [holdingsTextB, setHoldingsTextB] = useState<string | null>(null)
  const [industryTextA, setIndustryTextA] = useState<string | null>(null)
  const [industryTextB, setIndustryTextB] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Persist selections
  useEffect(() => { saveLS('overlap_a', fundA) }, [fundA])
  useEffect(() => { saveLS('overlap_b', fundB) }, [fundB])

  // Load holdings index (which funds have holdings data)
  useEffect(() => {
    let cancelled = false
    fetch('/data/holdings_index.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: HoldingsIndexEntry[]) => {
        if (!cancelled) setIndex(data)
      })
      .catch(() => {
        if (!cancelled) setIndexError('Chưa có dữ liệu holdings. Vui lòng tải lại sau.')
      })
    return () => { cancelled = true }
  }, [])

  // Funds eligible for overlap: only those present in holdings index.
  const options: FundOption[] = useMemo(() => {
    const ids = new Set((index ?? []).map(e => e.id))
    return funds
      .filter(f => ids.has(f.id))
      .map(f => ({ value: f.id, label: f.name_vi }))
  }, [funds, index])

  // Validate selections against available options; fall back to defaults.
  useEffect(() => {
    if (!index) return
    const ids = new Set(index.map(e => e.id))
    if (!ids.has(fundA)) {
      const fallback = index.find(e => e.id === DEFAULT_A) ?? index[0]
      if (fallback) setFundA(fallback.id)
    }
    if (!ids.has(fundB)) {
      const fallback = index.find(e => e.id === DEFAULT_B) ?? index[1] ?? index[0]
      if (fallback) setFundB(fallback.id)
    }
  }, [index, fundA, fundB])

  // Fetch raw holdings + industry CSV for both funds.
  useEffect(() => {
    if (!fundA || !fundB || fundA === fundB) {
      setHoldingsTextA(null); setHoldingsTextB(null)
      setIndustryTextA(null); setIndustryTextB(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    const loadPair = async (id: string) => {
      const [hResp, iResp] = await Promise.all([
        fetch(`/data/holdings/${id}_holdings.csv`),
        fetch(`/data/holdings/${id}_industry.csv`),
      ])
      const holdings = hResp.ok ? await hResp.text() : ''
      const industry = iResp.ok ? await iResp.text() : ''
      return { holdings, industry }
    }

    Promise.all([loadPair(fundA), loadPair(fundB)])
      .then(([a, b]) => {
        if (cancelled) return
        setHoldingsTextA(a.holdings); setHoldingsTextB(b.holdings)
        setIndustryTextA(a.industry); setIndustryTextB(b.industry)
        if (!a.holdings || !b.holdings) {
          setError('Một trong hai quỹ chưa có dữ liệu holdings.')
        }
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setError('Không tải được dữ liệu holdings.')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [fundA, fundB])

  // Các kỳ báo cáo có sẵn (union của 2 quỹ), dùng cho selector.
  const availablePeriods = useMemo(() => {
    const dates = new Set<string>()
    for (const text of [holdingsTextA, holdingsTextB]) {
      for (const d of text ? getAvailablePeriods(text) : []) dates.add(d)
    }
    return [...dates].sort().reverse()
  }, [holdingsTextA, holdingsTextB])

  // Kỳ thực tế mỗi quỹ dùng theo kỳ người dùng chọn (fallback kỳ gần nhất ≤ đích).
  const periodA = useMemo(
    () => holdingsTextA ? resolvePeriod(getAvailablePeriods(holdingsTextA), selectedPeriod) : '',
    [holdingsTextA, selectedPeriod],
  )
  const periodB = useMemo(
    () => holdingsTextB ? resolvePeriod(getAvailablePeriods(holdingsTextB), selectedPeriod) : '',
    [holdingsTextB, selectedPeriod],
  )

  const holdingsA = useMemo(
    () => holdingsTextA ? parseHoldingsCSV(holdingsTextA, selectedPeriod) : null,
    [holdingsTextA, selectedPeriod],
  )
  const holdingsB = useMemo(
    () => holdingsTextB ? parseHoldingsCSV(holdingsTextB, selectedPeriod) : null,
    [holdingsTextB, selectedPeriod],
  )
  const industryA = useMemo(
    () => industryTextA ? parseIndustryCSV(industryTextA, selectedPeriod) : null,
    [industryTextA, selectedPeriod],
  )
  const industryB = useMemo(
    () => industryTextB ? parseIndustryCSV(industryTextB, selectedPeriod) : null,
    [industryTextB, selectedPeriod],
  )

  const result: OverlapResult | null = useMemo(() => {
    if (!holdingsA || !holdingsB) return null
    return computeOverlap(holdingsA, holdingsB)
  }, [holdingsA, holdingsB])

  const driftRows: SectorDriftRow[] = useMemo(() => {
    if (!industryA || !industryB) return []
    return computeSectorDrift(industryA, industryB)
  }, [industryA, industryB])

  // Nguồn dữ liệu của từng quỹ đang chọn: 'report' = báo cáo tài chính của quỹ,
  // 'digiinvest' = digiinvest, 'fmarket' nếu quỹ có trong index nhưng không ghi
  // nguồn, null nếu chưa có holdings.
  const sourceA = useMemo(
    () => {
      const e = index?.find(e => e.id === fundA)
      return e ? (e.source ?? 'fmarket') : null
    },
    [index, fundA],
  )
  const sourceB = useMemo(
    () => {
      const e = index?.find(e => e.id === fundB)
      return e ? (e.source ?? 'fmarket') : null
    },
    [index, fundB],
  )

  const sourceLabel = (s: string) =>
    s === 'report' ? 'báo cáo tài chính của quỹ' : s === 'digiinvest' ? 'digiinvest.vn' : 'fmarket'

  const selectedA = options.find(o => o.value === fundA) || null
  const selectedB = options.find(o => o.value === fundB) || null

  if (indexError) {
    return (
      <div className="simulation-panel dca-panel">
        <div className="error-banner">{indexError}</div>
      </div>
    )
  }

  if (index === null) {
    return <div className="simulation-panel dca-panel"><div className="loading-indicator">Đang tải dữ liệu...</div></div>
  }

  return (
    <div className="simulation-panel dca-panel">
      <div className="rebal-intro-card">
        <p className="dca-ratio-sub">
          So sánh danh mục cổ phiếu của hai quỹ: có bao nhiêu công ty trùng nhau, tỷ trọng
          trùng là bao nhiêu và quỹ nào đang sở hữu cổ phiếu/ngành nào nhiều hơn quỹ còn lại.
        </p>
      </div>

      {/* ── Thông số ── */}
      <div className="dca-params-card">
        <h3 className="dca-section-title">Thông số</h3>
        <p className="overlap-limit-warn">So sánh trên danh mục cổ phiếu đầy đủ của hai quỹ, theo từng kỳ báo cáo.</p>
        <div className="dca-param-row">
          <label className="dca-label">{fundA}</label>
          <div className="overlap-select">
            <Select<FundOption>
              className="fund-search-select"
              classNamePrefix="fund-search"
              options={options}
              value={selectedA}
              onChange={opt => opt && setFundA(opt.value)}
              placeholder="Tìm quỹ..."
              noOptionsMessage={() => 'Không tìm thấy'}
              isSearchable
              styles={selectStyles}
            />
          </div>
        </div>
        <div className="dca-param-row">
          <label className="dca-label">{fundB}</label>
          <div className="overlap-select">
            <Select<FundOption>
              className="fund-search-select"
              classNamePrefix="fund-search"
              options={options}
              value={selectedB}
              onChange={opt => opt && setFundB(opt.value)}
              placeholder="Tìm quỹ..."
              noOptionsMessage={() => 'Không tìm thấy'}
              isSearchable
              styles={selectStyles}
            />
          </div>
        </div>
        <div className="dca-param-row">
          <label className="dca-label">Kỳ báo cáo</label>
          <div className="overlap-select">
            <Select<{ value: string | null; label: string }>
              className="fund-search-select"
              classNamePrefix="fund-search"
              options={[
                { value: null, label: 'Mới nhất' },
                ...availablePeriods.map(p => ({ value: p, label: formatPeriodLabel(p) })),
              ]}
              value={selectedPeriod === null
                ? { value: null, label: 'Mới nhất' }
                : { value: selectedPeriod, label: formatPeriodLabel(selectedPeriod) }}
              onChange={opt => opt && setSelectedPeriod(opt.value)}
              isClearable={false}
              styles={selectStyles}
            />
          </div>
        </div>
        {sourceA && sourceB && (
          <p className="overlap-source-info">
            {fundA} lấy dữ liệu từ {sourceLabel(sourceA)}
            {' · '}
            {fundB} lấy dữ liệu từ {sourceLabel(sourceB)}
          </p>
        )}
        {periodA && periodB && periodA !== periodB && (
          <div className="overlap-period-warn">
            {selectedA?.value ?? fundA} đang dùng thông tin {formatPeriodLabel(periodA)},&nbsp;
            {selectedB?.value ?? fundB} đang dùng thông tin {formatPeriodLabel(periodB)}&nbsp;
            vì quỹ chưa được cập nhật tới kỳ đã chọn.
          </div>
        )}
        {fundA === fundB && (
          <p className="overlap-warn">Hai quỹ đang giống nhau. Chọn hai quỹ khác nhau để so sánh.</p>
        )}
      </div>

      {loading && <div className="loading-indicator">Đang tải dữ liệu...</div>}
      {error && <div className="error-banner">{error}</div>}

      {holdingsA && holdingsB && fundA !== fundB && (
        <>
          {/* ── Thẻ thông số (chỉ khi có cổ phiếu để tính overlap) ── */}
          {result && (
          <div className="dca-journey-grid overlap-stats">
            <div className="dca-journey-stat overlap-stat--highlight">
              <div className="dca-journey-stat-label">Trùng nhau</div>
              <div className="dca-journey-stat-value">{result.overlapCount}</div>
              <div className="dca-journey-stat-sub">công ty chung</div>
            </div>
            <div className="dca-journey-stat">
              <div className="dca-journey-stat-label">Tỷ trọng trùng</div>
              <div className="dca-journey-stat-value">{formatPct(result.weightedOverlapPct)}</div>
              <div className="dca-journey-stat-sub">Σ min(wA, wB)</div>
            </div>
            <div className="dca-journey-stat">
              <div className="dca-journey-stat-label">Cổ phiếu trùng trong {fundA}</div>
              <div className="dca-journey-stat-value">{formatPct(result.overlapInA)}</div>
              <div className="dca-journey-stat-sub">% NAV {fundA} nằm trong cổ phiếu trùng</div>
            </div>
            <div className="dca-journey-stat">
              <div className="dca-journey-stat-label">Cổ phiếu trùng trong {fundB}</div>
              <div className="dca-journey-stat-value">{formatPct(result.overlapInB)}</div>
              <div className="dca-journey-stat-sub">% NAV {fundB} nằm trong cổ phiếu trùng</div>
            </div>
          </div>
          )}

          {/* ── Danh mục tài sản từng quỹ (song song), nhóm theo loại ── */}
          <div className="overlap-two-col">
            <div className="chart-container overlap-table-card">
              <div className="chart-header">
                <h3>Danh mục tài sản {fundA}</h3>
              </div>
              {holdingsA && <PortfolioTable rows={holdingsA} />}
            </div>

            <div className="chart-container overlap-table-card">
              <div className="chart-header">
                <h3>Danh mục tài sản {fundB}</h3>
              </div>
              {holdingsB && <PortfolioTable rows={holdingsB} />}
            </div>
          </div>

          {/* ── Cổ phiếu bị trùng, overweight/underweight, sector drift (chỉ khi tính được overlap) ── */}
          {result && (<>
          {/* ── Cổ phiếu bị trùng ── */}
          {result.overlap.length > 0 && (
            <div className="chart-container overlap-table-card">
              <div className="chart-header">
                <h3>Cổ phiếu bị trùng</h3>
              </div>
              <div className="dca-stats-table-scroll">
                <table className="dca-stats-table overlap-table">
                  <thead>
                    <tr>
                      <th>Cổ phiếu</th>
                      <th>Ngành</th>
                      <th>Tỷ trọng {fundA}</th>
                      <th>Tỷ trọng {fundB}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.overlap.map(o => (
                      <tr key={o.stockCode}>
                        <td className="dca-stats-td-name">{o.stockCode}</td>
                        <td>{o.industryA || o.industryB}</td>
                        <td>{formatPct(o.weightA)}</td>
                        <td>{formatPct(o.weightB)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Overweight / Underweight ── */}
          <div className="overlap-two-col">
            <div className="chart-container overlap-table-card">
              <div className="chart-header">
                <h3>Tỷ trọng cổ phiếu {fundA} hơn {fundB}</h3>
              </div>
              {result.overweightA.length === 0 ? (
                <p className="overlap-empty">Không có cổ phiếu nào quỹ A nắm nhiều hơn quỹ B.</p>
              ) : (
                <div className="dca-stats-table-scroll">
                  <table className="dca-stats-table overlap-table">
                    <thead>
                      <tr>
                        <th>Cổ phiếu</th>
                        <th>Tỷ trọng {fundA}</th>
                        <th>Tỷ trọng {fundB}</th>
                        <th>Chênh lệch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.overweightA.map(o => (
                        <tr key={o.stockCode}>
                          <td className="dca-stats-td-name">{o.stockCode}</td>
                          <td>{formatPct(o.weightA)}</td>
                          <td>{formatPct(o.weightB)}</td>
                          <td className="overlap-diff-pos">+{formatPct(o.diff)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="chart-container overlap-table-card">
              <div className="chart-header">
                <h3>Tỷ trọng cổ phiếu {fundA} nhỏ hơn {fundB}</h3>
              </div>
              {result.underweightA.length === 0 ? (
                <p className="overlap-empty">Không có cổ phiếu nào quỹ A nắm ít hơn quỹ B.</p>
              ) : (
                <div className="dca-stats-table-scroll">
                  <table className="dca-stats-table overlap-table">
                    <thead>
                      <tr>
                        <th>Cổ phiếu</th>
                        <th>Tỷ trọng {fundA}</th>
                        <th>Tỷ trọng {fundB}</th>
                        <th>Chênh lệch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.underweightA.map(o => (
                        <tr key={o.stockCode}>
                          <td className="dca-stats-td-name">{o.stockCode}</td>
                          <td>{formatPct(o.weightA)}</td>
                          <td>{formatPct(o.weightB)}</td>
                          <td className="overlap-diff-neg">{formatPct(o.diff)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ── Sector drift ── */}
          {driftRows.length > 0 && (() => {
            const axis = symmetricDomain(driftRows)
            return (
            <div className="chart-container overlap-drift-card">
              <div className="chart-header">
                <h3>Sector Drift</h3>
                <span
                  className="chart-tooltip-icon"
                  title="Chênh lệch tỷ trọng ngành giữa quỹ A và quỹ B (A − B). Dương = quỹ A nắm nhiều hơn ở ngành này, âm = quỹ B nắm nhiều hơn."
                >
                  ?
                </span>
              </div>
              <ResponsiveContainer width="100%" height={Math.max(300, driftRows.length * 28)}>
                <BarChart data={driftRows} layout="vertical" margin={{ left: 16, right: 48, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={axis.domain}
                    ticks={axis.ticks}
                    tickFormatter={v => `${v}%`}
                  />
                  <YAxis type="category" dataKey="industry" width={170} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number, name: string, props) => {
                      const idx = (props as { payload?: SectorDriftRow }).payload
                      return [`${value.toFixed(2)}% (A − B)`, `${idx?.industry ?? name}`]
                    }}
                    labelFormatter={() => ''}
                  />
                  <Bar dataKey="drift" radius={[0, 3, 3, 0]}>
                    {driftRows.map((row, i) => (
                      <Cell key={i} fill={row.drift >= 0 ? POS_COLOR : NEG_COLOR} />
                    ))}
                    <LabelList
                      dataKey="drift"
                      position="right"
                      formatter={(v: number) => `${v.toFixed(1)}%`}
                      style={{ fontSize: 11, fill: '#5e5d59' }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            )
          })()}
          </>)}
          <p className="overlap-note">
            Danh mục gồm cổ phiếu, trái phiếu, tiền mặt và tài sản khác tại kỳ báo cáo
            {periodA ? ` ${formatPeriodLabel(periodA)}` : ' gần nhất'}.
            Overlap chỉ đo trên cổ phiếu; trái phiếu, tiền mặt và tài sản khác được hiển thị
            để bạn thấy cấu trúc danh mục nhưng không tham gia tính trùng.
          </p>
        </>
      )}

      {!holdingsA && !loading && !error && fundA !== fundB && (
        <div className="error-banner">Không đủ dữ liệu để tính overlap.</div>
      )}
    </div>
  )
}

/** Render danh mục một quỹ, nhóm theo loại tài sản (cổ phiếu → trái phiếu → tiền mặt → khác). */
function PortfolioTable({ rows }: { rows: Holding[] }) {
  const groups: Array<{ type: AssetType; label: string; rows: Holding[] }> = []
  for (const type of ['STOCK', 'BOND', 'CASH', 'OTHER'] as AssetType[]) {
    const group = rows.filter(h => h.type === type)
    if (group.length > 0) {
      groups.push({ type, label: assetTypeLabel(type), rows: group })
    }
  }

  return (
    <div className="overlap-portfolio">
      {groups.map(g => (
        <div key={g.type} className="overlap-portfolio-group">
          <div className="overlap-portfolio-group-title">
            {g.label} ({g.rows.length})
          </div>
          <div className="dca-stats-table-scroll">
            <table className="dca-stats-table overlap-table">
              <thead>
                <tr>
                  <th>{g.type === 'STOCK' ? 'Cổ phiếu' : 'Mã'}</th>
                  {g.type === 'STOCK' && <th>Ngành</th>}
                  <th>Tỷ trọng</th>
                  <th>Giá trị</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map(o => (
                  <tr key={`${g.type}-${o.stockCode}`}>
                    <td className="dca-stats-td-name">{o.stockCode}</td>
                    {g.type === 'STOCK' && <td>{o.industry}</td>}
                    <td>{formatPct(o.weightPct)}</td>
                    <td>{o.assetValue > 0 ? formatVND(o.assetValue) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

export const OverlapPanel = memo(OverlapPanelImpl)
