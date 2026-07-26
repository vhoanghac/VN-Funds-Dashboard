interface Props {
  dateFrom: string | null
  dateTo: string | null
  onChangeFrom: (v: string | null) => void
  onChangeTo: (v: string | null) => void
}

type Preset = '6m' | '1y' | '3y' | '5y' | 'ytd' | 'all'

const PRESETS: { value: Preset; label: string }[] = [
  { value: '6m', label: '6 tháng' },
  { value: '1y', label: '1 năm' },
  { value: '3y', label: '3 năm' },
  { value: '5y', label: '5 năm' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'Tất cả' },
]

function getPresetFrom(preset: Preset): string | null {
  const now = new Date()
  let d: Date

  switch (preset) {
    case '6m':
      d = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())
      break
    case '1y':
      d = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
      break
    case '3y':
      d = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate())
      break
    case '5y':
      d = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate())
      break
    case 'ytd':
      d = new Date(now.getFullYear(), 0, 1)
      break
    case 'all':
      return null
  }

  return d.toISOString().substring(0, 10)
}

function getActivePreset(dateFrom: string | null, dateTo: string | null): Preset | null {
  if (dateTo) return null
  if (!dateFrom) return 'all'

  for (const p of PRESETS) {
    if (p.value === 'all') continue
    const expected = getPresetFrom(p.value)
    if (expected === dateFrom) return p.value
  }
  return null
}

export function DateRangePicker({ dateFrom, dateTo, onChangeFrom, onChangeTo }: Props) {
  const activePreset = getActivePreset(dateFrom, dateTo)

  function handlePreset(preset: Preset) {
    onChangeTo(null)
    onChangeFrom(getPresetFrom(preset))
  }

  return (
    <div className="date-range-picker">
      <div className="date-presets">
        {PRESETS.map(p => (
          <button
            key={p.value}
            className={`preset-btn ${activePreset === p.value ? 'preset-btn-active' : ''}`}
            onClick={() => handlePreset(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="date-inputs">
        <input
          type="date"
          aria-label="Từ ngày"
          value={dateFrom ?? ''}
          onChange={e => onChangeFrom(e.target.value || null)}
        />
        <span className="date-separator">→</span>
        <input
          type="date"
          aria-label="Đến ngày"
          value={dateTo ?? ''}
          onChange={e => onChangeTo(e.target.value || null)}
        />
      </div>
    </div>
  )
}
