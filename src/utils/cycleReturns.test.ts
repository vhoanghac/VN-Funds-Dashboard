import { describe, it, expect } from 'vitest'
import { buildPeriods, periodStat, groupByYearInTerm, TERMS, HALVINGS } from './cycleReturns'
import type { PricePoint } from '../types'

function series(...pairs: [string, number][]): PricePoint[] {
  return pairs.map(([date, price]) => ({ date, price }))
}

describe('buildPeriods, khung nhiệm kỳ', () => {
  it('cắt mỗi nhiệm kỳ thành 4 năm, từ 20/1 tới 20/1', () => {
    const p = buildPeriods('term', '2017-01-01', '2021-01-31')
    const trump = p.filter(x => x.president === 'Trump 1')
    expect(trump).toHaveLength(4)
    expect(trump[0]!.from).toBe('2017-01-20')
    expect(trump[0]!.to).toBe('2018-01-20')
    expect(trump[3]!.to).toBe('2021-01-20')
  })

  it('bỏ kỳ nằm hoàn toàn ngoài khoảng dữ liệu', () => {
    const p = buildPeriods('term', '2021-01-20', '2024-01-20')
    expect(p.some(x => x.president === 'Obama 2')).toBe(false)
    expect(p.some(x => x.president === 'Trump 1')).toBe(false)
  })

  it('giữ kỳ chồng lấn nhưng đánh dấu chưa trọn vẹn', () => {
    // Dữ liệu bắt đầu giữa năm 3 nhiệm kỳ Obama 2.
    const p = buildPeriods('term', '2014-09-17', '2026-07-27')
    const obama3 = p.find(x => x.id === 'Obama 2-2')!
    expect(obama3.complete).toBe(false)
    const trump1 = p.find(x => x.id === 'Trump 1-1')!
    expect(trump1.complete).toBe(true)
  })

  it('phân biệt kỳ đang chạy với kỳ chỉ thiếu dữ liệu đầu', () => {
    // Dữ liệu BTC bắt đầu 17/9/2014 và dừng ở 27/7/2026.
    const p = buildPeriods('term', '2014-09-17', '2026-07-27')
    // Năm 2 nhiệm kỳ Obama 2 đã kết thúc từ 2015, chỉ thiếu đoạn đầu.
    expect(p.find(x => x.id === 'Obama 2-2')!.partial).toBe('truncated')
    // Năm 2 nhiệm kỳ Trump 2 thì thật sự chưa kết thúc.
    expect(p.find(x => x.id === 'Trump 2-2')!.partial).toBe('unfinished')
    // Kỳ nằm gọn trong dữ liệu thì không có lý do nào.
    expect(p.find(x => x.id === 'Biden-1')!.partial).toBeNull()
  })

  it('đánh dấu kỳ có halving', () => {
    const p = buildPeriods('term', '2014-01-01', '2026-07-27')
    // Halving 11/5/2020 rơi vào năm 4 của Trump 1 (20/1/2020 tới 20/1/2021).
    expect(p.find(x => x.id === 'Trump 1-4')!.hasHalving).toBe(true)
    expect(p.find(x => x.id === 'Trump 1-3')!.hasHalving).toBe(false)
    // Halving 20/4/2024 rơi vào năm 4 của Biden.
    expect(p.find(x => x.id === 'Biden-4')!.hasHalving).toBe(true)
  })

  it('năm 4 của mọi nhiệm kỳ đều trùng một kỳ halving', () => {
    // Đây là cái bẫy trùng pha mà bảng phải bày ra, không được giấu.
    const p = buildPeriods('term', '2014-01-01', '2026-07-27')
    const year4 = p.filter(x => x.yearInTerm === 4 && x.complete)
    expect(year4.length).toBeGreaterThan(1)
    expect(year4.every(x => x.hasHalving)).toBe(true)
  })
})

describe('buildPeriods, khung kỳ bầu cử', () => {
  it('mỗi năm tính từ ngày bầu cử đầu tháng 11', () => {
    const p = buildPeriods('election', '2016-01-01', '2021-12-31')
    const trump = p.filter(x => x.president === 'Trump 1')
    expect(trump[0]!.from).toBe('2016-11-08')
    expect(trump[0]!.to).toBe('2017-11-08')
  })

  it('năm 4 khép lại đúng kỳ bầu cử kế tiếp, không phải ngày kỷ niệm', () => {
    // Bầu cử rơi vào thứ Ba sau thứ Hai đầu tiên của tháng 11 nên ngày lệch
    // nhau mỗi kỳ. Nối bằng ngày thật thì các kỳ liền mạch, không hở không chồng.
    const p = buildPeriods('election', '2016-01-01', '2026-07-27')
    const trump4 = p.find(x => x.id === 'Trump 1-4')!
    expect(trump4.to).toBe('2020-11-03')
    const biden1 = p.find(x => x.id === 'Biden-1')!
    expect(biden1.from).toBe('2020-11-03')
  })

  it('đẩy đợt tăng sau bầu cử ra khỏi năm 4 của người tiền nhiệm', () => {
    // Đây là lý do khung này tồn tại. Ở khung nhiệm kỳ, đoạn từ đầu tháng 11
    // tới 20/1 nằm trong năm 4; ở khung bầu cử thì nó thuộc năm 1 người kế nhiệm.
    const byTerm = buildPeriods('term', '2016-01-01', '2026-07-27')
      .find(x => x.id === 'Trump 1-4')!
    const byElection = buildPeriods('election', '2016-01-01', '2026-07-27')
      .find(x => x.id === 'Trump 1-4')!
    expect(byTerm.to).toBe('2021-01-20')
    expect(byElection.to).toBe('2020-11-03')
    expect(byElection.to < byTerm.to).toBe(true)
  })
})

