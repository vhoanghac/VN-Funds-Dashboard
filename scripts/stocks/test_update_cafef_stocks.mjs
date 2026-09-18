import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ensureUnadjustedPricesUnchanged,
  findCorrections,
  findMissingExistingRows,
  mergeRows,
} from './update_cafef_stocks.mjs'

function row(date, adjustedPrice, unadjustedPrice = adjustedPrice) {
  return { date, adjustedPrice, unadjustedPrice }
}

test('accepts adjusted-only corrections and preserves the raw price', () => {
    const existing = [row('2026-09-16', 62900)]
    const fetched = [row('2026-09-16', 62400, 62900)]
    const corrections = findCorrections(existing, fetched)

    assert.equal(corrections.length, 1)
    assert.doesNotThrow(() => ensureUnadjustedPricesUnchanged('GEE', corrections))
    assert.deepEqual(mergeRows(existing, fetched), [row('2026-09-16', 62400, 62900)])
})

test('rejects unadjusted corrections', () => {
    const corrections = findCorrections([row('2026-09-16', 62900)], [row('2026-09-16', 62900, 62400)])

    assert.throws(
      () => ensureUnadjustedPricesUnchanged('GEE', corrections),
      /GEE: CafeF changed 1 historical unadjusted row\(s\); no file was written\./,
    )
})

test('rejects corrections to both price columns', () => {
    const corrections = findCorrections([row('2026-09-16', 62900)], [row('2026-09-16', 62400, 62400)])

    assert.throws(() => ensureUnadjustedPricesUnchanged('GEE', corrections))
})

test('keeps existing rows that a recent fetch does not include', () => {
    const existing = [row('2026-06-17', 60000), row('2026-09-16', 62900)]
    const fetched = [row('2026-09-16', 62400, 62900), row('2026-09-17', 63000)]

    assert.deepEqual(mergeRows(existing, fetched), [
      row('2026-06-17', 60000),
      row('2026-09-16', 62400, 62900),
      row('2026-09-17', 63000),
    ])
})

test('reports missing existing sessions during a full refresh', () => {
    const existing = [row('2026-06-17', 60000), row('2026-09-16', 62900)]
    const fetched = [row('2026-09-16', 62400, 62900)]

    assert.deepEqual(findMissingExistingRows(existing, fetched, '2026-06-17', '2026-09-16'), [
      row('2026-06-17', 60000),
    ])
})

test('is idempotent after an adjusted correction', () => {
    const updated = [row('2026-09-16', 62400, 62900)]

    assert.deepEqual(findCorrections(updated, updated), [])
    assert.deepEqual(mergeRows(updated, updated), updated)
})
