import type {
  PricePoint,
  PriceSeries,
  PriceSeriesAdjustment,
  PriceSeriesPoint,
  PriceSeriesV1,
} from '../types'

export interface CreatePriceSeriesInput {
  assetId: string
  currency: string
  points: PriceSeriesPoint[]
  rawPoints?: PriceSeriesPoint[]
  purchasePoints?: PriceSeriesPoint[]
  adjustments?: PriceSeriesAdjustment[]
  source: string
}

export interface PriceSeriesValidationIssue {
  path: string
  message: string
}

export interface PriceSeriesValidationResult {
  series: PriceSeries | null
  issues: PriceSeriesValidationIssue[]
}

export class PriceSeriesValidationError extends Error {
  constructor(readonly issues: PriceSeriesValidationIssue[]) {
    super(`PriceSeries v1 is invalid: ${issues.map(issue => `${issue.path} ${issue.message}`).join('; ')}`)
    this.name = 'PriceSeriesValidationError'
  }
}

export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))

  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}

export function toPriceSeriesPoints(points: PricePoint[]): PriceSeriesPoint[] {
  return points.map(point => ({ date: point.date, value: point.price }))
}

export function toPricePoints(points: PriceSeriesPoint[]): PricePoint[] {
  return points.map(point => ({ date: point.date, price: point.value }))
}

export function createPriceSeries(input: CreatePriceSeriesInput): PriceSeries {
  const series: PriceSeriesV1 = {
    version: 1,
    assetId: input.assetId,
    currency: input.currency,
    points: input.points,
    rawPoints: input.rawPoints,
    purchasePoints: input.purchasePoints,
    adjustments: input.adjustments ?? [],
    source: input.source,
    asOf: input.points[input.points.length - 1]?.date ?? '',
  }
  const result = validatePriceSeries(series)
  if (!result.series) throw new PriceSeriesValidationError(result.issues)
  return result.series
}

export function validatePriceSeries(value: unknown): PriceSeriesValidationResult {
  const issues: PriceSeriesValidationIssue[] = []
  if (!isRecord(value)) {
    return { series: null, issues: [{ path: '$', message: 'must be an object' }] }
  }

  if (value.version !== 1) issue(issues, 'version', 'must equal 1')

  const assetId = readRequiredString(value, 'assetId', issues)
  const currency = readRequiredString(value, 'currency', issues)
  const source = readRequiredString(value, 'source', issues)
  const asOf = readRequiredString(value, 'asOf', issues)
  if (asOf && !isIsoDate(asOf)) issue(issues, 'asOf', 'must be a valid YYYY-MM-DD date')

  const points = readPoints(value.points, 'points', issues)
  const rawPoints = value.rawPoints === undefined
    ? undefined
    : readPoints(value.rawPoints, 'rawPoints', issues)
  const purchasePoints = value.purchasePoints === undefined
    ? undefined
    : readPoints(value.purchasePoints, 'purchasePoints', issues)
  const adjustments = readAdjustments(value.adjustments, issues)

  if (points && asOf && points[points.length - 1] && asOf !== points[points.length - 1]!.date) {
    issue(issues, 'asOf', 'must equal the final points date')
  }
  if (points && rawPoints && sameDateAxis(points, rawPoints) === false) {
    issue(issues, 'rawPoints', 'must share the same date axis as points')
  }
  if (rawPoints && adjustments && adjustments.length === 0) {
    issue(issues, 'rawPoints', 'requires at least one adjustment')
  }
  if (!rawPoints && adjustments && adjustments.length > 0) {
    issue(issues, 'adjustments', 'requires rawPoints')
  }

  if (issues.length > 0 || !assetId || !currency || !source || !asOf || !points || !adjustments) {
    return { series: null, issues }
  }

  return {
    series: {
      version: 1,
      assetId,
      currency,
      points,
      rawPoints: rawPoints ?? undefined,
      purchasePoints: purchasePoints ?? undefined,
      adjustments,
      source,
      asOf,
    },
    issues,
  }
}

