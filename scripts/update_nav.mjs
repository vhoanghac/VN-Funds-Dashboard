#!/usr/bin/env node
/**
 * Update fund NAV data from fmarket.vn API.
 *
 * - Reads existing CSV files in public/data/
 * - Fetches new NAV data from fmarket API (only dates after the last existing date)
 * - Appends new rows to existing CSV files (never deletes old data)
 * - ETFs (E1VFVN30, FUEVFVND, FUEDCMID) are fetched from a stock price API
 *
 * Usage:  node scripts/update_nav.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'public', 'data')
const METADATA_FILE = path.join(DATA_DIR, 'fund_metadata.json')

// ─── Fmarket API ──────────────────────────────────────────

const FMARKET_FILTER_URL = 'https://api.fmarket.vn/res/products/filter'
const FMARKET_NAV_URL = 'https://api.fmarket.vn/res/product/get-nav-history'

const FMARKET_FILTER_BODY = {
  types: ['NEW_FUND', 'TRADING_FUND'],
  issuerIds: [],
  sortOrder: 'DESC',
  sortField: 'navTo6Months',
  page: 1,
  pageSize: 200,
  isIpo: false,
  fundAssetTypes: [],
  bondRemainPeriods: [],
  searchField: '',
  isBuyByReward: false,
  thirdAppIds: [],
}

// ETF ticker → stock symbol mapping (traded on exchange, not on fmarket)
const ETF_TICKERS = {
  E1VFVN30: 'E1VFVN30',
  FUEVFVND: 'FUEVFVND',
  FUEDCMID: 'FUEDCMID',
}

// Funds not listed on fmarket — handled by scripts/update_TCEF_TCBF_digiinvest.mjs
const DIGIINVEST_FUNDS = new Set(['TCBF', 'TCEF'])


// ─── Helpers ──────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function today() {
  const d = new Date()
  return d.toISOString().substring(0, 10) // YYYY-MM-DD
}

function todayCompact() {
  return today().replace(/-/g, '') // YYYYMMDD
}

/** Read a CSV file and return the last date string, or null if empty */
function getLastDate(csvPath) {
  if (!fs.existsSync(csvPath)) return null
  const content = fs.readFileSync(csvPath, 'utf-8').trim()
  const lines = content.split('\n')
  if (lines.length <= 1) return null // header only
  const lastLine = lines[lines.length - 1]
  const date = lastLine.split(',')[0]
  return date || null
}

/** Append rows to a CSV file (rows = [{date, price}]) */
function appendToCSV(csvPath, rows) {
  if (rows.length === 0) return 0
  // Ensure file ends with newline before appending
  const existing = fs.readFileSync(csvPath, 'utf-8')
  const prefix = existing.endsWith('\n') ? '' : '\n'
  const lines = rows.map(r => `${r.date},${r.price}`).join('\n')
  fs.appendFileSync(csvPath, prefix + lines + '\n')
  return rows.length
}

// ─── Fmarket: fetch product catalog ───────────────────────

async function fetchFmarketCatalog() {
  console.log('📋 Fetching fmarket fund catalog...')
  const resp = await fetch(FMARKET_FILTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(FMARKET_FILTER_BODY),
  })

  if (!resp.ok) throw new Error(`Fmarket catalog API error: ${resp.status}`)

  const json = await resp.json()
  const rows = json.data?.rows || json.data || []

  // Build lookup: shortName → productId, also try code
  const catalog = new Map()
  for (const row of rows) {
    if (row.shortName) catalog.set(row.shortName.toUpperCase(), row.id)
    if (row.code) catalog.set(row.code.toUpperCase(), row.id)
    // Also try without dashes
    if (row.shortName) catalog.set(row.shortName.replace(/-/g, '').toUpperCase(), row.id)
    if (row.code) catalog.set(row.code.replace(/-/g, '').toUpperCase(), row.id)
  }

  console.log(`   Found ${rows.length} funds in fmarket catalog`)
  return catalog
}

// ─── Fmarket: fetch NAV history for a fund ────────────────

async function fetchFmarketNAV(productId, fromDate) {
  const body = {
    isAllData: fromDate ? 0 : 1,
    productId,
    fromDate: fromDate || null,
    toDate: todayCompact(),
  }

  const resp = await fetch(FMARKET_NAV_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!resp.ok) throw new Error(`NAV API error: ${resp.status}`)

  const json = await resp.json()
  const data = json.data || []

  // Convert to {date, price} sorted by date ascending
  return data
    .map(d => ({ date: d.navDate, price: d.nav }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ─── ETF: delegate to update_vnstock.py ───────────────────

async function updateETFs() {
  const { execSync } = await import('child_process')
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const pyScript = path.join(scriptDir, 'update_vnstock.py')

  try {
    const output = execSync(`python -X utf8 "${pyScript}"`, {
      encoding: 'utf-8',
      timeout: 120000,
      cwd: scriptDir,
    })
    // Print python output (ETF + mapped fund updates)
    output.split('\n').forEach(line => {
      if (line.trim()) console.log(`  ${line}`)
    })
  } catch (err) {
    console.error('❌ vnstock update failed:', err.message)
  }
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 Fund NAV Updater — ${today()}\n`)

  // Load metadata
  const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'))
  console.log(`📂 Found ${metadata.length} funds in metadata\n`)

  // Separate mutual funds vs ETFs
  const mutualFunds = metadata.filter(f => !ETF_TICKERS[f.id] && !DIGIINVEST_FUNDS.has(f.id))
  const etfs = metadata.filter(f => ETF_TICKERS[f.id])

  // ── Mutual Funds via fmarket ──
  let catalog
  try {
    catalog = await fetchFmarketCatalog()
  } catch (err) {
    console.error('❌ Failed to fetch fmarket catalog:', err.message)
    catalog = new Map()
  }

  let updatedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const fund of mutualFunds) {
    const csvPath = path.join(DATA_DIR, fund.csv_file)
    const lastDate = getLastDate(csvPath)

    // Find productId in catalog
    const productId = catalog.get(fund.id.toUpperCase())
      || catalog.get(fund.id.replace(/-/g, '').toUpperCase())

    if (!productId) {
      console.log(`⚠️  ${fund.id}: not found in fmarket catalog — skipped`)
      skippedCount++
      continue
    }

    try {
      // Fetch NAV data from the day after last existing date
      const navData = await fetchFmarketNAV(productId, lastDate)

      // Filter to only new dates (strictly after lastDate)
      const newRows = lastDate
        ? navData.filter(r => r.date > lastDate)
        : navData

      if (newRows.length === 0) {
        console.log(`✅ ${fund.id}: already up to date (last: ${lastDate})`)
        skippedCount++
      } else {
        const count = appendToCSV(csvPath, newRows)
        const newLastDate = newRows[newRows.length - 1].date
        console.log(`📈 ${fund.id}: +${count} rows (${lastDate || 'start'} → ${newLastDate})`)
        updatedCount++
      }
    } catch (err) {
      console.error(`❌ ${fund.id}: ${err.message}`)
      errorCount++
    }

    // Polite delay to avoid rate limiting
    await sleep(300)
  }

  // ── ETFs + mapped funds via vnstock Python ──
  console.log('\n📊 Updating ETFs & mapped funds via vnstock...\n')
  await updateETFs()

  // ── Summary ──
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`✅ Updated: ${updatedCount}`)
  console.log(`⏭️  Skipped (up to date): ${skippedCount}`)
  console.log(`❌ Errors: ${errorCount}`)
  console.log(`${'─'.repeat(50)}\n`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
