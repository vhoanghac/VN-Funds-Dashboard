#!/usr/bin/env node
/**
 * One-time backfill of historical SJC ring gold price data (Hồ Chí Minh, vàng
 * nhẫn SJC 99,99% 1 chỉ/2 chỉ/5 chỉ) from sjc.com.vn's internal
 * PriceService.ashx endpoint.
 *
 * Same approach as backfill_gold_sjc.mjs (vàng miếng), just a different
 * goldPriceId and output file. Data actually starts ~2016-01 (checked via
 * curl: empty through all of 2015, has data by early 2016) — buffer from
 * 2015-06-01 same as the miếng backfill's pre-start buffer pattern.
 *
 * The endpoint caps each request at under 90 days, so this fetches in ~85-day
 * chunks, dedupes to one row per calendar day (last tick of the day wins),
 * and writes public/data/GOLD_NHAN_SJC.csv with columns: date,buy,sell (raw
 * VND per lượng — same unit as GOLD_SJC.csv for consistency).
 *
 * Usage:  node scripts/backfill_gold_nhan_sjc.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'public', 'data')
const OUT_FILE = path.join(DATA_DIR, 'GOLD_NHAN_SJC.csv')

const PRICE_SERVICE_URL = 'https://sjc.com.vn/GoldPrice/Services/PriceService.ashx'
const GOLD_PRICE_ID = '49' // Vàng nhẫn SJC 99,99% 1 chỉ, 2 chỉ, 5 chỉ — Hồ Chí Minh
const CHUNK_DAYS = 85 // safely under the API's 90-day limit

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function fmtDate(d) {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

function buildChunks(start, end) {
  const chunks = []
  let cur = new Date(start)
  while (cur < end) {
    const chunkEnd = new Date(cur)
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS)
    const to = chunkEnd > end ? end : chunkEnd
    chunks.push([new Date(cur), new Date(to)])
    cur = new Date(to)
    cur.setDate(cur.getDate() + 1)
  }
  return chunks
}

// NOTE: sjc.com.vn sits behind Cloudflare, which fingerprints Node's native
// fetch()/undici TLS handshake and serves a JS challenge page instead of JSON
// (curl's TLS fingerprint isn't flagged). Shelling out to curl sidesteps this
// without needing a headless browser.
async function fetchChunk(fromDate, toDate) {
  const params = new URLSearchParams({
    method: 'GetGoldPriceHistory',
    goldPriceId: GOLD_PRICE_ID,
    fromDate,
    toDate,
  })
  const { stdout } = await execFileAsync('curl', [
    '-s',
    '-X', 'POST',
    PRICE_SERVICE_URL,
    '-H', 'Content-Type: application/x-www-form-urlencoded',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '--data', params.toString(),
    '--max-time', '15',
  ])
  const json = JSON.parse(stdout)
  if (!json.success) throw new Error(json.message || 'unknown API error')
  return json.data || []
}

async function main() {
  console.log('💍 SJC Ring Gold (Nhẫn) Price Backfill\n')

  const start = new Date(2015, 5, 1) // buffer before real start (~2016-01)
  const end = new Date()
  const chunks = buildChunks(start, end)
  console.log(`📅 Range: ${fmtDate(start)} → ${fmtDate(end)} (${chunks.length} chunks of ~${CHUNK_DAYS} days)\n`)

  const all = []
  let errors = 0

  for (let i = 0; i < chunks.length; i++) {
    const [from, to] = chunks[i]
    const fromDate = fmtDate(from)
    const toDate = fmtDate(to)
    try {
      const data = await fetchChunk(fromDate, toDate)
      all.push(...data)
      console.log(`  [${i + 1}/${chunks.length}] ${fromDate} → ${toDate}: +${data.length} ticks`)
    } catch (err) {
      errors++
      console.error(`  [${i + 1}/${chunks.length}] ${fromDate} → ${toDate}: ERROR ${err.message}`)
    }
    await sleep(200)
  }

  console.log(`\n📊 Raw ticks fetched: ${all.length} (errors: ${errors})`)

  // Dedupe to one row per calendar day — last tick of the day wins.
  const byDay = new Map()
  for (const item of all) {
    const m = /\/Date\((\d+)\)\//.exec(item.GroupDate)
    if (!m) continue
    const ts = parseInt(m[1], 10)
    const d = new Date(ts)
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const existing = byDay.get(dateStr)
    if (!existing || ts >= existing.ts) {
      byDay.set(dateStr, { ts, buy: Math.round(item.BuyValue), sell: Math.round(item.SellValue) })
    }
  }

  const dates = [...byDay.keys()].sort()
  const rows = ['date,buy,sell']
  for (const d of dates) {
    const v = byDay.get(d)
    rows.push(`${d},${v.buy},${v.sell}`)
  }

  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, rows.join('\n') + '\n')

  console.log(`\n✅ Wrote ${dates.length} daily rows (${dates[0]} → ${dates[dates.length - 1]}) to ${path.relative(process.cwd(), OUT_FILE)}\n`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
