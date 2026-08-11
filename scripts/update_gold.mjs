#!/usr/bin/env node
/**
 * Daily update of gold price data — loops over every asset in GOLD_ASSETS
 * below (currently: vàng miếng SJC 1L/10L/1KG, vàng nhẫn SJC 99,99%, vàng
 * nhẫn DOJI).
 *
 * Per asset:
 * - Reads the last date in its CSV
 * - Fetches only newer prices from the asset's primary source (`fetch`):
 *   + Vàng SJC (miếng + nhẫn): sjc.com.vn PriceService.ashx (<90-day window
 *     per call; lịch sử gốc đã có sẵn trong CSV từ các backfill một lần trước)
 *   + Vàng nhẫn DOJI: banggia.doji.vn GetTablePrice (giá HÔM NAY của chính
 *     DOJI, mã hoá AES — chính xác hơn aggregator, dòng nhẫn lấy theo
 *     materialCode 03 "NHẪN TRÒN 9999 HƯNG THỊNH VƯỢNG", đơn vị nghìn
 *     VND/chỉ × 10.000 ra VND/lượng)
 * - Fallback source per asset (`fallback`), used when the primary fails:
 *   + Vàng SJC: giavang.org (miếng đọc chuỗi Highcharts ~30 ngày; nhẫn chỉ có
 *     bảng so sánh TRONG NGÀY, đủ cho 1 dòng của hôm nay)
 *   + Vàng nhẫn DOJI: simplize.vn's chart API (period=3y_d trả cả chuỗi ~2,4
 *     năm mỗi lần gọi; updateAsset lọc `> lastDate` rồi append, tự vá luôn
 *     ngày thiếu gần đây nếu nguồn bổ sung)
 * - Appends new rows (date,buy,sell) — never rewrites existing data
 * - Failures are logged and skipped per-asset, never thrown — the daily NAV
 *   workflow must still commit fund updates even if gold fails entirely
 *   (same tolerance as update_nav.mjs's per-fund errors)
 *
 * Usage:  node scripts/update_gold.mjs
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
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
const SIMPLIZE_CHART_URL = 'https://api2.simplize.vn/api/historical/prices/chart'
const SIMPLIZE_PERIOD = '3y_d' // 3y mốc theo ngày — sâu nhất simplize có (từ 2024-03-18)
const DOJI_BANGGIA_URL = 'https://banggia.doji.vn/api/TablePrice/GetTablePrice'
// Key AES-256 lấy từ JS của chính banggia.doji.vn (chunk c1, class Z0._k).
const DOJI_DECRYPT_KEY = '7a4b8c3d1e9f2a5b6c0d4e8f3a7b1c5d9e2f6a0b4c8d3e7f1a5b9c2d6e0f4a8b'

/**
 * Mỗi loại vàng theo dõi: `fetch(lastDate)` là nguồn chính, trả danh sách
 * `{date,buy,sell}` (với SJC = gọi PriceService.ashx theo goldPriceId, xem
 * GetCurrentGoldPriceByBranch để tra Id ↔ TypeName nếu SJC thêm sản phẩm mới;
 * với vàng nhẫn DOJI = gọi banggia.doji.vn, trả 1 dòng của hôm nay). `fallback`
 * là nguồn dự phòng khi nguồn chính lỗi.
 */
