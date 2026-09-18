#!/usr/bin/env node
/**
 * Append stock prices from CafeF and refresh adjusted history when needed.
 *
 * The updater reloads the latest three months so it can detect CafeF changes
 * to either price column. An adjusted-only correction triggers a full-history
 * refresh for that symbol; unadjusted corrections still fail safely.
 *
 * Usage:
 *   node scripts/stocks/update_cafef_stocks.mjs --symbol ACB
 *   node scripts/stocks/update_cafef_stocks.mjs --symbols-file scripts/stocks/stock_symbols.txt
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addDays, fetchHistory, normalizeExchange, todayIso } from './scrape_cafef_stock.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(SCRIPT_DIR, '..', '..')
const STOCK_DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'stocks')
const HEADER = 'date,adjusted_price,unadjusted_price'
const RECENT_LOOKBACK_DAYS = 90

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printUsage()
    return
  }

  const symbols = loadSymbols(args)
  if (args.output && symbols.length > 1) {
    throw new Error('--output can only be used with one symbol')
  }

  for (const spec of symbols) {
    await updateSymbol(spec, args)
  }
}

async function updateSymbol(spec, args) {
  const { symbol, exchange } = spec
  const outputPath = path.resolve(args.output || path.join(STOCK_DATA_DIR, `${symbol}.csv`))
  const to = args.to || todayIso()
  assertIsoDate(to, '--to')

  const existingRows = readCsv(outputPath)
  const lastDate = existingRows[existingRows.length - 1].date
  const recentStart = addDays(lastDate, -RECENT_LOOKBACK_DAYS)
  let checkedStart = recentStart
  let fetchedRows = await fetchHistory(symbol, recentStart, to, exchange)
  let corrections = findCorrections(existingRows, fetchedRows)
  ensureUnadjustedPricesUnchanged(symbol, corrections)

  let adjustedCorrections = corrections.filter(({ existing, fetched }) => existing.adjustedPrice !== fetched.adjustedPrice)
  if (adjustedCorrections.length > 0) {
    checkedStart = existingRows[0].date
    console.log([
      `${symbol}: CafeF changed ${adjustedCorrections.length} adjusted historical row(s).`,
      `Refreshing full history (${checkedStart}..${to}) to keep adjusted prices consistent.`,
    ].join(' '))
    fetchedRows = await fetchHistory(symbol, checkedStart, to, exchange)
    corrections = findCorrections(existingRows, fetchedRows)
    ensureUnadjustedPricesUnchanged(symbol, corrections)
    const missingRows = findMissingExistingRows(existingRows, fetchedRows, checkedStart, to)
    if (missingRows.length > 0) {
      throw new Error([
        `${symbol}: CafeF full refresh omitted ${missingRows.length} existing session(s); no file was written.`,
        ...missingRows.slice(0, 10).map(row => row.date),
      ].join('\n'))
    }
    adjustedCorrections = corrections.filter(({ existing, fetched }) => existing.adjustedPrice !== fetched.adjustedPrice)
  }

  const newRows = fetchedRows.filter(row => row.date > lastDate)
  const mergedRows = mergeRows(existingRows, fetchedRows)
  validateRows(mergedRows)

  console.log(`${symbol}: checked ${fetchedRows.length} CafeF sessions (${checkedStart}..${to})`)
  if (adjustedCorrections.length > 0) {
    console.log(`${symbol}: refreshed ${adjustedCorrections.length} adjusted historical row(s); unadjusted prices unchanged`)
  }
  if (newRows.length === 0 && adjustedCorrections.length === 0) {
    console.log(`Already up to date (last: ${lastDate})`)
    return
  }

  if (newRows.length > 0) {
    console.log(`New sessions: ${newRows.length} (${newRows[0].date}..${newRows[newRows.length - 1].date})`)
  }
  if (args.dryRun) {
    console.log('Dry run: no file written')
    return
  }

  writeCsv(outputPath, mergedRows)
  console.log(`Updated ${outputPath}`)
}

function loadSymbols(args) {
  const specs = []
  if (args.symbol) specs.push(...parseSymbolList(args.symbol).map(symbol => ({ symbol, exchange: normalizeExchange(args.exchange || 'HOSE') })))
  if (args['symbols-file']) specs.push(...readSymbolsFile(args['symbols-file'], args.exchange))
  const uniqueSpecs = [...new Map(specs.map(spec => [`${spec.symbol}:${spec.exchange}`, spec])).values()]
  if (uniqueSpecs.length === 0) throw new Error('Provide --symbol or --symbols-file')
  return uniqueSpecs
}

function parseSymbolList(value) {
  const symbols = value.split(',').map(item => item.trim().toUpperCase()).filter(Boolean)
  for (const symbol of symbols) {
    if (!/^[A-Z0-9]{1,12}$/.test(symbol)) throw new Error(`Invalid stock symbol: ${symbol}`)
  }
  return symbols
}

function readSymbolsFile(fileName, defaultExchange) {
  const filePath = path.resolve(fileName)
  if (!fs.existsSync(filePath)) throw new Error(`Symbols file not found: ${filePath}`)
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.split('#', 1)[0].trim())
    .filter(Boolean)
    .flatMap(line => parseSymbolSpecs(line, defaultExchange))
}

function parseSymbolSpecs(value, defaultExchange) {
  const [symbolList, exchangeValue, ...extra] = value.split('|').map(item => item.trim())
  if (extra.length > 0 || !symbolList) throw new Error(`Invalid stock manifest entry: ${value}`)
  const exchange = normalizeExchange(exchangeValue || defaultExchange || 'HOSE')
  return parseSymbolList(symbolList).map(symbol => ({ symbol, exchange }))
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      result.help = true
    } else if (arg === '--dry-run') {
      result.dryRun = true
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
      result[key] = value
      index++
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return result
}

function printUsage() {
  console.log([
    'Usage: node scripts/stocks/update_cafef_stocks.mjs [options]',
    '',
    'Options:',
    '  --symbol ACB             Stock symbol (comma-separated values allowed)',
    '  --symbols-file PATH      File containing one symbol per line',
    '  --exchange HOSE          CafeF exchange type (default: HOSE)',
    '  --output PATH            Existing CSV path',
    '  --to YYYY-MM-DD          Last date to request (default: today)',
    '  --dry-run                Check and report without writing',
    '  --help                   Show this help',
  ].join('\n'))
}

function findCorrections(existingRows, fetchedRows) {
  const existingByDate = new Map(existingRows.map(row => [row.date, row]))
  return fetchedRows.flatMap(fetched => {
    const existing = existingByDate.get(fetched.date)
    if (!existing || (existing.adjustedPrice === fetched.adjustedPrice && existing.unadjustedPrice === fetched.unadjustedPrice)) {
      return []
    }
    return [{ date: fetched.date, existing, fetched }]
  })
}

function findMissingExistingRows(existingRows, fetchedRows, from, to) {
  const fetchedDates = new Set(fetchedRows.map(row => row.date))
  return existingRows.filter(row => row.date >= from && row.date <= to && !fetchedDates.has(row.date))
}

function ensureUnadjustedPricesUnchanged(symbol, corrections) {
  const rawCorrections = corrections.filter(({ existing, fetched }) => existing.unadjustedPrice !== fetched.unadjustedPrice)
  if (rawCorrections.length === 0) return

  throw new Error([
    `${symbol}: CafeF changed ${rawCorrections.length} historical unadjusted row(s); no file was written.`,
    ...formatCorrectionDetails(rawCorrections),
  ].join('\n'))
}

function formatCorrectionDetails(corrections) {
  return corrections.slice(0, 10).map(item => (
    `${item.date}: ${item.existing.adjustedPrice}/${item.existing.unadjustedPrice} -> ${item.fetched.adjustedPrice}/${item.fetched.unadjustedPrice}`
  ))
}

function mergeRows(existingRows, fetchedRows) {
  const fetchedByDate = new Map(fetchedRows.map(row => [row.date, row]))
  const mergedByDate = new Map(existingRows.map(row => [row.date, row]))

  for (const [date, fetched] of fetchedByDate) {
    const existing = mergedByDate.get(date)
    mergedByDate.set(date, existing
      ? { ...fetched, unadjustedPrice: existing.unadjustedPrice }
      : fetched)
  }

  return [...mergedByDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${filePath}. Run the backfill script first.`)
  }

  const lines = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/)
  if (lines[0] !== HEADER) throw new Error(`Unexpected CSV header: ${lines[0]}`)

  const rows = lines.slice(1).map((line, index) => {
    const [date, adjustedPrice, unadjustedPrice] = line.split(',')
    if (!date || !adjustedPrice || !unadjustedPrice) throw new Error(`Malformed CSV row ${index + 2}`)
    return {
      date,
      adjustedPrice: Number(adjustedPrice),
      unadjustedPrice: Number(unadjustedPrice),
    }
  })
  validateRows(rows)
  if (rows.length === 0) throw new Error(`No data rows in ${filePath}`)
  return rows
}

function validateRows(rows) {
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    assertIsoDate(row.date, `date at row ${index + 2}`)
    if (!Number.isInteger(row.adjustedPrice) || !Number.isInteger(row.unadjustedPrice)) {
      throw new Error(`Non-integer VND price at ${row.date}`)
    }
    if (row.adjustedPrice <= 0 || row.unadjustedPrice <= 0) {
      throw new Error(`Non-positive price at ${row.date}`)
    }
    if (index > 0 && rows[index - 1].date >= row.date) {
      throw new Error(`CSV dates are not strictly sorted around ${row.date}`)
    }
  }
}

function writeCsv(filePath, rows) {
  const content = [
    HEADER,
    ...rows.map(row => `${row.date},${row.adjustedPrice},${row.unadjustedPrice}`),
    '',
  ].join('\n')
  const temporaryPath = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(temporaryPath, content, 'utf8')
  fs.rmSync(filePath)
  fs.renameSync(temporaryPath, filePath)
}

function assertIsoDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD: ${value}`)
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be YYYY-MM-DD: ${value}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

export { ensureUnadjustedPricesUnchanged, findCorrections, findMissingExistingRows, mergeRows }