describe('buildPeriods, khung năm dương lịch', () => {
  it('mỗi năm một kỳ, từ 1/1 tới 31/12', () => {
    const p = buildPeriods('calendar', '2017-01-01', '2019-12-31')
    expect(p.map(x => x.label)).toEqual(['2017', '2018', '2019'])
    expect(p[0]!.from).toBe('2017-01-01')
    expect(p[0]!.to).toBe('2017-12-31')
  })

  it('gán năm dương lịch vào đúng nhiệm kỳ', () => {
    const p = buildPeriods('calendar', '2016-01-01', '2026-12-31')
    const byLabel = new Map(p.map(x => [x.label, x]))
    expect(byLabel.get('2017')!.president).toBe('Trump 1')
    expect(byLabel.get('2017')!.yearInTerm).toBe(1)
    expect(byLabel.get('2021')!.president).toBe('Biden')
    expect(byLabel.get('2025')!.president).toBe('Trump 2')
    // Năm bầu cử vẫn thuộc nhiệm kỳ cũ vì tổng thống mới nhậm chức tháng 1 sau.
    expect(byLabel.get('2020')!.president).toBe('Trump 1')
    expect(byLabel.get('2020')!.yearInTerm).toBe(4)
  })
})

describe('periodStat', () => {
  const period = buildPeriods('calendar', '2020-01-01', '2020-12-31')[0]!

  it('tính đóng cửa, đỉnh và phần trả lại', () => {
    const prices = series(
      ['2019-12-31', 100],
      ['2020-06-01', 200],
      ['2020-12-31', 150],
    )
    const s = periodStat(prices, period)
    expect(s.close).toBeCloseTo(50, 6)
    expect(s.peak).toBeCloseTo(100, 6)
    expect(s.giveback).toBeCloseTo(-25, 6)
  })

  it('trả lại bằng 0 khi kỳ kết thúc ngay tại đỉnh', () => {
    const prices = series(['2019-12-31', 100], ['2020-12-31', 300])
    expect(periodStat(prices, period).giveback).toBeCloseTo(0, 6)
  })

  it('dùng giá gần nhất TRƯỚC mốc bắt đầu làm gốc, không nhìn trước tương lai', () => {
    // Giá 31/12/2019 là gốc, không phải giá 2/1/2020.
    const prices = series(
      ['2019-12-31', 100],
      ['2020-01-02', 120],
      ['2020-12-31', 110],
    )
    expect(periodStat(prices, period).close).toBeCloseTo(10, 6)
  })

  it('lấy giá đầu tiên sau mốc khi không có giá nào trước đó', () => {
    const prices = series(['2020-03-01', 100], ['2020-12-31', 130])
    expect(periodStat(prices, period).close).toBeCloseTo(30, 6)
  })

  it('trả null khi kỳ không có dữ liệu', () => {
    const prices = series(['2018-01-01', 100], ['2018-12-31', 120])
    expect(periodStat(prices, period)).toEqual({ close: null, peak: null, giveback: null })
  })

  it('đỉnh luôn lớn hơn hoặc bằng đóng cửa', () => {
    const prices = series(
      ['2019-12-31', 100],
      ['2020-04-01', 40],
      ['2020-12-31', 60],
    )
    const s = periodStat(prices, period)
    expect(s.peak!).toBeGreaterThanOrEqual(s.close!)
    expect(s.close).toBeCloseTo(-40, 6)
    // Cả năm không lúc nào vượt giá đầu năm, nên đỉnh vẫn là mức đầu năm.
    expect(s.peak).toBeCloseTo(-40, 6)
  })
})

describe('groupByYearInTerm', () => {
  it('gom đủ số lần quan sát cho từng năm nhiệm kỳ', () => {
    const p = buildPeriods('term', '2014-09-17', '2026-07-27')
    const g = groupByYearInTerm(p.filter(x => x.complete))
    // Với dữ liệu tới 7/2026: năm 1 có Trump1, Biden, Trump2.
    expect(g.get(1)!.map(x => x.president)).toEqual(['Trump 1', 'Biden', 'Trump 2'])
    // Năm 2 của Trump 2 chưa xong nên không được tính là quan sát trọn vẹn.
    expect(g.get(2)!.map(x => x.president)).toEqual(['Trump 1', 'Biden'])
  })
})

describe('dữ liệu tham chiếu', () => {
  it('nhiệm kỳ xếp theo thứ tự thời gian tăng dần', () => {
    const starts = TERMS.map(t => t.start)
    expect([...starts].sort()).toEqual(starts)
  })

  it('halving xếp theo thứ tự và không có ngày tương lai bịa ra', () => {
    expect([...HALVINGS].sort()).toEqual(HALVINGS)
    expect(HALVINGS[HALVINGS.length - 1]).toBe('2024-04-20')
  })
})
