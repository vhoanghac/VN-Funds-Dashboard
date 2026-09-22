import assert from 'node:assert/strict'
import test from 'node:test'
import zlib from 'node:zlib'
import { fetchHistory } from './scrape_cafef_stock.mjs'

const SYMBOL = 'ACB'
const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function makeStoredZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = zlib.crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuf, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuf)

    offset += 30 + nameBuf.length + data.length
  }

  const centralBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...localParts, centralBuf, eocd])
}

function makeXlsx(rows) {
  const shared = [SYMBOL, ...rows.map(row => row.date)]
  const sharedXml = `<?xml version="1.0"?><sst count="${shared.length}" uniqueCount="${shared.length}">${shared.map(text => `<si><t>${text}</t></si>`).join('')}</sst>`
  const header = '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
  const body = rows.map((row, index) => {
    const rowNumber = index + 2
    return `<row r="${rowNumber}"><c r="A${rowNumber}" t="s"><v>0</v></c><c r="B${rowNumber}" t="s"><v>${index + 1}</v></c><c r="C${rowNumber}"><v>${row.raw}</v></c><c r="D${rowNumber}"><v>${row.adjusted}</v></c></row>`
  }).join('')
  const sheetXml = `<?xml version="1.0"?><worksheet><sheetData>${header}${body}</sheetData></worksheet>`
  return makeStoredZip([
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedXml) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml) },
  ])
}

function stubFetch(chunksByStart) {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url))
    const start = parsed.searchParams.get('StartDate')
    calls.push(start)
    const rows = chunksByStart[start]
    if (!rows) throw new Error(`unexpected chunk start: ${start}`)
    const bytes = makeXlsx(rows)
    return {
      ok: true,
      headers: { get: (name) => (name === 'content-type' ? CONTENT_TYPE : null) },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  }
  return { calls, restore: () => { globalThis.fetch = originalFetch } }
}

test('overlapping chunks dedupe identical rows and terminate', { timeout: 15_000 }, async (t) => {
  // Chunks: 2026-01-01..2026-03-31, 2026-03-25..2026-06-24, 2026-06-18..2026-06-30
  const { calls, restore } = stubFetch({
    '01/01/2026': [
      { date: '05/01/2026', raw: 25.5, adjusted: 25.5 },
      { date: '28/03/2026', raw: 26, adjusted: 26 },
    ],
    '03/25/2026': [
      { date: '28/03/2026', raw: 26, adjusted: 26 },
      { date: '10/04/2026', raw: 27, adjusted: 27 },
      { date: '20/06/2026', raw: 28, adjusted: 28 },
    ],
    '06/18/2026': [
      { date: '20/06/2026', raw: 28, adjusted: 28 },
      { date: '25/06/2026', raw: 29, adjusted: 29 },
    ],
  })
  t.after(restore)

  const rows = await fetchHistory(SYMBOL, '2026-01-01', '2026-06-30', 'HOSE')

  assert.equal(calls.length, 3)
  const dates = rows.map(row => row.date)
  assert.deepEqual(dates, ['2026-01-05', '2026-03-28', '2026-04-10', '2026-06-20', '2026-06-25'])
  assert.equal(new Set(dates).size, dates.length)
})

test('conflicting prices in the overlap window throw', { timeout: 15_000 }, async (t) => {
  const { restore } = stubFetch({
    '01/01/2026': [
      { date: '28/03/2026', raw: 26, adjusted: 26 },
    ],
    '03/25/2026': [
      { date: '28/03/2026', raw: 26, adjusted: 99 },
    ],
    '06/18/2026': [
      { date: '25/06/2026', raw: 29, adjusted: 29 },
    ],
  })
  t.after(restore)

  await assert.rejects(
    () => fetchHistory(SYMBOL, '2026-01-01', '2026-06-30', 'HOSE'),
    /conflicting values for 2026-03-28/,
  )
})

test('single-session range terminates without overlap', { timeout: 5_000 }, async (t) => {
  const { restore } = stubFetch({
    '01/01/2026': [
      { date: '05/01/2026', raw: 25.5, adjusted: 25.5 },
    ],
  })
  t.after(restore)

  const rows = await fetchHistory(SYMBOL, '2026-01-01', '2026-01-31', 'HOSE')
  assert.deepEqual(rows.map(row => row.date), ['2026-01-05'])
})
