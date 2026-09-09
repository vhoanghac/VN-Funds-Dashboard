#!/usr/bin/env node
/**
 * Backfill daily stock prices from CafeF's XLSX export endpoint.
 *
 * CafeF limits one export to roughly three calendar months, so this script
 * requests one quarter at a time and writes the adjusted and unadjusted close
 * prices in VND.
 *
 * Usage:
 *   node scripts/stocks/scrape_cafef_stock.mjs --symbol ACB --exchange HOSE --from 2007-01-01 --to 2026-09-08
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(SCRIPT_DIR, '..', '..')
const STOCK_DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'stocks')
const ENDPOINT = 'https://cafef.vn/du-lieu/Ajax/PageNew/DataHistory/PriceHistory.ashx'
const MAX_RETRIES = 3
const REQUEST_DELAY_MS = 150

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  const symbol = (args.symbol || 'ACB').toUpperCase()
  const exchange = normalizeExchange(args.exchange || 'HOSE')
  const from = args.from || '2007-01-01'
  const to = args.to || todayIso()
  const outputPath = path.resolve(args.output || path.join(STOCK_DATA_DIR, `${symbol}.csv`))

  assertIsoDate(from, '--from')
  assertIsoDate(to, '--to')
  if (from > to) throw new Error(`--from must be before --to: ${from} > ${to}`)

  if (fs.existsSync(outputPath) && !args.force) {
    throw new Error(`Output already exists: ${outputPath}. Use --force to overwrite it.`)
  }

  const rowsByDate = new Map()
  let chunkCount = 0

  for (let chunkStart = from; chunkStart <= to;) {
    const naturalChunkEnd = addDays(addMonths(chunkStart, 3), -1)
    const chunkEnd = naturalChunkEnd < to ? naturalChunkEnd : to
    chunkCount++

    const rows = await fetchQuarter(symbol, chunkStart, chunkEnd, exchange)
    for (const row of rows) {
      if (row.date < chunkStart || row.date > chunkEnd) {
        throw new Error(`${symbol}: CafeF returned ${row.date} outside ${chunkStart}..${chunkEnd}`)
      }

      const existing = rowsByDate.get(row.date)
      if (existing && (existing.adjustedPrice !== row.adjustedPrice || existing.unadjustedPrice !== row.unadjustedPrice)) {
        throw new Error(`${symbol}: conflicting values for ${row.date}`)
      }
      rowsByDate.set(row.date, row)
    }

    console.log(`  ${chunkStart}..${chunkEnd}: ${rows.length} sessions`)
    if (chunkEnd < to) await sleep(REQUEST_DELAY_MS)
    chunkStart = addDays(chunkEnd, 1)
  }

  const rows = [...rowsByDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (rows.length === 0) throw new Error(`${symbol}: CafeF returned no rows`)

  validateRows(rows, from, to)
  writeCsv(outputPath, rows)

  console.log(`\nWrote ${rows.length} sessions to ${outputPath}`)
  console.log(`Range returned by CafeF: ${rows[0].date}..${rows[rows.length - 1].date}`)
  console.log(`Chunks: ${chunkCount}`)
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      result.help = true
    } else if (arg === '--force') {
      result.force = true
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
    'Usage: node scripts/stocks/scrape_cafef_stock.mjs [options]',
    '',
    'Options:',
    '  --symbol ACB             Stock symbol (default: ACB)',
    '  --exchange HOSE          CafeF exchange type (default: HOSE)',
    '  --from YYYY-MM-DD        First date (default: 2007-01-01)',
    '  --to YYYY-MM-DD          Last date (default: today)',
    '  --output PATH            Output CSV path',
    '  --force                  Overwrite an existing output file',
    '  --help                   Show this help',
  ].join('\n'))
}

async function fetchQuarter(stockSymbol, startDate, endDate, exchange = 'HOSE') {
  const url = new URL(ENDPOINT)
  url.searchParams.set('Type', 'EXPORT')
  url.searchParams.set('ExchangeType', exchange)
  url.searchParams.set('Symbol', stockSymbol)
  url.searchParams.set('StartDate', toCafeFDate(startDate))
  url.searchParams.set('EndDate', toCafeFDate(endDate))
  url.searchParams.set('PageIndex', '1')
  url.searchParams.set('PageSize', '20')

  let lastError
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'User-Agent': 'VN-Funds-Dashboard/1.0',
        },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('spreadsheetml')) {
        throw new Error(`unexpected content type: ${contentType || 'missing'}`)
      }

      const bytes = Buffer.from(await response.arrayBuffer())
      return parseCafeFXlsx(bytes, stockSymbol)
    } catch (error) {
      lastError = error
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 1000
        console.log(`  Retry ${attempt}/${MAX_RETRIES - 1} for ${startDate}..${endDate} in ${delay}ms`)
        await sleep(delay)
      }
    }
  }

  throw new Error(`${stockSymbol}: failed ${startDate}..${endDate}: ${lastError.message}`)
}

function parseCafeFXlsx(buffer, expectedSymbol) {
  const sharedStrings = parseSharedStrings(readZipEntry(buffer, 'xl/sharedStrings.xml'))
  const sheetXml = readZipEntry(buffer, 'xl/worksheets/sheet1.xml').toString('utf8')
   const rowMatches = [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)]
   if (rowMatches.length === 0) throw new Error('CafeF export contains no header row')
   if (rowMatches.length === 1) return []

  const rows = []
  for (const rowMatch of rowMatches.slice(1)) {
    const cells = parseSheetCells(rowMatch[1], sharedStrings)
    if (cells.A !== expectedSymbol) throw new Error(`CafeF export contains symbol ${cells.A || 'empty'}, expected ${expectedSymbol}`)

    rows.push({
      date: parseCafeFDate(cells.B),
      adjustedPrice: priceInVnd(cells.D),
      unadjustedPrice: priceInVnd(cells.C),
    })
  }

  return rows
}

function parseSharedStrings(xmlBuffer) {
  const xml = xmlBuffer.toString('utf8')
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => {
    const textParts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    return textParts.map(part => decodeXml(part[1])).join('')
  })
}

function parseSheetCells(rowXml, sharedStrings) {
  const cells = {}
  for (const match of rowXml.matchAll(/<c\b([^>]*)>(?:<v>([\s\S]*?)<\/v>)?<\/c>/g)) {
    const attributes = match[1]
    const reference = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1]
    if (!reference) continue

    const rawValue = match[2] ?? ''
    const value = /\bt="s"/.test(attributes)
      ? sharedStrings[Number(rawValue)]
      : rawValue
    cells[reference] = decodeXml(value || '')
  }
  return cells
}

function readZipEntry(buffer, targetName) {
  for (let offset = 0; offset + 46 <= buffer.length; offset++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue

    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength)
    offset += 45 + fileNameLength + extraLength + commentLength

    if (name !== targetName) continue

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)

    if (compressionMethod === 0) return compressed
    if (compressionMethod === 8) return zlib.inflateRawSync(compressed)
    throw new Error(`Unsupported XLSX compression method ${compressionMethod}`)
  }

  throw new Error(`XLSX entry not found: ${targetName}`)
}

function validateRows(rows, from, to) {
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (row.date < from || row.date > to) throw new Error(`Row outside requested range: ${row.date}`)
    if (!Number.isInteger(row.adjustedPrice) || !Number.isInteger(row.unadjustedPrice)) {
      throw new Error(`Non-integer VND price on ${row.date}`)
    }
    if (row.adjustedPrice <= 0 || row.unadjustedPrice <= 0) {
      throw new Error(`Non-positive price on ${row.date}`)
    }
    if (index > 0 && rows[index - 1].date >= row.date) {
      throw new Error(`Dates are not strictly sorted around ${row.date}`)
    }
  }
}

function writeCsv(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const content = [
    'date,adjusted_price,unadjusted_price',
    ...rows.map(row => `${row.date},${row.adjustedPrice},${row.unadjustedPrice}`),
    '',
  ].join('\n')
  const temporaryPath = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(temporaryPath, content, 'utf8')
  if (fs.existsSync(filePath)) fs.rmSync(filePath)
  fs.renameSync(temporaryPath, filePath)
}

function priceInVnd(value) {
  const price = Number(value)
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Invalid CafeF price: ${value}`)
  return Math.round(price * 1000)
}

function parseCafeFDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  if (!match) throw new Error(`Invalid CafeF date: ${value}`)
  return `${match[3]}-${match[2]}-${match[1]}`
}

function assertIsoDate(value, flag) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${flag} must be YYYY-MM-DD: ${value}`)
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${flag} must be YYYY-MM-DD: ${value}`)
  }
}

function toCafeFDate(isoDate) {
  const [year, month, day] = isoDate.split('-')
  return `${month}/${day}/${year}`
}

function addMonths(isoDate, months) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + months, day))
  return date.toISOString().slice(0, 10)
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function normalizeExchange(value) {
  const exchange = String(value).trim().toUpperCase()
  if (!/^[A-Z]+$/.test(exchange)) throw new Error(`Invalid CafeF exchange: ${value}`)
  return exchange
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

export { addDays, fetchQuarter, normalizeExchange, todayIso }
