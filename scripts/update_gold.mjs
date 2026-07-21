#!/usr/bin/env node
/**
 * Daily update of SJC gold price data (Hồ Chí Minh, vàng miếng SJC 1L/10L/1KG).
 *
 * - Reads the last date in public/data/GOLD_SJC.csv
 * - Fetches only newer prices, primary source: sjc.com.vn PriceService.ashx
 *   (same endpoint as scripts/backfill_gold_sjc.mjs, <90-day window per call)
 * - Fallback source: giavang.org homepage (server-rendered Highcharts series,
 *   last ~30 days of buy/sell ticks) — used when SJC fails/returns nothing
 * - Appends new rows (date,buy,sell) — never rewrites existing data
 * - Exits 0 even when both sources fail, so the daily NAV workflow still
 *   commits fund updates (same tolerance as update_nav.mjs's per-fund errors)
 *
 * Usage:  node scripts/update_gold.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSV_FILE = path.join(__dirname, '..', 'public', 'data', 'GOLD_SJC.csv')

const PRICE_SERVICE_URL = 'https://sjc.com.vn/GoldPrice/Services/PriceService.ashx'
const GIAVANG_URL = 'https://giavang.org/'
const GOLD_PRICE_ID = '1' // Vàng SJC 1L, 10L, 1KG — Hồ Chí Minh
const CHUNK_DAYS = 85 // API caps each request at under 90 days

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function fmtDDMMYYYY(d) {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Last date (YYYY-MM-DD) already in the CSV, or null if missing/empty. */
function getLastDate() {
  if (!fs.existsSync(CSV_FILE)) return null
  const lines = fs.readFileSync(CSV_FILE, 'utf-8').trim().split('\n')
  if (lines.length <= 1) return null
  return lines[lines.length - 1].split(',')[0] || null
}

function appendRows(rows) {
  if (rows.length === 0) return 0
  const existing = fs.readFileSync(CSV_FILE, 'utf-8')
  const prefix = existing.endsWith('\n') ? '' : '\n'
  const lines = rows.map(r => `${r.date},${r.buy},${r.sell}`).join('\n')
  fs.appendFileSync(CSV_FILE, prefix + lines + '\n')
  return rows.length
}

// NOTE: sjc.com.vn sits behind Cloudflare, which fingerprints Node's native
// fetch()/undici TLS handshake and serves a JS challenge instead of JSON
// (curl's TLS fingerprint isn't flagged). Shelling out to curl sidesteps this
// without a headless browser — same approach as backfill_gold_sjc.mjs.
async function curlGet(url, postData) {
  const args = [
    '-s', '--max-time', '20',
    '-H', `User-Agent: ${USER_AGENT}`,
    url,
  ]
  if (postData !== undefined) {
    args.push('-X', 'POST', '-H', 'Content-Type: application/x-www-form-urlencoded', '--data', postData)
  }
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 })
  return stdout
}

