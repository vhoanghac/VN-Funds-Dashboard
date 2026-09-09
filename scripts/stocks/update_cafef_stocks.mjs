#!/usr/bin/env node
/**
 * Append stock prices from CafeF and fail on historical corrections.
 *
 * The updater reloads the latest three months so it can detect CafeF changes
 * to either price column before writing anything.
 *
 * Usage:
 *   node scripts/stocks/update_cafef_stocks.mjs --symbol ACB
 *   node scripts/stocks/update_cafef_stocks.mjs --symbols-file scripts/stocks/stock_symbols.txt
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addDays, fetchQuarter, normalizeExchange, todayIso } from './scrape_cafef_stock.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(SCRIPT_DIR, '..', '..')
const STOCK_DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'stocks')
const HEADER = 'date,adjusted_price,unadjusted_price'

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
  const fetchStart = addDays(lastDate, -90)
  const fetchedRows = await fetchQuarter(symbol, fetchStart, to, exchange)
  const existingByDate = new Map(existingRows.map(row => [row.date, row]))
  const corrections = []

  for (const row of fetchedRows) {
    const existing = existingByDate.get(row.date)
    if (existing && (existing.adjustedPrice !== row.adjustedPrice || existing.unadjustedPrice !== row.unadjustedPrice)) {
      corrections.push({ date: row.date, existing, fetched: row })
    }
  }

  if (corrections.length > 0) {
    const details = corrections.slice(0, 10).map(item => (
      `${item.date}: ${item.existing.adjustedPrice}/${item.existing.unadjustedPrice} -> ${item.fetched.adjustedPrice}/${item.fetched.unadjustedPrice}`
    ))
    throw new Error([
      `CafeF changed ${corrections.length} historical row(s); no file was written.`,
      ...details,
    ].join('\n'))
  }

  const newRows = fetchedRows.filter(row => row.date > lastDate)
  const mergedRows = [...existingRows, ...newRows].sort((a, b) => a.date.localeCompare(b.date))
  validateRows(mergedRows)

  console.log(`${symbol}: checked ${fetchedRows.length} CafeF sessions (${fetchStart}..${to})`)
  if (newRows.length === 0) {
    console.log(`Already up to date (last: ${lastDate})`)
    return
  }

  console.log(`New sessions: ${newRows.length} (${newRows[0].date}..${newRows[newRows.length - 1].date})`)
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
