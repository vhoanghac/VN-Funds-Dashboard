/**
 * Wall of Worry: các sự kiện khiến nhà đầu tư tin rằng thị trường sẽ giảm.
 *
 * Ý tưởng từ wallofworry.co: "markets climb a wall of worry". Giá cổ phiếu
 * thường vẫn đi lên trong khi mặt báo toàn tin xấu. Đánh dấu các sự kiện
 * này lên biểu đồ giá để thấy thị trường đã leo qua từng bức tường lo âu
 * như thế nào.
 *
 * 3 nhóm sự kiện:
 *   - world: bất ổn vĩ mô thế giới (chiến tranh, Fed, khủng hoảng ngân hàng...)
 *   - vn:    vĩ mô Việt Nam (chính sách, phong tỏa COVID, thiên tai, thuế quan...)
 *   - corp:  vi mô doanh nghiệp lớn Việt Nam (bầu Kiên, FLC, Vạn Thịnh Phát...)
 *
 * Mỗi sự kiện BẮT BUỘC có sourceUrl dẫn về bài báo chính thống hoặc Wikipedia.
 *
 * Danh sách chứa cả sự kiện TRƯỚC ngày quỹ trên biểu đồ niêm yết (vd Thông tư
 * 13 năm 2010, trước khi E1VFVN30 chào sàn 10/2014). Các sự kiện ngoài vùng
 * dữ liệu sẽ tự ẩn khỏi biểu đồ và danh sách, chỉ hiện lại nếu sau này biểu
 * đồ dùng chuỗi giá dài hơn.
 *
 * Muốn thêm sự kiện mới: thêm 1 object vào mảng WOW_EVENTS bên dưới,
 * giữ đúng thứ tự thời gian tăng dần.
 */

export type WowCategory = 'world' | 'vn' | 'corp'

export interface WowEvent {
  date: string          // YYYY-MM-DD
  label: string         // tên hiển thị trong danh sách
  shortLabel?: string   // tên rút gọn hiển thị trên biểu đồ (mặc định dùng label)
  description: string   // mô tả 1-2 câu
  category: WowCategory
  sourceUrl: string     // bài báo chính thống / Wikipedia về sự kiện (nguồn chính)
  extraSources?: { label: string; url: string }[]  // nguồn bổ sung khi có nhiều báo cùng đưa tin
}

export const WOW_CATEGORY_META: Record<WowCategory, { name: string; color: string }> = {
  world: { name: 'Thế giới', color: '#2563eb' },
  vn: { name: 'Vĩ mô Việt Nam', color: '#d97706' },
  corp: { name: 'Doanh nghiệp Việt Nam', color: '#dc2626' },
}

