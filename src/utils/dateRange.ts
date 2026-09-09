export const MAX_YEARS_BACK = 10

export function isValidYearsBack(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= MAX_YEARS_BACK
}

export function yearsBackDateRange(yearsBack: number, now = new Date()): { from: string; to: string } {
  const safeYearsBack = isValidYearsBack(yearsBack) ? yearsBack : 5
  const targetYear = now.getFullYear() - safeYearsBack
  const month = now.getMonth()
  const day = Math.min(now.getDate(), new Date(targetYear, month + 1, 0).getDate())
  const from = new Date(targetYear, month, day)

  return {
    from: formatLocalDate(from),
    to: formatLocalDate(now),
  }
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
