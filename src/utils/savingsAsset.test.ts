import { describe, it, expect } from 'vitest'
import {
  savingsAssetId,
  isSavingsAssetId,
  parseSavingsRate,
  assetDisplayName,
  generateSavingsSeries,
  savingsPriceSeriesForId,
  pruneUnusedSavings,
  pickDefaultSavingsRate,
  DEFAULT_SAVINGS_RATE,
  SAVINGS_ID_PREFIX,
} from './savingsAsset'

describe('id tiết kiệm', () => {
  it('đi vòng tròn: số lãi suất ra id rồi đọc ngược lại vẫn đúng số đó', () => {
    for (const rate of [0, 3, 6, 6.5, 7.25, 100]) {
      expect(parseSavingsRate(savingsAssetId(rate))).toBe(rate)
    }
  })

  it('chỉ nhận id có tiền tố SAVINGS:, không nhận mã quỹ thật', () => {
    expect(isSavingsAssetId(savingsAssetId(6))).toBe(true)
    expect(isSavingsAssetId(SAVINGS_ID_PREFIX)).toBe(true)
    expect(isSavingsAssetId('DCDS')).toBe(false)
    expect(isSavingsAssetId('E1VFVN30')).toBe(false)
    // Không được ăn nhầm mã quỹ chỉ vì có chữ SAVINGS ở giữa
    expect(isSavingsAssetId('MY-SAVINGS:6')).toBe(false)
  })

  it('id hỏng thì trả lãi suất 0 chứ không trả NaN', () => {
    // NaN lọt xuống công thức lãi kép sẽ làm hỏng cả chuỗi giá mà không báo lỗi.
    expect(parseSavingsRate('SAVINGS:abc')).toBe(0)
    expect(parseSavingsRate(SAVINGS_ID_PREFIX)).toBe(0)
  })

  it('tên hiển thị đọc ra nghĩa, mã quỹ thật thì giữ nguyên', () => {
    expect(assetDisplayName(savingsAssetId(6))).toBe('Tiết kiệm 6%/năm')
    expect(assetDisplayName(savingsAssetId(6.5))).toBe('Tiết kiệm 6.5%/năm')
    expect(assetDisplayName('DCDS')).toBe('DCDS')
  })
})

describe('generateSavingsSeries', () => {
  it('bắt đầu đúng ở gốc 100', () => {
    const s = generateSavingsSeries(6, '2020-01-01', '2020-01-10')
    expect(s[0]!.date).toBe('2020-01-01')
    expect(s[0]!.price).toBe(100)
  })

  it('sau đúng 4 năm lịch thì bằng 100 × (1 + lãi suất)^4', () => {
    // 2020-01-01 tới 2024-01-01 là 1461 ngày (2020 nhuận), chia 365,25 ra đúng
    // 4,0. Nhờ vậy đây là phép thử KHÍT của công thức lãi kép, không phải xấp xỉ.
    const s = generateSavingsSeries(6, '2020-01-01', '2024-01-01')
    const last = s[s.length - 1]!
    expect(last.date).toBe('2024-01-01')
    expect(last.price).toBeCloseTo(100 * Math.pow(1.06, 4), 10)
  })

  it('lãi suất 0 thì giá đứng yên ở 100', () => {
    const s = generateSavingsSeries(0, '2020-01-01', '2021-01-01')
    expect(s.every(p => p.price === 100)).toBe(true)
  })

  it('giá tăng đơn điệu, không có ngày nào tụt', () => {
    // Đây là tính chất định nghĩa của tiền gửi: không bao giờ lỗ. Mọi phép đo
    // sụt giảm trong dashboard dựa vào điều này.
    const s = generateSavingsSeries(7, '2020-01-01', '2022-01-01')
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.price).toBeGreaterThan(s[i - 1]!.price)
    }
  })

  it('mỗi điểm cách nhau đúng 1 ngày, kể cả khi vắt qua mốc đổi giờ mùa hè', () => {
    // Chuỗi neo theo UTC nên không dính DST của máy chạy test. Nếu ai đó đổi
    // sang giờ địa phương, khoảng 8-14/03 sẽ sinh ngày lặp hoặc ngày nhảy cóc.
    const s = generateSavingsSeries(6, '2021-03-10', '2021-03-16')
    expect(s.map(p => p.date)).toEqual([
      '2021-03-10', '2021-03-11', '2021-03-12', '2021-03-13',
      '2021-03-14', '2021-03-15', '2021-03-16',
    ])
  })

  it('khoảng ngày ngược hoặc hỏng thì trả mảng rỗng, không ném lỗi', () => {
    expect(generateSavingsSeries(6, '2024-01-01', '2020-01-01')).toEqual([])
    expect(generateSavingsSeries(6, 'khong-phai-ngay', '2020-01-01')).toEqual([])
  })
})

