import { useEffect } from 'react'
import type { TabId } from '../tabRegistry'

interface SeoMeta {
  title: string
  description: string
}

const SEO_BY_TAB: Record<TabId, SeoMeta> = {
  compare: {
    title: 'So sánh quỹ đầu tư Việt Nam | Fund Dashboard',
    description: 'So sánh hiệu suất quỹ mở, ETF và các tài sản tại Việt Nam bằng dữ liệu lịch sử NAV, CAGR, drawdown và rolling return.',
  },
  dca: {
    title: 'Mô phỏng DCA quỹ đầu tư Việt Nam | Fund Dashboard',
    description: 'Mô phỏng đầu tư định kỳ vào quỹ mở, ETF và các tài sản tại Việt Nam bằng dữ liệu lịch sử.',
  },
  lsdca: {
    title: 'Lump Sum vs DCA tại Việt Nam | Fund Dashboard',
    description: 'So sánh đầu tư một lần với DCA trên lịch sử quỹ mở và ETF tại Việt Nam, kèm phân bố kết quả và các kịch bản percentile.',
  },
  fundanalysis: {
    title: 'Phân tích quỹ đầu tư Việt Nam | Fund Dashboard',
    description: 'Phân tích danh mục, tài sản và báo cáo tài chính của các quỹ đầu tư Việt Nam.',
  },
  overlap: {
    title: 'So sánh danh mục quỹ đầu tư | Fund Dashboard',
    description: 'So sánh cổ phiếu, ngành và tỷ trọng trùng giữa hai quỹ đầu tư Việt Nam.',
  },
  rebalance: {
    title: 'Mô phỏng tái cân bằng danh mục | Fund Dashboard',
    description: 'Đánh giá độ nhạy của danh mục quỹ đầu tư khi tái cân bằng theo các chu kỳ khác nhau.',
  },
  tactical: {
    title: 'Phân tích phân bổ chiến thuật | Fund Dashboard',
    description: 'Kiểm tra chiến lược phân bổ chiến thuật trên dữ liệu lịch sử, cùng các cảnh báo về giới hạn backtest.',
  },
  bitcoin: {
    title: 'Phân tích Bitcoin và quỹ đầu tư | Fund Dashboard',
    description: 'So sánh Bitcoin với quỹ đầu tư và các tài sản khác trên dữ liệu lịch sử.',
  },
  wallofworry: {
    title: 'Wall of Worry: những nỗi lo thị trường | Fund Dashboard',
    description: 'Xem các nỗi lo thị trường từng xuất hiện và cách chúng kết thúc qua thời gian.',
  },
  calculator: {
    title: 'Máy tính đầu tư và lãi kép | Fund Dashboard',
    description: 'Tính lãi kép, CAGR và mức phí quỹ ăn mòn giá trị đầu tư theo thời gian.',
  },
  methodology: {
    title: 'Phương pháp và dữ liệu | Fund Dashboard',
    description: 'Tìm hiểu nguồn dữ liệu, công thức và các giới hạn của những chỉ số trong Fund Dashboard.',
  },
  changelog: {
    title: 'Nhật ký thay đổi | Fund Dashboard',
    description: 'Theo dõi các thay đổi về dữ liệu, công thức và tính năng của Fund Dashboard.',
  },
}

function setMetaContent(attribute: 'name' | 'property', value: string, content: string) {
  const element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${value}"]`)
  if (element) element.content = content
}

export function SeoMetadata({ tab }: { tab: TabId }) {
  useEffect(() => {
    const meta = SEO_BY_TAB[tab]
    document.title = meta.title
    setMetaContent('name', 'description', meta.description)
    setMetaContent('property', 'og:title', meta.title)
    setMetaContent('property', 'og:description', meta.description)
    setMetaContent('name', 'twitter:title', meta.title)
    setMetaContent('name', 'twitter:description', meta.description)
  }, [tab])

  return null
}
