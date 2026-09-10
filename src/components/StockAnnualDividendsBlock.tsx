import { memo, useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { DcaBlock } from './DcaLayout'
import type { StockAnnualDividendPoint } from '../utils/stockDcaPresentation'
import { formatVNDAxis, formatVNDFull } from '../utils/vndFormat'

type StockDividendMode = 'shares' | 'value'

interface Props {
  data: readonly StockAnnualDividendPoint[]
  /** Đơn vị mặc định cho chart cổ tức bằng cổ phiếu. "Tất cả" dùng "value" vì cộng số cổ phiếu khác mã không có nghĩa. */
  defaultStockMode?: StockDividendMode
  /** View "Tất cả" (cộng nhiều mã) thì không cho chọn đơn vị "Số cổ phiếu". */
  aggregate?: boolean
}

interface TooltipProps {
  active?: boolean
  payload?: Array<{ payload: StockAnnualDividendPoint }>
  mode: 'cash' | StockDividendMode
}

function DividendTooltip({ active, payload, mode }: TooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  if (mode === 'cash') {
    return (
      <div className="custom-tooltip">
        <p className="ct-date">Năm {point.year}</p>
        <p>Cổ tức tiền mặt: {formatVNDFull(point.cashVnd)}</p>
      </div>
    )
  }

  return (
    <div className="custom-tooltip">
      <p className="ct-date">Năm {point.year}</p>
      {mode === 'shares'
        ? <p>Cổ phiếu nhận thêm: {formatShares(point.stockShares)}</p>
        : <p>Giá trị tham chiếu: {formatVNDFull(point.stockValueVnd)}</p>}
    </div>
  )
}

function StockAnnualDividendsBlockImpl({ data, defaultStockMode = 'shares', aggregate = false }: Props) {
  const [stockDividendMode, setStockDividendMode] = useState<StockDividendMode>(defaultStockMode)
  // defaultStockMode chỉ có tác dụng ở mount đầu; đồng bộ lại mỗi khi đổi scope ("Tất cả" ↔ một mã).
  useEffect(() => {
    setStockDividendMode(defaultStockMode)
  }, [defaultStockMode])
  // Guard: view "Tất cả" cộng nhiều mã nên không bao giờ dùng "shares", kể cả khi state bị lệch.
  const effectiveMode: StockDividendMode = aggregate && stockDividendMode === 'shares' ? 'value' : stockDividendMode
  const hasDividends = data.some(point => point.cashVnd > 0 || point.stockShares > 0)

  return (
    <DcaBlock title="Cổ tức hằng năm" className="stock-annual-dividends-block">
      <p className="dca-note stock-annual-dividends-note">Chart tiền mặt dùng số tiền thực nhận sau thuế. Chart cổ phiếu mặc định dùng số cổ phiếu đã về tài khoản; giá trị tham chiếu lấy giá tại ngày đó, không phải tiền mặt.</p>
      {!hasDividends ? (
        <p className="stock-annual-dividends-empty">Khoảng dữ liệu này chưa có cổ tức đã về tài khoản.</p>
      ) : (
        <div className="stock-annual-dividend-grid">
          <AnnualDividendChart
            title="Cổ tức tiền mặt"
            data={data}
            dataKey="cashVnd"
            color="#a8512f"
            axisFormatter={formatVNDAxis}
            tooltipMode="cash"
          />
          <section className="stock-annual-dividend-chart">
            <div className="stock-annual-dividend-chart-header">
              <h4>Cổ tức bằng cổ phiếu</h4>
              <div className="stock-annual-dividend-chart-tools">
                <div className="stock-annual-dividend-toggle" role="group" aria-label="Đơn vị chart cổ tức bằng cổ phiếu">
                  <button className={`dca-choice-btn${effectiveMode === 'shares' ? ' dca-choice-btn--active' : ''}`} aria-pressed={effectiveMode === 'shares'} disabled={aggregate} title={aggregate ? 'Cộng số cổ phiếu của nhiều mã khác nhau không có nghĩa' : undefined} onClick={() => setStockDividendMode('shares')}>Số cổ phiếu</button>
                  <button className={`dca-choice-btn${effectiveMode === 'value' ? ' dca-choice-btn--active' : ''}`} aria-pressed={effectiveMode === 'value'} onClick={() => setStockDividendMode('value')}>Giá trị tham chiếu</button>
                </div>
                <span
                  className="chart-tooltip-icon"
                  title="Giá trị tham chiếu = số cổ phiếu mới đã về tài khoản × giá đóng cửa chưa điều chỉnh của phiên giao dịch đầu tiên từ ngày cổ phiếu về trở đi. Dashboard cộng các giá trị này theo năm cổ phiếu về. Đây không phải giá ngày chốt quyền, giá hiện tại hay tiền mặt."
                  aria-label="Cách tính giá trị tham chiếu cổ tức bằng cổ phiếu"
                >?</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={[...data]} margin={{ top: 12, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={effectiveMode === 'shares' ? formatSharesAxis : formatVNDAxis} width={62} />
                <Tooltip content={<DividendTooltip mode={effectiveMode} />} />
                <Bar dataKey={effectiveMode === 'shares' ? 'stockShares' : 'stockValueVnd'} fill="#5e7c6a" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </section>
        </div>
      )}
    </DcaBlock>
  )
}

interface AnnualDividendChartProps {
  title: string
  data: readonly StockAnnualDividendPoint[]
  dataKey: 'cashVnd'
  color: string
  axisFormatter: (value: number) => string
  tooltipMode: 'cash'
}

function AnnualDividendChart({ title, data, dataKey, color, axisFormatter, tooltipMode }: AnnualDividendChartProps) {
  return (
    <section className="stock-annual-dividend-chart">
      <div className="stock-annual-dividend-chart-header"><h4>{title}</h4></div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={[...data]} margin={{ top: 12, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
          <XAxis dataKey="year" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={axisFormatter} width={62} />
          <Tooltip content={<DividendTooltip mode={tooltipMode} />} />
          <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  )
}

function formatShares(value: number): string {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: 0 })
}

function formatSharesAxis(value: number): string {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: 0 })
}

export const StockAnnualDividendsBlock = memo(StockAnnualDividendsBlockImpl)
