#!/usr/bin/env node
/**
 * Daily update of SJC gold price data — loops over every asset in GOLD_ASSETS
 * below (currently: vàng miếng SJC 1L/10L/1KG, vàng nhẫn SJC 99,99%).
 *
 * Per asset:
 * - Reads the last date in its CSV
 * - Fetches only newer prices, primary source: sjc.com.vn PriceService.ashx
 *   (same endpoint as scripts/backfill_gold_sjc.mjs, <90-day window per call)
 * - Fallback source: giavang.org's homepage, used when SJC fails/returns
 *   nothing. Vàng miếng đọc chuỗi Highcharts (~30 ngày gần nhất, nhiều điểm
 *   cùng lúc); vàng nhẫn KHÔNG có chuỗi lịch sử trên giavang.org, chỉ có bảng
 *   so sánh giá TRONG NGÀY (mục "Bảng so sánh giá Vàng Nhẫn") — nhưng vì cập
 *   nhật hàng đêm chỉ cần đúng 1 dòng của HÔM NAY (lịch sử cũ đã có sẵn), bảng
 *   này vẫn dùng được làm fallback, chỉ trả về đúng 1 ngày thay vì cả chuỗi.
 * - Appends new rows (date,buy,sell) — never rewrites existing data
 * - Failures are logged and skipped per-asset, never thrown — the daily NAV
 *   workflow must still commit fund updates even if gold fails entirely
 *   (same tolerance as update_nav.mjs's per-fund errors)
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
const DATA_DIR = path.join(__dirname, '..', 'public', 'data')

const PRICE_SERVICE_URL = 'https://sjc.com.vn/GoldPrice/Services/PriceService.ashx'
const GIAVANG_URL = 'https://giavang.org/'
const CHUNK_DAYS = 85 // API caps each request at under 90 days
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Mỗi loại vàng SJC theo dõi: goldPriceId khớp với PriceService.ashx
 * (xem GetCurrentGoldPriceByBranch để tra Id ↔ TypeName nếu SJC thêm sản
 * phẩm mới). `fallback` trỏ tới hàm đọc giavang.org tương ứng — null nếu
 * chưa tìm được nguồn dự phòng cho loại vàng đó.
 */
const GOLD_ASSETS = [
  {
    id: 'GOLD_SJC',
    label: 'Vàng miếng SJC',
    goldPriceId: '1',
    csvFile: path.join(DATA_DIR, 'GOLD_SJC.csv'),
    fallback: fetchMieuFromGiavang,
  },
  {
    id: 'GOLD_NHAN_SJC',
    label: 'Vàng nhẫn SJC 99,99%',
    goldPriceId: '49',
    csvFile: path.join(DATA_DIR, 'GOLD_NHAN_SJC.csv'),
    fallback: fetchNhanFromGiavang,
  },
]

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
function getLastDate(csvFile) {
  if (!fs.existsSync(csvFile)) return null
  const lines = fs.readFileSync(csvFile, 'utf-8').trim().split('\n')
  if (lines.length <= 1) return null
  return lines[lines.length - 1].split(',')[0] || null
}

function appendRows(csvFile, rows) {
  if (rows.length === 0) return 0
  const existing = fs.readFileSync(csvFile, 'utf-8')
  const prefix = existing.endsWith('\n') ? '' : '\n'
  const lines = rows.map(r => `${r.date},${r.buy},${r.sell}`).join('\n')
  fs.appendFileSync(csvFile, prefix + lines + '\n')
  return rows.length
}

// NOTE: sjc.com.vn sits behind Cloudflare, which fingerprints Node's native
// fetch()/undici TLS handshake and serves a JS challenge instead of JSON
// (curl's TLS fingerprint isn't flagged). Shelling out to curl sidesteps this
// without a headless browser — same approach as the backfill scripts.
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

