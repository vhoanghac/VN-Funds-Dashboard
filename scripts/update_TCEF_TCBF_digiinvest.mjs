#!/usr/bin/env node
/**
 * Update NAV data for funds that only appear on digiinvest.vn (TCBF, TCEF).
 *
 * digiinvest.vn/ccq/<fund>/ is a static page: the chart reads a public Google
 * Sheet through the Sheets v4 API. One sheet holds every fund, one column per
 * fund ("Giá TCBF", "Giá TCEF"), one row per date, newest row first.
 * We hit that same sheet directly — no scraping, no headless browser.
 *
 * - Creates public/data/<ID>.csv with the full history if missing
 * - Otherwise appends only rows strictly after the last existing date
 * - Never rewrites old rows
 *
 * Usage:  node scripts/update_TCEF_TCBF_digiinvest.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'public', 'data')

// Values lifted from the page source of https://digiinvest.vn/ccq/tcbf/
// (public read-only API key embedded in the page's client-side JS).
const SHEET_ID = '1c_QgP-wTow7ZpjmGpe6f2QYd8EQqbudllhW2O1GfcGM'
const RANGE = 'Sheet1!A:AF'
const API_KEY = 'AIzaSyD5BcA-3QajKBkOYgFjwnawkyf81Gw5A8Y'

// Fund id → header label in the sheet
const FUNDS = {
  TCBF: 'Giá TCBF',
  TCEF: 'Giá TCEF',
}

function getLastDate(csvPath) {
  if (!fs.existsSync(csvPath)) return null
  const content = fs.readFileSync(csvPath, 'utf-8').trim()
  const lines = content.split('\n')
  if (lines.length <= 1) return null
  return lines[lines.length - 1].split(',')[0] || null
}

function appendToCSV(csvPath, rows) {
  if (rows.length === 0) return 0
  const existing = fs.readFileSync(csvPath, 'utf-8')
  const prefix = existing.endsWith('\n') ? '' : '\n'
  fs.appendFileSync(csvPath, prefix + rows.map(r => `${r.date},${r.price}`).join('\n') + '\n')
  return rows.length
}

async function fetchSheet() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(RANGE)}?key=${API_KEY}`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Sheets API error: ${resp.status}`)
  const json = await resp.json()
  const values = json.values
  if (!Array.isArray(values) || values.length < 2) throw new Error('Sheet returned no rows')
  return values
}

/** Pull one fund's column out of the sheet, ascending by date, blanks dropped */
function extractSeries(values, header) {
  const col = values[0].indexOf(header)
  if (col === -1) throw new Error(`Column "${header}" not found in sheet header`)

  const rows = []
  for (const row of values.slice(1)) {
    const date = (row[0] || '').trim()
    const raw = (row[col] || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (raw === '') continue
    const price = Number(raw.replace(/,/g, ''))
    if (!Number.isFinite(price) || price <= 0) continue
    rows.push({ date, price })
  }
  rows.sort((a, b) => a.date.localeCompare(b.date))
  return rows
}

async function main() {
  console.log(`\n🏦 digiinvest NAV Updater — ${new Date().toISOString().substring(0, 10)}\n`)

  const values = await fetchSheet()
  console.log(`📋 Sheet loaded: ${values.length - 1} date rows, ${values[0].length} columns\n`)

  let updated = 0
  let skipped = 0
  let errors = 0

  for (const [id, header] of Object.entries(FUNDS)) {
    const csvPath = path.join(DATA_DIR, `${id}.csv`)
    try {
      const series = extractSeries(values, header)
      if (series.length === 0) throw new Error('no usable rows in column')

      if (!fs.existsSync(csvPath)) {
        const body = series.map(r => `${r.date},${r.price}`).join('\n')
        fs.writeFileSync(csvPath, `date,price\n${body}\n`)
        console.log(`🆕 ${id}: created with ${series.length} rows (${series[0].date} → ${series[series.length - 1].date})`)
        updated++
        continue
      }

      const lastDate = getLastDate(csvPath)
      const newRows = lastDate ? series.filter(r => r.date > lastDate) : series

      if (newRows.length === 0) {
        console.log(`✅ ${id}: already up to date (last: ${lastDate})`)
        skipped++
      } else {
        appendToCSV(csvPath, newRows)
        console.log(`📈 ${id}: +${newRows.length} rows (${lastDate} → ${newRows[newRows.length - 1].date})`)
        updated++
      }
    } catch (err) {
      console.error(`❌ ${id}: ${err.message}`)
      errors++
    }
  }

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`✅ Updated: ${updated}   ⏭️  Skipped: ${skipped}   ❌ Errors: ${errors}`)
  console.log(`${'─'.repeat(50)}\n`)

  if (errors > 0) process.exit(1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