function readPoints(
  value: unknown,
  path: string,
  issues: PriceSeriesValidationIssue[],
): PriceSeriesPoint[] | null {
  if (!Array.isArray(value)) {
    issue(issues, path, 'must be an array')
    return null
  }

  const points: PriceSeriesPoint[] = []
  for (let index = 0; index < value.length; index++) {
    const candidate = value[index]
    const pointPath = `${path}[${index}]`
    if (!isRecord(candidate)) {
      issue(issues, pointPath, 'must be an object')
      continue
    }

    const date = candidate.date
    const numericValue = candidate.value
    const validDate = typeof date === 'string' && isIsoDate(date)
    const validValue = typeof numericValue === 'number'
      && Number.isFinite(numericValue)
      && numericValue > 0

    if (!validDate) issue(issues, `${pointPath}.date`, 'must be a valid YYYY-MM-DD date')
    if (!validValue) issue(issues, `${pointPath}.value`, 'must be a finite number greater than 0')
    if (validDate && validValue) points.push({ date, value: numericValue })
  }

  if (points.length === 0) issue(issues, path, 'must contain at least one valid point')
  for (let index = 1; index < points.length; index++) {
    if (points[index - 1]!.date >= points[index]!.date) {
      issue(issues, path, 'must be strictly sorted by date with no duplicates')
      break
    }
  }

  return points
}

function readAdjustments(
  value: unknown,
  issues: PriceSeriesValidationIssue[],
): PriceSeriesAdjustment[] | null {
  if (!Array.isArray(value)) {
    issue(issues, 'adjustments', 'must be an array')
    return null
  }

  const adjustments: PriceSeriesAdjustment[] = []
  for (let index = 0; index < value.length; index++) {
    const candidate = value[index]
    const path = `adjustments[${index}]`
    if (!isRecord(candidate)) {
      issue(issues, path, 'must be an object')
      continue
    }

    const exDate = candidate.exDate
    const payDate = candidate.payDate
    const amountPerCert = candidate.amountPerCert
    const taxRate = candidate.taxRate
    const validKind = candidate.kind === 'dividend'
    const validExDate = typeof exDate === 'string' && isIsoDate(exDate)
    const validPayDate = typeof payDate === 'string' && isIsoDate(payDate)
    const validAmount = typeof amountPerCert === 'number'
      && Number.isFinite(amountPerCert)
      && amountPerCert > 0
    const validTaxRate = typeof taxRate === 'number'
      && Number.isFinite(taxRate)
      && taxRate >= 0
      && taxRate <= 1

    if (!validKind) issue(issues, `${path}.kind`, 'must equal dividend')
    if (!validExDate) issue(issues, `${path}.exDate`, 'must be a valid YYYY-MM-DD date')
    if (!validPayDate) issue(issues, `${path}.payDate`, 'must be a valid YYYY-MM-DD date')
    if (!validAmount) issue(issues, `${path}.amountPerCert`, 'must be a finite number greater than 0')
    if (!validTaxRate) issue(issues, `${path}.taxRate`, 'must be a finite number from 0 to 1')

    if (validKind && validExDate && validPayDate && validAmount && validTaxRate) {
      adjustments.push({ kind: 'dividend', exDate, payDate, amountPerCert, taxRate })
    }
  }

  return adjustments
}

function sameDateAxis(left: PriceSeriesPoint[], right: PriceSeriesPoint[]): boolean {
  if (left.length !== right.length) return false
  return left.every((point, index) => point.date === right[index]!.date)
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  issues: PriceSeriesValidationIssue[],
): string | null {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    issue(issues, key, 'must be a non-empty string')
    return null
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function issue(issues: PriceSeriesValidationIssue[], path: string, message: string): void {
  issues.push({ path, message })
}