async function fetchFromSJC(goldPriceId, fromDate, toDate) {
  const ticks = []
  let cur = new Date(fromDate)
  const end = new Date(toDate)

  while (cur <= end) {
    const chunkEnd = new Date(cur)
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS)
    const to = chunkEnd > end ? end : chunkEnd

    const params = new URLSearchParams({
      method: 'GetGoldPriceHistory',
      goldPriceId,
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
 * Vàng miếng: giavang.org's homepage embeds the last ~30 days of SJC MIẾNG
 * buy/sell ticks as a server-rendered Highcharts series:
 *   seriesOptions = [{name:"Mua vào",data:[[ms,145.7],...]},{name:"Bán ra",data:[...]}]
 * Prices are in TRIỆU đồng/lượng → ×1,000,000 to match our CSV unit.
 */
async function fetchMieuFromGiavang() {
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

/**
 * Vàng nhẫn: giavang.org KHÔNG có chuỗi lịch sử cho nhẫn, nhưng có mục
 * "Bảng so sánh giá Vàng Nhẫn 1 Chỉ" (id="gia_vang_nhan") — bảng so sánh giá
 * TRONG NGÀY của nhiều thương hiệu (SJC, PNJ, DOJI...). Chỉ lấy đúng dòng SJC
 * đầu tiên trong bảng đó, trả về 1 dòng duy nhất cho HÔM NAY — đủ dùng cho
 * cập nhật hàng đêm (lịch sử cũ đã có sẵn trong CSV, chỉ cần nối thêm 1 ngày).
 * Giá ghi dạng "141.900" (đơn vị x1000đ/lượng, dấu chấm là phân cách nghìn)
 * → bỏ dấu chấm rồi ×1000 ra VND, khớp đơn vị CSV.
 */
async function fetchNhanFromGiavang() {
  const html = await curlGet(GIAVANG_URL)

  const sectionIdx = html.indexOf('id="gia_vang_nhan"')
  if (sectionIdx === -1) throw new Error('giavang.org: gia_vang_nhan section not found')
  const section = html.slice(sectionIdx, sectionIdx + 5000)

  const m = /title="Giá vàng SJC"[^>]*><strong>SJC<\/strong><\/a><\/td><td class="">([\d.,]+)<\/td><td class="">([\d.,]+)<\/td>/.exec(section)
  if (!m) throw new Error('giavang.org: SJC row not found in gia_vang_nhan table')

  const parseThousands = (s) => parseInt(s.replace(/[.,]/g, ''), 10) * 1000
  const buy = parseThousands(m[1])
  const sell = parseThousands(m[2])
  if (isNaN(buy) || isNaN(sell) || buy <= 0 || sell <= 0) {
    throw new Error(`giavang.org: unparseable SJC ring gold price (${m[1]}/${m[2]})`)
  }

  return [{ date: toDateStr(new Date()), buy, sell }]
}

// ─── Per-asset update ─────────────────────────────────────

async function updateAsset(asset) {
  const lastDate = getLastDate(asset.csvFile)
  if (!lastDate) {
    console.error(`❌ ${asset.id}: CSV missing or empty — run the matching backfill script first`)
    return
  }

  const today = toDateStr(new Date())
  if (lastDate >= today) {
    console.log(`✅ ${asset.id}: already up to date (last: ${lastDate})`)
    return
  }

  // Refetch từ chính ngày lastDate (không phải hôm sau): giá SJC cập nhật nhiều
  // lần trong ngày, dòng cuối CSV có thể là tick giữa phiên — lấy lại cả ngày
  // đó rồi lọc `> lastDate` để chỉ append ngày mới, ngày cũ giữ nguyên.
  let rows = null
  try {
    rows = await fetchFromSJC(asset.goldPriceId, new Date(lastDate), new Date())
    console.log(`📡 ${asset.id}: sjc.com.vn fetched ${rows.length} daily rows`)
  } catch (err) {
    console.error(`⚠️  ${asset.id}: sjc.com.vn failed (${err.message})`)
    if (!asset.fallback) {
      console.error(`❌ ${asset.id}: no update this run (no fallback source configured)`)
      return
    }
    console.error(`   falling back to giavang.org...`)
    try {
      rows = await asset.fallback()
      console.log(`📡 ${asset.id}: giavang.org fetched ${rows.length} daily rows`)
    } catch (err2) {
      console.error(`❌ ${asset.id}: giavang.org also failed (${err2.message})`)
      console.error(`❌ ${asset.id}: no update this run (both sources failed)`)
      return
    }
  }

  const newRows = rows.filter(r => r.date > lastDate)
  if (newRows.length === 0) {
    console.log(`✅ ${asset.id}: no new dates (last: ${lastDate})`)
    return
  }

  const count = appendRows(asset.csvFile, newRows)
  console.log(`📈 ${asset.id}: +${count} rows (${lastDate} → ${newRows[newRows.length - 1].date})`)
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  console.log('🏅 SJC Gold Price Updater\n')
  for (const asset of GOLD_ASSETS) {
    try {
      await updateAsset(asset)
    } catch (err) {
      // Không fail cả script — các loại vàng khác và giá quỹ vẫn phải được commit
      console.error(`❌ ${asset.id}: unexpected error: ${err.message}`)
    }
  }
}

main().catch(err => {
  console.error('❌ Gold update error:', err.message)
})