/** Dedupe raw ticks (ms timestamp) to one row per calendar day — last tick wins. */
function dedupeByDay(ticks) {
  const byDay = new Map()
  for (const t of ticks) {
    const d = new Date(t.ts)
    const dateStr = toDateStr(d)
    const existing = byDay.get(dateStr)
    if (!existing || t.ts >= existing.ts) byDay.set(dateStr, t)
  }
  return [...byDay.entries()]
    .map(([date, t]) => ({ date, buy: Math.round(t.buy), sell: Math.round(t.sell) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Primary: sjc.com.vn ──────────────────────────────────

async function fetchFromSJC(fromDate, toDate) {
  const ticks = []
  let cur = new Date(fromDate)
  const end = new Date(toDate)

  while (cur <= end) {
    const chunkEnd = new Date(cur)
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS)
    const to = chunkEnd > end ? end : chunkEnd

    const params = new URLSearchParams({
      method: 'GetGoldPriceHistory',
      goldPriceId: GOLD_PRICE_ID,
      fromDate: fmtDDMMYYYY(cur),
      toDate: fmtDDMMYYYY(to),
    })
    const body = await curlGet(PRICE_SERVICE_URL, params.toString())
    const json = JSON.parse(body)
    if (!json.success) throw new Error(json.message || 'SJC API error')

    for (const item of json.data || []) {
      const m = /\/Date\((\d+)\)\//.exec(item.GroupDate)
      if (!m) continue
      ticks.push({ ts: parseInt(m[1], 10), buy: item.BuyValue, sell: item.SellValue })
    }

    cur = new Date(to)
    cur.setDate(cur.getDate() + 1)
    if (cur <= end) await sleep(200)
  }

  return dedupeByDay(ticks)
}

// ─── Fallback: giavang.org ────────────────────────────────

/**
 * giavang.org's homepage embeds the last ~30 days of SJC buy/sell ticks as a
 * server-rendered Highcharts series:
 *   seriesOptions = [{name:"Mua vào",data:[[ms,145.7],...]},{name:"Bán ra",data:[...]}]
 * Prices are in TRIỆU đồng/lượng → ×1,000,000 to match our CSV unit.
 */
async function fetchFromGiavang() {
  const html = await curlGet(GIAVANG_URL)

  function extractSeries(name) {
    const re = new RegExp(`name:\\s*"${name}"\\s*,\\s*data:\\s*(\\[\\[[\\s\\S]*?\\]\\])`)
    const m = re.exec(html)
    if (!m) throw new Error(`giavang.org: series "${name}" not found`)
    return JSON.parse(m[1])
  }

  const buySeries = extractSeries('Mua vào')
  const sellSeries = extractSeries('Bán ra')

  const sellByTs = new Map(sellSeries.map(([ts, v]) => [ts, v]))
  const ticks = []
  for (const [ts, buyTr] of buySeries) {
    const sellTr = sellByTs.get(ts)
    if (sellTr === undefined) continue
    ticks.push({ ts, buy: buyTr * 1_000_000, sell: sellTr * 1_000_000 })
  }
  if (ticks.length === 0) throw new Error('giavang.org: no matching buy/sell ticks')

  return dedupeByDay(ticks)
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  console.log('🏅 SJC Gold Price Updater\n')

  const lastDate = getLastDate()
  if (!lastDate) {
    console.error('❌ GOLD_SJC.csv missing or empty — run scripts/backfill_gold_sjc.mjs first')
    return
  }

  const today = toDateStr(new Date())
  if (lastDate >= today) {
    console.log(`✅ GOLD_SJC: already up to date (last: ${lastDate})`)
    return
  }

  // Refetch từ chính ngày lastDate (không phải hôm sau): giá SJC cập nhật nhiều
  // lần trong ngày, dòng cuối CSV có thể là tick giữa phiên — lấy lại cả ngày
  // đó rồi lọc `> lastDate` để chỉ append ngày mới, ngày cũ giữ nguyên.
  const from = new Date(lastDate)

  let rows = null
  try {
    rows = await fetchFromSJC(from, new Date())
    console.log(`📡 sjc.com.vn: fetched ${rows.length} daily rows`)
  } catch (err) {
    console.error(`⚠️  sjc.com.vn failed (${err.message}), falling back to giavang.org...`)
    try {
      rows = await fetchFromGiavang()
      console.log(`📡 giavang.org: fetched ${rows.length} daily rows`)
    } catch (err2) {
      console.error(`❌ giavang.org also failed: ${err2.message}`)
      console.error('❌ GOLD_SJC: no update this run (both sources failed)')
      return // exit 0: don't block the fund NAV commit
    }
  }

  const newRows = rows.filter(r => r.date > lastDate)
  if (newRows.length === 0) {
    console.log(`✅ GOLD_SJC: no new dates (last: ${lastDate})`)
    return
  }

  const count = appendRows(newRows)
  console.log(`📈 GOLD_SJC: +${count} rows (${lastDate} → ${newRows[newRows.length - 1].date})`)
}

main().catch(err => {
  // Không fail workflow — giá quỹ vẫn phải được commit dù vàng lỗi
  console.error('❌ Gold update error:', err.message)
})
