import { describe, expect, it } from 'vitest'
import { buildRecoverySeries } from './DcaRecoveryChart'

describe('buildRecoverySeries', () => {
  it('maps each drawdown point to the required recovery multiple', () => {
    const [series] = buildRecoverySeries([{
      id: 'a',
      name: 'Portfolio A',
      color: '#123456',
      drawdown: [
        { date: '2020-01-01', value: 0 },
        { date: '2020-02-01', value: -0.20 },
        { date: '2020-03-01', value: -0.50 },
      ],
    }])

    expect(series).toMatchObject({
      name: 'Portfolio A',
      color: '#123456',
      data: [
        { date: '2020-01-01', value: 1 },
        { date: '2020-02-01', value: 1.25 },
        { date: '2020-03-01', value: 2 },
      ],
    })
  })

  it('skips points that cannot recover from a total loss', () => {
    const [series] = buildRecoverySeries([{
      id: 'a',
      name: 'Portfolio A',
      color: '#123456',
      drawdown: [
        { date: '2020-01-01', value: 0 },
        { date: '2020-02-01', value: -1 },
      ],
    }])

    expect(series!.data).toEqual([{ date: '2020-01-01', value: 1 }])
  })
})