describe('savingsPriceSeriesForId', () => {
  it('enters the dashboard through PriceSeries v1 with an explicit synthetic source', () => {
    const series = savingsPriceSeriesForId('SAVINGS:6')

    expect(series).toMatchObject({
      version: 1,
      assetId: 'SAVINGS:6',
      currency: 'VND',
      source: 'synthetic:savings',
      adjustments: [],
    })
    expect(series.points[0]).toEqual({ date: '2000-01-01', value: 100 })
    expect(series.asOf).toBe(series.points[series.points.length - 1]!.date)
    expect(series.rawPoints).toBeUndefined()
    expect(series.purchasePoints).toBeUndefined()
  })
})

describe('pruneUnusedSavings', () => {
  function cache(...ids: string[]): Map<string, number[]> {
    return new Map(ids.map(id => [id, [1, 2, 3]]))
  }

  it('xoá chuỗi tiết kiệm của lãi suất cũ không còn ai dùng', () => {
    // Đây là chỗ chặn cache phình: đổi lãi suất 6% sang 7% là sinh key mới,
    // key cũ phải đi theo chứ không được nằm lại giữ 9.700 điểm giá.
    const c = cache('SAVINGS:6', 'SAVINGS:7')
    pruneUnusedSavings(c, ['SAVINGS:7'])
    expect([...c.keys()]).toEqual(['SAVINGS:7'])
  })

  it('KHÔNG đụng tới quỹ thật, kể cả khi quỹ đó không nằm trong danh sách đang dùng', () => {
    // Bất biến quan trọng nhất của hàm này. Quỹ thật nạp qua mạng, xoá nhầm là
    // bắt tải lại CSV; mà danh sách quỹ vốn hữu hạn nên cache tự có trần rồi.
    const c = cache('DCDS', 'E1VFVN30', 'SAVINGS:6')
    pruneUnusedSavings(c, [])
    expect([...c.keys()]).toEqual(['DCDS', 'E1VFVN30'])
  })

  it('giữ nguyên khi mọi chuỗi tiết kiệm đều đang được dùng', () => {
    const c = cache('DCDS', 'SAVINGS:6')
    pruneUnusedSavings(c, ['DCDS', 'SAVINGS:6'])
    expect([...c.keys()]).toEqual(['DCDS', 'SAVINGS:6'])
  })

  it('dọn được nhiều lãi suất bỏ đi trong một lượt', () => {
    // Người dùng gõ thử 6 rồi 6,5 rồi 7 rồi 7,2: chỉ mức cuối còn lại.
    const c = cache('SAVINGS:6', 'SAVINGS:6.5', 'SAVINGS:7', 'SAVINGS:7.2', 'DCDS')
    pruneUnusedSavings(c, ['SAVINGS:7.2', 'DCDS'])
    expect([...c.keys()].sort()).toEqual(['DCDS', 'SAVINGS:7.2'])
  })

  it('nhận Set làm danh sách đang dùng, không chỉ mảng', () => {
    // Tab DCA và Tái Cân Bằng truyền thẳng `neededIds` vốn là một Set.
    const c = cache('SAVINGS:6', 'SAVINGS:7')
    pruneUnusedSavings(c, new Set(['SAVINGS:6']))
    expect([...c.keys()]).toEqual(['SAVINGS:6'])
  })
})

describe('pickDefaultSavingsRate', () => {
  it('không có gì đang dùng thì trả về mức mặc định', () => {
    expect(pickDefaultSavingsRate([])).toBe(DEFAULT_SAVINGS_RATE)
  })

  it('mức mặc định đã bị chiếm thì nhảy sang mức tiếp theo', () => {
    // Đây là ca gốc của lỗi: 2 ô cùng bấm "Tiết kiệm ngân hàng" mà cùng ra
    // SAVINGS:6 thì trùng id, React báo warning key trùng dù số liệu không sai.
    expect(pickDefaultSavingsRate([DEFAULT_SAVINGS_RATE])).not.toBe(DEFAULT_SAVINGS_RATE)
  })

  it('chiếm hết mọi mức fallback thì quay lại mức mặc định, không kẹt', () => {
    // Trường hợp cực đoan (chọn tiết kiệm ở 7-8 ô cùng lúc): thà trùng còn hơn
    // hàm trả về undefined và làm crash chỗ gọi.
    expect(pickDefaultSavingsRate([6, 7, 8, 5, 9, 4, 10])).toBe(DEFAULT_SAVINGS_RATE)
  })

  it('không bị ô đang giữ ĐÚNG mức mặc định gạt bỏ nhầm mức khác', () => {
    // Nếu 1 ô khác đang là 7%, ô mới vẫn được phép mặc định 6% như bình thường.
    expect(pickDefaultSavingsRate([7])).toBe(DEFAULT_SAVINGS_RATE)
  })
})