const GOLD_ASSETS = [
  {
    id: 'GOLD_SJC',
    label: 'Vàng miếng SJC',
    csvFile: path.join(DATA_DIR, 'GOLD_SJC.csv'),
    fetch: (lastDate) => fetchFromSJC('1', new Date(lastDate), new Date()),
    fallback: fetchMieuFromGiavang,
  },
  {
    id: 'GOLD_NHAN_SJC',
    label: 'Vàng nhẫn SJC 99,99%',
    csvFile: path.join(DATA_DIR, 'GOLD_NHAN_SJC.csv'),
    fetch: (lastDate) => fetchFromSJC('49', new Date(lastDate), new Date()),
    fallback: fetchNhanFromGiavang,
  },
  {
    id: 'GOLD_NHAN_DOJI',
    label: 'Vàng nhẫn DOJI (Hưng Thịnh Vượng)',
    csvFile: path.join(DATA_DIR, 'GOLD_NHAN_DOJI.csv'),
    fetch: () => fetchDojiNhanFromBanggia(),
    fallback: fetchDojiNhanFromSimplize,
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

/** Ngày (UTC) từ timestamp giây — dùng cho API trả epoch (simplize). */
function utcDateStr(tsSeconds) {
  const d = new Date(tsSeconds * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Ngày lịch Việt Nam (UTC+7) từ chuỗi ISO có 'Z' — DOJI updateDate. */
function vnDateStr(iso) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
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

// ─── Vàng nhẫn DOJI: banggia.doji.vn (chính) + simplize (dự phòng) ──

/**
 * Giải mã payload AES-256-CBC của banggia.doji.vn: base64 → IV 16 byte đầu,
 * phần còn lại là ciphertext, key hex, PKCS7. Trả JSON đã parse.
 */
function decryptDojiPayload(b64) {
  const buf = Buffer.from(b64, 'base64')
  const iv = buf.subarray(0, 16)
  const ct = buf.subarray(16)
  const key = Buffer.from(DOJI_DECRYPT_KEY, 'hex')
  const dec = crypto.createDecipheriv('aes-256-cbc', key, iv)
  return JSON.parse(dec.update(ct, undefined, 'utf8') + dec.final('utf8'))
}

/**
 * Nguồn chính thức: banggia.doji.vn GetTablePrice trả bảng giá HÔM NAY của
 * chính DOJI (chính xác hơn aggregator simplize, vốn chậm và lệch giá). Giải
 * mã rồi lấy dòng nhẫn tròn (materialCode 03 "NHẪN TRÒN 9999 HƯNG THỊNH
 * VƯỢNG"); giá nghìn VND/chỉ × 10.000 ra VND/lượng. Trả 1 dòng của hôm nay,
 * ngày lấy từ updateDate của DOJI quy về giờ VN.
 */
async function fetchDojiNhanFromBanggia() {
  const body = await curlGet(DOJI_BANGGIA_URL)
  const json = JSON.parse(body)
  if (!json.data) throw new Error('banggia.doji.vn: unexpected payload')
  const rows = decryptDojiPayload(json.data)
  const row = rows.find(r => r.materialCode === '03' || String(r.materialName || '').includes('NHẪN TRÒN'))
  if (!row || !row.priceDojiBuyIn || !row.priceDojiSellOut) {
    throw new Error('banggia.doji.vn: NHẪN TRÒN row not found')
  }
  return [{
    date: row.updateDate ? vnDateStr(row.updateDate) : toDateStr(new Date()),
    buy: Math.round(row.priceDojiBuyIn * 10000),
    sell: Math.round(row.priceDojiSellOut * 10000),
  }]
}

/**
 * simplize.vn dự phòng khi banggia.doji.vn lỗi: lưu lịch sử vàng nhẫn DOJI
 * ~2,4 năm (period=3y_d), trả cả chuỗi dạng [ts, open, high, low, close,
 * volume] (chỉ close có số, VND/lượng). Ghép buy/sell theo ngày rồi trả toàn
 * bộ {date,buy,sell}; updateAsset lọc `> lastDate` nên chỉ nối thêm ngày mới.
 */
async function fetchDojiNhanFromSimplize() {
  async function series(ticker) {
    const body = await curlGet(`${SIMPLIZE_CHART_URL}?ticker=${encodeURIComponent(ticker)}&period=${SIMPLIZE_PERIOD}&type=gold`)
    const json = JSON.parse(body)
    if (!json.data || !Array.isArray(json.data)) throw new Error(`simplize: unexpected payload for ${ticker}`)
    const byDate = new Map()
    for (const row of json.data) {
      const close = row[4] // [ts, open, high, low, close, volume]
      if (typeof close !== 'number' || !isFinite(close) || close <= 0) continue
      byDate.set(utcDateStr(row[0]), Math.round(close))
    }
    return byDate
  }

  const buy = await series('DOJI:T9999:BUY')
  const sell = await series('DOJI:T9999:SELL')
  const dates = [...buy.keys()].filter(d => sell.has(d)).sort()
  if (dates.length === 0) throw new Error('simplize: no overlapping buy/sell dates')
  return dates.map(d => ({ date: d, buy: buy.get(d), sell: sell.get(d) }))
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

  // Refetch từ chính ngày lastDate (không phải hôm sau): giá cập nhật nhiều
  // lần trong ngày, dòng cuối CSV có thể là tick giữa phiên — lấy lại cả ngày
  // đó rồi lọc `> lastDate` để chỉ append ngày mới, ngày cũ giữ nguyên. (Với
  // vàng nhẫn DOJI, nguồn chính banggia.doji.vn trả đúng 1 dòng của hôm nay;
  // nếu rơi về fallback simplize thì cả chuỗi ~2,4 năm được lọc như nhau.)
  let rows = null
  try {
    rows = await asset.fetch(lastDate)
    console.log(`📡 ${asset.id}: fetched ${rows.length} daily rows`)
  } catch (err) {
    console.error(`⚠️  ${asset.id}: primary source failed (${err.message})`)
    if (!asset.fallback) {
      console.error(`❌ ${asset.id}: no update this run (no fallback source configured)`)
      return
    }
    console.error(`   falling back to alternate source...`)
    try {
      rows = await asset.fallback()
      console.log(`📡 ${asset.id}: fallback fetched ${rows.length} daily rows`)
    } catch (err2) {
      console.error(`❌ ${asset.id}: fallback also failed (${err2.message})`)
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
