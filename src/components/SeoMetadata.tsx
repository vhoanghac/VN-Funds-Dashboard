import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import type { TabId } from '../tabRegistry'

export interface SeoMeta {
  title: string
  description: string
  heading: string
  indexable: boolean
}

const SITE_ORIGIN = 'https://fund.vohoanghac.com'

export const SEO_BY_TAB: Record<TabId, SeoMeta> = {
  compare: {
    title: 'So sánh quỹ mở và ETF Việt Nam | Fund Dashboard',
    description: 'So sánh hiệu suất quỹ mở, ETF và các tài sản tại Việt Nam bằng dữ liệu lịch sử NAV, CAGR, drawdown và rolling return.',
    heading: 'So Sánh Quỹ Mở và ETF Việt Nam',
    indexable: true,
  },
  dca: {
    title: 'Mô phỏng DCA quỹ đầu tư Việt Nam | Fund Dashboard',
    description: 'Mô phỏng đầu tư định kỳ vào quỹ mở, ETF và các tài sản tại Việt Nam bằng dữ liệu lịch sử.',
    heading: 'Mô Phỏng DCA Quỹ Đầu Tư Việt Nam',
    indexable: true,
  },
  lsdca: {
    title: 'Lump Sum vs DCA tại Việt Nam | Fund Dashboard',
    description: 'So sánh đầu tư một lần với DCA trên lịch sử quỹ mở và ETF tại Việt Nam, kèm phân bố kết quả và các kịch bản percentile.',
    heading: 'Lump Sum và DCA: So Sánh Đầu Tư Một Lần',
    indexable: true,
  },
  fundanalysis: {
    title: 'Phân tích quỹ đầu tư Việt Nam | Fund Dashboard',
    description: 'Phân tích danh mục, tài sản và báo cáo tài chính của các quỹ đầu tư Việt Nam.',
    heading: 'Phân Tích Quỹ Đầu Tư Việt Nam',
    indexable: true,
  },
  overlap: {
    title: 'So sánh danh mục quỹ đầu tư | Fund Dashboard',
    description: 'So sánh cổ phiếu, ngành và tỷ trọng trùng giữa hai quỹ đầu tư Việt Nam.',
    heading: 'So Sánh Danh Mục Quỹ Đầu Tư',
    indexable: true,
  },
  rebalance: {
    title: 'Mô phỏng tái cân bằng danh mục | Fund Dashboard',
    description: 'Đánh giá độ nhạy của danh mục quỹ đầu tư khi tái cân bằng theo các chu kỳ khác nhau.',
    heading: 'Mô Phỏng Tái Cân Bằng Danh Mục',
    indexable: true,
  },
  tactical: {
    title: 'Phân tích phân bổ chiến thuật | Fund Dashboard',
    description: 'Kiểm tra chiến lược phân bổ chiến thuật trên dữ liệu lịch sử, cùng các cảnh báo về giới hạn backtest.',
    heading: 'Phân Bổ Chiến Thuật',
    indexable: true,
  },
  bitcoin: {
    title: 'Phân tích Bitcoin và quỹ đầu tư | Fund Dashboard',
    description: 'So sánh Bitcoin với quỹ đầu tư và các tài sản khác trên dữ liệu lịch sử.',
    heading: 'Bitcoin và Quỹ Đầu Tư',
    indexable: true,
  },
  wallofworry: {
    title: 'Wall of Worry: những nỗi lo thị trường | Fund Dashboard',
    description: 'Xem các nỗi lo thị trường từng xuất hiện và cách chúng kết thúc qua thời gian.',
    heading: 'Wall of Worry: Những Nỗi Lo Thị Trường',
    indexable: true,
  },
  calculator: {
    title: 'Máy tính đầu tư và lãi kép | Fund Dashboard',
    description: 'Tính lãi kép, CAGR và mức phí quỹ ăn mòn giá trị đầu tư theo thời gian.',
    heading: 'Máy Tính Đầu Tư và Lãi Kép',
    indexable: true,
  },
  methodology: {
    title: 'Phương pháp và dữ liệu | Fund Dashboard',
    description: 'Tìm hiểu nguồn dữ liệu, công thức và các giới hạn của những chỉ số trong Fund Dashboard.',
    heading: 'Phương Pháp và Dữ Liệu',
    indexable: true,
  },
  changelog: {
    title: 'Nhật ký thay đổi | Fund Dashboard',
    description: 'Theo dõi các thay đổi về dữ liệu, công thức và tính năng của Fund Dashboard.',
    heading: 'Nhật Ký Thay Đổi',
    indexable: false,
  },
}

function setMetaContent(attribute: 'name' | 'property', value: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${value}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, value)
    document.head.appendChild(element)
  }
  element.content = content
}

function setCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!element) {
    element = document.createElement('link')
    element.rel = 'canonical'
    document.head.appendChild(element)
  }
  element.href = href
}

export function SeoMetadata({ tab }: { tab: TabId }) {
  const location = useLocation()

  useEffect(() => {
    const meta = SEO_BY_TAB[tab]
    const appHomepage = location.pathname === '/' && location.search === ''
    const canonical = `${SITE_ORIGIN}/`

    document.title = meta.title
    setMetaContent('name', 'description', meta.description)
    setMetaContent('property', 'og:title', meta.title)
    setMetaContent('property', 'og:description', meta.description)
    setMetaContent('property', 'og:url', canonical)
    setMetaContent('name', 'twitter:title', meta.title)
    setMetaContent('name', 'twitter:description', meta.description)
    setMetaContent('name', 'robots', !meta.indexable || !appHomepage ? 'noindex, follow' : 'index, follow')
    setCanonical(canonical)
  }, [location.pathname, location.search, tab])

  return null
}
