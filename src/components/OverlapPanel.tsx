import { useState, useEffect, useMemo, memo } from 'react'
import Select from 'react-select'
import {
  BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, CartesianGrid, Tooltip, LabelList,
} from 'recharts'
import type { FundMeta } from '../types'
import { loadLS, saveLS } from '../utils/localStorage'
import {
  parseHoldingsCSV, parseIndustryCSV, computeOverlap, computeSectorDrift,
  type Holding, type IndustryHolding, type OverlapResult, type SectorDriftRow,
} from '../utils/overlap'

interface Props {
  funds: FundMeta[]
}

interface HoldingsIndexEntry {
  id: string
  update_at: string
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

function OverlapPanelImpl({ funds }: Props) {
  const [index, setIndex] = useState<HoldingsIndexEntry[] | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [fundA, setFundA] = useState<string>(() => loadLS<string>('overlap_a', DEFAULT_A))
  const [fundB, setFundB] = useState<string>(() => loadLS<string>('overlap_b', DEFAULT_B))
  const [holdingsA, setHoldingsA] = useState<Holding[] | null>(null)
  const [holdingsB, setHoldingsB] = useState<Holding[] | null>(null)
  const [industryA, setIndustryA] = useState<IndustryHolding[] | null>(null)
  const [industryB, setIndustryB] = useState<IndustryHolding[] | null>(null)
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

  // Load holdings + industry for both funds.
  useEffect(() => {
    if (!fundA || !fundB || fundA === fundB) {
      setHoldingsA(null); setHoldingsB(null)
      setIndustryA(null); setIndustryB(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    const loadPair = async (id: string) => {
      const [hResp, iResp] = await Promise.all([
        fetch(`/data/${id}_holdings.csv`),
        fetch(`/data/${id}_industry.csv`),
      ])
      const holdings = hResp.ok ? parseHoldingsCSV(await hResp.text()) : []
      const industry = iResp.ok ? parseIndustryCSV(await iResp.text()) : []
      return { holdings, industry }
    }

    Promise.all([loadPair(fundA), loadPair(fundB)])
      .then(([a, b]) => {
        if (cancelled) return
        setHoldingsA(a.holdings); setHoldingsB(b.holdings)
        setIndustryA(a.industry); setIndustryB(b.industry)
        if (a.holdings.length === 0 || b.holdings.length === 0) {
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

  const result: OverlapResult | null = useMemo(() => {
    if (!holdingsA || !holdingsB) return null
    return computeOverlap(holdingsA, holdingsB)
  }, [holdingsA, holdingsB])

  const driftRows: SectorDriftRow[] = useMemo(() => {
    if (!industryA || !industryB) return []
    return computeSectorDrift(industryA, industryB)
  }, [industryA, industryB])

  const selectedA = options.find(o => o.value === fundA) || null
  const selectedB = options.find(o => o.value === fundB) || null
  const updateAt = index?.find(e => e.id === fundA)?.update_at
    ?? index?.find(e => e.id === fundB)?.update_at
    ?? null

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
      <p className="overlap-intro">
        So sánh danh mục cổ phiếu của hai quỹ: có bao nhiêu công ty trùng nhau, tỷ trọng
        trùng là bao nhiêu, và quỹ nào đang nặng hơn ở những cổ phiếu/ngành nào.
      </p>

      {/* ── Thông số ── */}
      <div className="dca-params-card">
        <h3 className="dca-section-title">Thông số</h3>
        <div className="dca-param-row">
          <label className="dca-label">Quỹ A</label>
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
          <label className="dca-label">Quỹ B</label>
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
        {fundA === fundB && (
          <p className="overlap-warn">Hai quỹ đang giống nhau. Chọn hai quỹ khác nhau để so sánh.</p>
        )}
      </div>

      {loading && <div className="loading-indicator">Đang tải dữ liệu...</div>}
      {error && <div className="error-banner">{error}</div>}

      {result && fundA !== fundB && (
        <>
          {/* ── Thẻ thông số ── */}
          <div className="dca-journey-grid overlap-stats">
            <div className="dca-journey-stat">
              <div className="dca-journey-stat-label">{selectedA?.label ?? fundA}</div>
              <div className="dca-journey-stat-value">{result.stockCountA}</div>
              <div className="dca-journey-stat-sub">công ty</div>
            </div>
            <div className="dca-journey-stat">
              <div className="dca-journey-stat-label">{selectedB?.label ?? fundB}</div>
              <div className="dca-journey-stat-value">{result.stockCountB}</div>
              <div className="dca-journey-stat-sub">công ty</div>
            </div>
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
              <div className="dca-journey-stat-label">Trong quỹ A</div>
              <div className="dca-journey-stat-value">{formatPct(result.pctInA * 100)}</div>
              <div className="dca-journey-stat-sub">danh mục A bị trùng</div>
            </div>
            <div className="dca-journey-stat">
              <div className="dca-journey-stat-label">Trong quỹ B</div>
              <div className="dca-journey-stat-value">{formatPct(result.pctInB * 100)}</div>
              <div className="dca-journey-stat-sub">danh mục B bị trùng</div>
            </div>
          </div>

          {/* ── Top overlaps ── */}
          {result.overlap.length > 0 && (
            <div className="chart-container overlap-table-card">
              <div className="chart-header">
                <h3>Top 10 Overlap</h3>
              </div>
              <div className="dca-stats-table-scroll">
                <table className="dca-stats-table overlap-table">
                  <thead>
                    <tr>
                      <th>Stock</th>
                      <th>Industry</th>
                      <th>Weight in A</th>
                      <th>Weight in B</th>
                      <th>Min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.overlap.slice(0, 10).map(o => (
                      <tr key={o.stockCode}>
                        <td className="dca-stats-td-name">{o.stockCode}</td>
                        <td>{o.industryA || o.industryB}</td>
                        <td>{formatPct(o.weightA)}</td>
                        <td>{formatPct(o.weightB)}</td>
                        <td>{formatPct(o.minWeight)}</td>
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
                <h3>A overweight vs B</h3>
              </div>
              {result.overweightA.length === 0 ? (
                <p className="overlap-empty">Không có cổ phiếu nào quỹ A nắm nhiều hơn quỹ B.</p>
              ) : (
                <div className="dca-stats-table-scroll">
                  <table className="dca-stats-table overlap-table">
                    <thead>
                      <tr>
                        <th>Stock</th>
                        <th>Weight in A</th>
                        <th>Weight in B</th>
                        <th>Diff</th>
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
                <h3>A underweight vs B</h3>
              </div>
              {result.underweightA.length === 0 ? (
                <p className="overlap-empty">Không có cổ phiếu nào quỹ A nắm ít hơn quỹ B.</p>
              ) : (
                <div className="dca-stats-table-scroll">
                  <table className="dca-stats-table overlap-table">
                    <thead>
                      <tr>
                        <th>Stock</th>
                        <th>Weight in A</th>
                        <th>Weight in B</th>
                        <th>Diff</th>
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
          {driftRows.length > 0 && (
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
                  <XAxis type="number" tickFormatter={v => `${v}%`} />
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
          )}

          <p className="overlap-note">
            Dữ liệu holdings là <strong>top 10 cổ phiếu</strong> mỗi quỹ (giới hạn nguồn dữ liệu),
            cập nhật {updateAt ? `ngày ${updateAt}` : 'gần nhất'}. Chưa có lịch sử theo kỳ báo cáo —
            chỉ so danh mục hiện tại. Ngành thì đầy đủ 100%.
          </p>
        </>
      )}

      {!loading && !result && fundA !== fundB && !error && (
        <div className="error-banner">Không đủ dữ liệu để tính overlap.</div>
      )}
    </div>
  )
}

export const OverlapPanel = memo(OverlapPanelImpl)