export const WOW_EVENTS: WowEvent[] = [
  {
    date: '2010-05-20',
    label: 'Thông tư 13 siết an toàn vốn ngân hàng',
    shortLabel: 'Thông tư 13',
    description: 'NHNN nâng hệ số an toàn vốn CAR từ 8% lên 9%, giới hạn cho vay tối đa 80% vốn huy động. Nỗi lo ngân hàng phải bán bớt tài sản đè nặng thị trường suốt quý 3/2010.',
    category: 'vn',
    sourceUrl: 'https://cafef.vn/thi-truong-chung-khoan/tac-dong-cua-thong-tu-13-voi-cac-nhtm-va-thi-truong-chung-khoan-20100821120220564.chn',
  },
  {
    date: '2011-08-20',
    label: 'S&P hạ bậc tín nhiệm Việt Nam',
    description: 'S&P hạ xếp hạng tín nhiệm nội tệ của Việt Nam từ BB xuống BB- với triển vọng tiêu cực, giữa giai đoạn lạm phát cao và căng thẳng thanh khoản hệ thống ngân hàng.',
    category: 'vn',
    sourceUrl: 'https://vnexpress.net/viet-nam-bi-s-p-ha-bac-tin-nhiem-2714423.html',
  },
  {
    date: '2012-08-20',
    label: 'Bầu Kiên bị bắt',
    description: 'Ông Nguyễn Đức Kiên, người sáng lập ACB, bị bắt tối 20/8. Phiên kế tiếp VN-Index mất hơn 4%, cổ phiếu ngân hàng bán sàn hàng loạt.',
    category: 'corp',
    sourceUrl: 'https://vneconomy.vn/thong-tin-bau-kien-bi-bat-nhung-phan-ung-ban-dau.htm',
  },
  {
    date: '2013-12-10',
    label: 'Đàm phán TPP không đạt thỏa thuận',
    shortLabel: 'TPP bế tắc',
    description: 'Hội nghị bộ trưởng TPP tại Singapore kết thúc mà không đạt thỏa thuận. Kỳ vọng của thị trường vào hiệp định mà Việt Nam được cho là hưởng lợi lớn nhất bị trì hoãn thêm.',
    category: 'world',
    sourceUrl: 'https://www.vietnamplus.vn/hoi-nghi-bo-truong-tpp-ket-thuc-ma-khong-dat-thoa-thuan-post234366.amp',
  },
  {
    date: '2014-05-02',
    label: 'Trung Quốc hạ đặt giàn khoan HD-981',
    shortLabel: 'Giàn khoan HD-981',
    description: 'Giàn khoan Hải Dương 981 được hạ đặt trái phép trong vùng đặc quyền kinh tế Việt Nam. Phiên 8/5 VN-Index giảm gần 6%, phiên giảm mạnh nhất trong hơn một thập kỷ.',
    category: 'vn',
    sourceUrl: 'https://vi.wikipedia.org/wiki/V%E1%BB%A5_h%E1%BA%A1_gi%C3%A0n_khoan_H%E1%BA%A3i_D%C6%B0%C6%A1ng_981',
  },
  {
    date: '2014-12-08',
    label: 'Giá dầu sụp đổ',
    description: 'Giá dầu Brent rơi từ trên 100 USD xuống dưới 60 USD trong nửa cuối 2014. Nhóm cổ phiếu dầu khí kéo cả thị trường giảm mạnh trong tháng 12.',
    category: 'world',
    sourceUrl: 'https://en.wikipedia.org/wiki/2010s_oil_glut',
  },
  {
    date: '2015-04-25',
    label: 'NHNN mua OceanBank giá 0 đồng',
    shortLabel: 'OceanBank 0 đồng',
    description: 'OceanBank trở thành ngân hàng thứ hai bị mua lại bắt buộc với giá 0 đồng, dấy lên lo ngại về sức khỏe thật của hệ thống ngân hàng.',
    category: 'corp',
    sourceUrl: 'https://tuoitre.vn/ngan-hang-nha-nuoc-mua-oceanbank-gia-0-dong-738767.htm',
  },
  {
    date: '2015-08-11',
    label: 'Trung Quốc phá giá nhân dân tệ',
    description: 'Trung Quốc bất ngờ phá giá nhân dân tệ 3 ngày liên tiếp. Việt Nam phải nới biên độ tỷ giá, chứng khoán toàn cầu bán tháo.',
    category: 'world',
    sourceUrl: 'https://en.wikipedia.org/wiki/2015%E2%80%932016_Chinese_stock_market_turbulence',
  },
  {
    date: '2016-01-04',
    label: 'Chứng khoán Trung Quốc ngắt mạch',
    description: 'Thị trường Trung Quốc kích hoạt ngắt mạch 2 lần ngay tuần giao dịch đầu năm, mở màn đợt bán tháo toàn cầu đầu 2016.',
    category: 'world',
    sourceUrl: 'https://en.wikipedia.org/wiki/2015%E2%80%932016_Chinese_stock_market_turbulence',
  },
  {
    date: '2016-04-06',
    label: 'Formosa: cá chết miền Trung',
    description: 'Sự cố môi trường Formosa khiến cá chết hàng loạt ở 4 tỉnh miền Trung, tâm lý xã hội bất ổn kéo dài nhiều tháng.',
    category: 'vn',
    sourceUrl: 'https://en.wikipedia.org/wiki/2016_Vietnam_marine_life_disaster',
  },
  {
    date: '2016-06-24',
    label: 'Brexit',
    description: 'Anh trưng cầu dân ý rời EU. VN-Index có lúc mất hơn 5% ngay trong phiên rồi hồi phần lớn về cuối ngày.',
    category: 'world',
    sourceUrl: 'https://vi.wikipedia.org/wiki/Brexit',
  },
  {
    date: '2016-11-09',
    label: 'Trump đắc cử tổng thống Mỹ',
    description: 'Kết quả bầu cử Mỹ ngoài mọi dự đoán. VN-Index giảm gần 3% trong phiên. Thị trường Mỹ sau đó lập đỉnh mới chỉ sau vài tuần.',
    category: 'world',
    sourceUrl: 'https://en.wikipedia.org/wiki/2016_United_States_presidential_election',
  },
  {
    date: '2016-12-09',
    label: 'Bắt ông Trần Phương Bình',
    shortLabel: 'Bắt ông Trần Phương Bình',
    description: 'Cựu Tổng giám đốc kiêm Phó chủ tịch HĐQT Ngân hàng Đông Á (DongABank) bị khởi tố, bắt tạm giam vì cố ý làm trái quy định quản lý kinh tế và vi phạm quy định cho vay.',
    category: 'corp',
    sourceUrl: 'https://vi.wikipedia.org/wiki/Tr%E1%BA%A7n_Ph%C6%B0%C6%A1ng_B%C3%ACnh',
  },
  {
    date: '2017-08-09',
    label: 'Tin đồn ông Trần Bắc Hà bị bắt',
    shortLabel: 'Tin đồn Trần Bắc Hà',
    description: 'Tin đồn cựu chủ tịch BIDV bị bắt lan nhanh khiến VN-Index giảm mạnh nhất trong nhiều tháng, vốn hóa bốc hơi khoảng 2 tỷ USD trong một phiên. Tin đồn sau đó bị bác bỏ.',
    category: 'corp',
    sourceUrl: 'https://tuoitre.vn/plo/dang-sau-cu-soc-thoi-bay-2-ti-usd-chung-khoan-post448970.html',
  },
  {
    date: '2017-12-08',
    label: 'Bắt tạm giam ông Đinh La Thăng',
    shortLabel: 'Bắt ông Đinh La Thăng',
    description: 'Ông Đinh La Thăng bị khởi tố, bắt tạm giam vì sai phạm thời kỳ lãnh đạo PVN. Lần đầu tiên một cựu ủy viên Bộ Chính trị bị bắt.',
    category: 'corp',
    sourceUrl: 'https://tuoitre.vn/khoi-to-bat-tam-giam-ong-dinh-la-thang-2017120816342809.htm',
  },
  {
    date: '2018-02-05',
    label: 'Bán tháo toàn cầu, VIX tăng sốc',
    description: 'Chỉ số sợ hãi VIX tăng vọt, Dow Jones có phiên mất hơn 1.100 điểm. VN-Index khi đó vừa chạm vùng đỉnh lịch sử 2007.',
    category: 'world',
    sourceUrl: 'https://dantri.com.vn/kinh-doanh/dow-jones-giam-manh-nhat-moi-thoi-dai-xoa-di-moi-thanh-tuu-trong-nam-nay-20180206085956167.htm',
  },
  {
    date: '2018-07-06',
    label: 'Chiến tranh thương mại Mỹ-Trung',
    description: 'Mỹ chính thức áp thuế lên hàng Trung Quốc. VN-Index đã giảm hơn 25% từ đỉnh tháng 4/2018, mở đầu bear market 2018-2019.',
    category: 'world',
    sourceUrl: 'https://en.wikipedia.org/wiki/China%E2%80%93United_States_trade_war',
  },
  {
    date: '2018-11-29',
    label: 'Chính thức bắt ông Trần Bắc Hà',
    shortLabel: 'Bắt ông Trần Bắc Hà',
    description: 'Hơn một năm sau tin đồn, cựu chủ tịch BIDV chính thức bị bắt vì sai phạm tại BIDV, giữa lúc thị trường vẫn chưa gượng dậy sau bear market 2018.',
    category: 'corp',
    sourceUrl: 'https://cafef.vn/nhin-lai-su-nghiep-cua-ong-tran-bac-ha-tu-ong-trum-tai-chinh-den-ngay-vuong-vong-lao-ly-voi-loat-sai-pham-nghiem-trong-va-qua-doi-luc-bi-tam-giam-20190718151216984.chn',
  },
  {
    date: '2020-03-11',
    label: 'WHO công bố đại dịch COVID-19',
    shortLabel: 'Đại dịch COVID-19',
    description: 'Thị trường toàn cầu rơi tự do. VN-Index mất khoảng 1/3 giá trị chỉ trong quý 1/2020, rồi bắt đầu một trong những nhịp hồi mạnh nhất lịch sử.',
    category: 'world',
    sourceUrl: 'https://vi.wikipedia.org/wiki/%C4%90%E1%BA%A1i_d%E1%BB%8Bch_COVID-19',
  },
  {
    date: '2021-01-28',
    label: 'Phiên giảm mạnh nhất lịch sử 20 năm, làn sóng COVID thứ 2',
    shortLabel: 'Làn sóng COVID thứ 2',
    description: 'VN-Index giảm 73,23 điểm (-6,67%) xuống 1.023,94 điểm, tại thời điểm đó là phiên giảm mạnh nhất kể từ khi thị trường vận hành hơn 20 năm, mạnh hơn cả khủng hoảng tài chính 2008 và thương chiến Mỹ-Trung 2018. Hơn 500 mã giảm sàn, toàn bộ rổ VN30 trắng bên mua. Nguyên nhân: Bộ Y tế công bố ca lây nhiễm cộng đồng mới tại Hải Dương và Quảng Ninh, mở đầu làn sóng COVID thứ 2.',
    category: 'vn',
    sourceUrl: 'https://tuoitre.vn/ban-thao-co-phieu-sau-tin-covid-19-chung-khoan-viet-giam-manh-nhat-the-gioi-2021012816275227.htm',
  },
  {
    date: '2021-07-09',
    label: 'Phong tỏa TP.HCM, làn sóng Delta',
    shortLabel: 'Phong tỏa TP.HCM (Delta)',
    description: 'TP.HCM giãn cách theo Chỉ thị 16, cả nước gồng mình qua làn sóng Delta. Vậy mà thị trường vẫn tăng suốt nửa cuối 2021 và lập đỉnh lịch sử đầu 2022.',
    category: 'vn',
    sourceUrl: 'https://tuoitre.vn/tp-hcm-gian-cach-toan-thanh-pho-theo-chi-thi-16-trong-15-ngay-tu-0h-9-7-20210707181657126.htm',
  },
  {
    date: '2022-02-24',
    label: 'Nga tấn công Ukraine',
    description: 'Chiến tranh lớn nhất châu Âu từ 1945 nổ ra. Giá dầu, phân bón, lương thực toàn cầu tăng vọt.',
    category: 'world',
    sourceUrl: 'https://en.wikipedia.org/wiki/Russian_invasion_of_Ukraine',
  },
  {
    date: '2022-03-29',
    label: 'Chủ tịch FLC bị bắt',
    description: 'Ông Trịnh Văn Quyết bị bắt vì thao túng chứng khoán sau vụ bán chui 74,8 triệu cổ phiếu FLC hồi tháng 1/2022.',
    category: 'corp',
    sourceUrl: 'https://vnexpress.net/chu-tich-flc-trinh-van-quyet-bi-bat-4444881.html',
  },
  {
    date: '2022-04-05',
    label: 'Tân Hoàng Minh hủy 9 lô trái phiếu',
    shortLabel: 'Tân Hoàng Minh hủy trái phiếu',
    description: 'Chủ tịch Tân Hoàng Minh bị bắt, 9 lô trái phiếu hơn 10.000 tỷ bị hủy. Niềm tin vào trái phiếu doanh nghiệp bất động sản bắt đầu sụp đổ.',
    category: 'corp',
    sourceUrl: 'https://vnexpress.net/chu-tich-tap-doan-tan-hoang-minh-bi-bat-4446517.html',
  },
  {
    date: '2022-06-15',
    label: 'Fed tăng lãi mạnh nhất từ 1994',
    description: 'Lạm phát Mỹ chạm 9%, Fed tăng 0,75 điểm % một lần. Kỷ nguyên tiền rẻ kết thúc, chứng khoán toàn cầu chìm trong bear market 2022.',
    category: 'world',
    sourceUrl: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20220615a.htm',
  },
  {
    date: '2022-10-08',
    label: 'Vạn Thịnh Phát, rút tiền hàng loạt tại SCB',
    shortLabel: 'Vạn Thịnh Phát & SCB',
    description: 'Bà Trương Mỹ Lan bị bắt, người dân xếp hàng rút tiền tại SCB. Trái phiếu doanh nghiệp đóng băng, VN-Index thủng 900 điểm tháng 11/2022, mất hơn 40% từ đỉnh.',
    category: 'corp',
    sourceUrl: 'https://vnexpress.net/chu-tich-tap-doan-van-thinh-phat-truong-my-lan-bi-bat-4520410.html',
  },
  {
    date: '2023-03-13',
    label: 'SVB sụp đổ, Credit Suisse bị giải cứu',
    shortLabel: 'SVB & Credit Suisse',
    description: 'Silicon Valley Bank là vụ phá sản ngân hàng lớn thứ 2 lịch sử Mỹ. Ít ngày sau, Credit Suisse 167 năm tuổi phải bán mình cho UBS.',
    category: 'world',
    sourceUrl: 'https://en.wikipedia.org/wiki/Collapse_of_Silicon_Valley_Bank',
  },
  {
    date: '2023-10-07',
    label: 'Xung đột Israel-Hamas',
    description: 'Chiến sự Trung Đông bùng phát giữa lúc tỷ giá và lãi suất trong nước căng thẳng. VN-Index điều chỉnh mạnh trong quý 4/2023.',
    category: 'world',
    sourceUrl: 'https://en.wikipedia.org/wiki/October_7_attacks',
  },
  {
    date: '2024-04-15',
    label: 'Hơn 150 mã giảm sàn, VN-Index mất 60 điểm',
    shortLabel: 'Fed trì hoãn hạ lãi suất',
    description: 'VN-Index giảm 60 điểm (4,7%), phiên giảm sâu nhất kể từ 18/8/2023. Toàn thị trường 886 mã giảm, hơn 150 mã giảm sàn. Nguyên nhân: CPI Mỹ tăng cao khiến kỳ vọng Fed hạ lãi suất bị trì hoãn, USD mạnh lên, tỷ giá trong nước căng thẳng, khối ngoại bán ròng liên tục.',
    category: 'world',
    sourceUrl: 'https://vietnambiz.vn/vi-sao-chung-khoan-viet-nam-bat-ngo-lao-doc-voi-hang-tram-ma-giam-san-2024415153614115.htm',
  },
  {
    date: '2024-08-05',
    label: 'Hoảng loạn khắp châu Á, VN-Index thủng 1.200 điểm',
    shortLabel: 'Yên Nhật tăng giá, carry trade sập',
    description: 'Nikkei giảm 13,47%, Kospi giảm 8,77% sau khi BOJ tăng lãi suất cuối tháng 7 khiến dòng vốn carry trade bằng yen đảo chiều ồ ạt. VN-Index giảm 48 điểm, thủng mốc 1.200, toàn thị trường 845 mã đỏ với 127 mã giảm sàn. Căng thẳng Iran-Israel leo thang cùng lúc làm trầm trọng thêm tâm lý.',
    category: 'world',
    sourceUrl: 'https://vneconomy.vn/hoang-loan-khap-chau-a-vn-index-thung-1-200-diem-co-san-la-liet-da-den-luc-vao-viec.htm',
  },
  {
    date: '2024-09-07',
    label: 'Siêu bão Yagi',
    description: 'Cơn bão mạnh nhất 30 năm đổ bộ miền Bắc, thiệt hại ước tính hơn 3 tỷ USD, ảnh hưởng nặng đến sản xuất và bảo hiểm.',
    category: 'vn',
    sourceUrl: 'https://vi.wikipedia.org/wiki/B%C3%A3o_Yagi_(2024)',
  },
  {
    date: '2025-01-27',
    label: 'DeepSeek chấn động Nvidia, bốc hơi gần 600 tỷ USD',
    shortLabel: 'DeepSeek chấn động Nvidia',
    description: 'Startup Trung Quốc DeepSeek ra mắt mô hình AI R1 hiệu năng tương đương nhưng chi phí huấn luyện chỉ khoảng 5,6 triệu USD, đánh thẳng vào luận điểm "hào lũy công nghệ" của Nvidia. Cổ phiếu Nvidia giảm 17% trong một phiên, kỷ lục mất giá lớn nhất lịch sử chứng khoán Mỹ của một công ty đơn lẻ.',
    category: 'world',
    sourceUrl: 'https://www.cnbc.com/2025/01/27/nvidia-sheds-almost-600-billion-in-market-cap-biggest-drop-ever.html',
  },
  {
    date: '2025-04-02',
    label: 'Mỹ công bố thuế đối ứng 46% với Việt Nam',
    shortLabel: 'Thuế đối ứng 46%',
    description: 'Mức thuế cao ngoài mọi dự đoán. VN-Index có chuỗi phiên giảm mạnh nhất lịch sử, riêng phiên 3/4/2025 mất gần 88 điểm.',
    category: 'vn',
    sourceUrl: 'https://vnexpress.net/ong-trump-ky-sac-lenh-ap-thue-doi-ung-voi-hang-chuc-nen-kinh-te-4869288.html',
  },
  {
    date: '2025-08-21',
    label: 'Vingroup: đế chế nợ vay, so sánh với Evergrande',
    shortLabel: 'Vingroup nợ 31 tỷ USD',
    description: 'Asia Times công bố phân tích: Vingroup gánh 31 tỷ USD nợ vay, chiếm 86% tổng tài sản, phải trả lãi khoảng 3,2 triệu USD mỗi ngày, nợ tăng thêm 4,7 tỷ USD chỉ trong nửa đầu 2025. Bài viết so sánh mô hình dùng lợi nhuận bất động sản tài trợ cho các mảng chưa có lãi (như VinFast) với Evergrande, đặt câu hỏi liệu Vingroup có trở thành rủi ro "quá lớn để sụp đổ" mà nhà nước buộc phải cứu nếu có biến.',
    category: 'corp',
    sourceUrl: 'https://asiatimes.com/2025/08/vingroups-debt-driven-empire-on-shaky-global-ground/',
    extraSources: [
      { label: 'The Vietnamese Magazine', url: 'https://thevietnamese.org/2025/08/a-debt-driven-empire-vingroup-operates-with-86-of-assets-on-loan/' },
    ],
  },
  {
    date: '2025-10-20',
    label: 'Phiên giảm mạnh nhất lịch sử: VN-Index mất hơn 94 điểm',
    shortLabel: 'Thanh tra trái phiếu doanh nghiệp',
    description: 'VN-Index giảm hơn 94 điểm, phiên giảm mạnh nhất lịch sử tại thời điểm đó. 108 mã giảm sàn, 325/326 mã trên HoSE giảm giá. Ngòi nổ là kết luận thanh tra của Chính phủ về hoạt động phát hành trái phiếu doanh nghiệp, nhưng mức độ giảm bị giới phân tích đánh giá là do tâm lý hoảng loạn bán theo đám đông nhiều hơn là vấn đề nền tảng.',
    category: 'vn',
    sourceUrl: 'https://cafef.vn/dang-sau-cu-lao-doc-manh-nhat-lich-su-chung-khoan-vua-xay-ra-188251020231143711.chn',
  },
  {
    date: '2025-12-19',
    label: 'Vingroup khởi công đồng loạt 11 công trình trọng điểm quốc gia',
    shortLabel: 'Vingroup khởi công 11 công trình',
    description: 'Sáng 19/12, Vingroup đồng loạt khởi công 11 dự án lớn khắp cả nước (đô thị Olympic, Hạ Long Xanh, đường sắt Bến Thành - Cần Giờ, nhà máy điện gió, thép...), tổng vốn đầu tư ước hơn 3,4 triệu tỷ đồng. Quy mô hạ tầng trọng điểm quốc gia dồn vào một tập đoàn tư nhân duy nhất khiến nhiều nhà đầu tư lo ngại về mức độ tập trung quyền lực kinh tế.',
    category: 'corp',
    sourceUrl: 'https://tuoitre.vn/vingroup-dong-loat-khoi-cong-khai-truong-11-du-an-lon-tren-ca-nuoc-20251220100321195.htm',
    extraSources: [
      { label: 'Dân Trí', url: 'https://dantri.com.vn/kinh-doanh/tap-doan-cua-ty-phu-pham-nhat-vuong-dong-loat-khoi-cong-11-du-an-20251219101108366.htm' },
      { label: 'VnExpress', url: 'https://vnexpress.net/vingroup-trien-khai-dong-loat-11-du-an-trong-diem-tren-ca-nuoc-4996001.html' },
      { label: 'Vingroup', url: 'https://vingroup.net/tin-tuc-su-kien/bai-viet/3750/vingroup-dong-loat-khoi-dong-khai-truong-11-cong-trinh-trong-diem-tren-toan-quoc' },
    ],
  },
  {
    date: '2026-02-28',
    label: 'Mỹ và Israel không kích Iran',
    shortLabel: 'Mỹ-Israel không kích Iran',
    description: 'Mỹ và Israel mở ba đợt không kích vào Iran rạng sáng 28/2. Xung đột lan rộng khắp Trung Đông trong nhiều tuần trước khi có thỏa thuận ngừng bắn.',
    category: 'world',
    sourceUrl: 'https://vnexpress.net/7-ngay-ruc-lua-rung-chuyen-trung-dong-5047534.html',
  },
  {
    date: '2026-03-09',
    label: 'Giá dầu vượt 100 USD/thùng, VN-Index lập kỷ lục giảm mới',
    shortLabel: 'Dầu vượt 100 USD, kỷ lục giảm mới',
    description: 'Giá dầu thế giới vượt mốc 100 USD/thùng lần đầu tiên sau gần 4 năm giữa căng thẳng địa chính trị và gián đoạn chuỗi cung ứng năng lượng. VN-Index giảm kỷ lục 115 điểm xuống 1.652 điểm, hơn 300 mã giảm sàn, vượt qua kỷ lục giảm điểm hồi tháng 10/2025. Thị trường Hàn Quốc, Nhật Bản cũng giảm mạnh cùng lúc.',
    category: 'world',
    sourceUrl: 'https://dantri.com.vn/kinh-doanh/hon-300-co-phieu-nam-san-chung-khoan-viet-giam-ky-luc-115-diem-20260309104533885.htm',
  },
  {
    date: '2026-05-26',
    label: 'VN-Index phân hóa "hình chữ K", một mình Vingroup gánh chỉ số',
    shortLabel: 'Phân hóa "hình chữ K"',
    description: 'VN-Index tăng mạnh nhưng gần như toàn bộ động lực đến từ nhóm Vingroup, phần lớn cổ phiếu còn lại chỉ đi ngang hoặc tích lũy. Thanh khoản giảm từ 30.169 tỷ đồng/phiên (quý 1) xuống 21.701 tỷ đồng/phiên (tháng 4), dấu hiệu dòng tiền thận trọng dần với một rally quá hẹp.',
    category: 'vn',
    sourceUrl: 'https://cafef.vn/vn-index-tang-manh-nhung-phan-hoa-hinh-chu-k-chuyen-gia-chi-ten-5-nhom-nganh-dang-chu-y-nua-cuoi-nam-2026-188260526102054296.chn',
  },
  {
    date: '2026-07-02',
    label: 'NHNN loại nợ Vingroup, Sun Group, Masterise khỏi room tín dụng',
    shortLabel: 'Vingroup được ưu ái room tín dụng',
    description: 'Ngân hàng Nhà nước công bố cơ chế loại nợ vay của 18 dự án trọng điểm quốc gia - dẫn đầu bởi Vingroup, Sun Group, Masterise - khỏi cách tính room tín dụng ngân hàng, cho phép các tập đoàn này vay thêm mà không bị tính vào hạn mức chung. Doanh nghiệp nhỏ hơn phải cạnh tranh trong phần room còn lại, dấy lên câu hỏi về sự ưu ái dành cho nhóm doanh nghiệp lớn.',
    category: 'vn',
    sourceUrl: 'https://dantri.com.vn/kinh-doanh/nhnn-noi-ve-co-che-von-dac-biet-cho-vingroup-sun-group-masterise-20260702101105038.htm',
  },
  {
    date: '2026-07-15',
    label: 'Dự thảo Thông tư thay thế Thông tư số 22/2019/TT-NHNN',
    shortLabel: 'Dự thảo siết vốn ngân hàng',
    description: 'NHNN họp bàn dự thảo thay thế Thông tư 22/2019 - quy định giới hạn, tỷ lệ an toàn quan trọng bậc nhất ngành ngân hàng - nhằm siết chuẩn theo Basel III. Mới chỉ là dự thảo xin ý kiến, chưa ban hành, nhưng giới đầu tư lo ngại yêu cầu vốn và quản trị rủi ro chặt hơn sẽ ảnh hưởng lợi nhuận và khả năng cho vay của nhóm cổ phiếu ngân hàng.',
    category: 'vn',
    sourceUrl: 'https://cafef.vn/ngan-hang-nha-nuoc-ban-viec-thay-the-thong-tu-quan-trong-bac-nhat-nganh-ngan-hang-188260719092130966.chn',
  },
  {
    date: '2026-07-24',
    label: 'Mỹ áp thuế bổ sung 10 tới 12,5% với 60 đối tác thương mại',
    shortLabel: 'Thuế bổ sung 12,5%',
    description: 'USTR áp thuế bổ sung với 60 nền kinh tế vì vấn đề lao động cưỡng bức, hiệu lực ngay từ 0 giờ 01 ngày 24/7/2026 giờ miền Đông Mỹ. Việt Nam nằm nhóm chịu mức cao nhất là 12,5%, trong khi Canada, Ấn Độ, Mexico chỉ chịu 10%. Biện pháp kéo dài 4 năm nếu không gia hạn. Đây là cú thuế thứ hai từ Mỹ sau mức đối ứng 46% hồi tháng 4/2025.',
    category: 'vn',
    sourceUrl: 'https://baodautu.vn/my-ap-thue-quan-tu-10---125-voi-60-doi-tac-thuong-mai-d651615.html',
  },
]
