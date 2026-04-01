# So Sánh Quỹ Đầu Tư Việt Nam

Chào mọi người.

Mình ấp ủ ước mơ làm một cái dashboard để so sánh quỹ mở cổ phiếu với ETF tại Việt Nam từ lâu. Ban đầu code bằng R nhưng dashboard lại chạy rất chậm, tính toán lại lâu, không phù hợp để làm những chuyện này. Mà bản thân cũng không thể học code nên đành gác lại mọi thứ.

Nay nhờ sự giúp đỡ của Claude Code thì ước mơ này đã thành hiện thực.

Dashboard so sánh hiệu suất các quỹ đầu tư mở (cổ phiếu, trái phiếu, cân bằng) và ETF tại Việt Nam. Dữ liệu cập nhật tự động hàng ngày.

**Demo:** [vn-funds-dashboard.vercel.app](https://vn-funds-dashboard.vercel.app)

![So Sánh](docs/screenshot1.png)

![Mô Phỏng](docs/screenshot2.png)

## Tính năng

### So Sánh quỹ
- Chọn quỹ để so sánh song song
- Chỉ số: CAGR, sụt giảm tối đa (max drawdown), rolling returns trung bình, tỷ lệ thắng theo năm
- Biểu đồ: lợi nhuận tích lũy, drawdown, lợi nhuận theo năm, rolling returns (6T–48T)
- Lọc theo khoảng thời gian: 6 tháng, 1 năm, 3 năm, YTD, tất cả, hoặc tùy chỉnh

### Mô Phỏng danh mục
- Tạo nhiều danh mục đầu tư với tỷ trọng tùy chỉnh
- Rebalance tự động theo quý hoặc theo năm

## Dữ liệu

**54 quỹ** (27 cổ phiếu + 19 trái phiếu + 5 cân bằng + 3 ETF), dữ liệu NAV lịch sử từ 2004.

### Quỹ cổ phiếu (27)

| Mã quỹ | Quản lý | Từ ngày |
|---------|---------|---------|
| DCDS | Dragon Capital | 2004 |
| BVFED | BaoViet Fund | 2014 |
| DCDE | Dragon Capital | 2014 |
| ENF | Eastspring | 2014 |
| MBVF | MB Capital | 2014 |
| VEOF | VinaCapital | 2014 |
| VCBFBCF | Vietcombank | 2014 |
| SSISCA | SSI | 2014 |
| MAFEQI | Manulife | 2014 |
| BVPF | BaoViet Fund | 2017 |
| VESAF | VinaCapital | 2017 |
| VNDAF | VNDirect | 2018 |
| DCAF | Dragon Capital | 2019 |
| MAGEF | Mirae Asset | 2019 |
| VCBFMGF | Vietcombank | 2021 |
| TBLF | Thinh Binh Long | 2021 |
| VLGF | SSI | 2021 |
| NTPPF | NTP Capital | 2022 |
| PHVSF | Phu Hung | 2022 |
| UVEEF | UOB Vietnam | 2022 |
| BMFF | Bordier MB | 2023 |
| VMEEF | VietinBank | 2023 |
| VCAMDF | VCA Capital | 2024 |
| LHCDF | Lien Hiep Capital | 2024 |
| VDEF | VFM | 2024 |
| TCGF | Techcom Capital | 2024 |
| EVESG | Eastspring | 2024 |

### Quỹ trái phiếu (19)

| Mã quỹ | Quản lý | Từ ngày |
|---------|---------|---------|
| VFF | VinaCapital | 2013 |
| DCBF | Dragon Capital | 2013 |
| BVBF | BaoViet Fund | 2016 |
| SSIBF | SSI | 2017 |
| DCIP | Dragon Capital | 2019 |
| VNDBF | VNDirect Asset | 2019 |
| VCBFFIF | Vietcombank | 2019 |
| PVBF | PVCom Capital | 2020 |
| MBBOND | MB Capital | 2020 |
| ABBF | An Binh Capital | 2020 |
| DFIX | Dragon Capital | 2021 |
| ASBF | Amber | 2021 |
| VLBF | VinaCapital | 2021 |
| MAFF | Mirae Asset | 2021 |
| LHBF | Lighthouse | 2022 |
| HDBOND | HD Capital | 2022 |
| VCAMFI | BanViet Capital | 2022 |
| VNDCF | VNDirect Asset | 2023 |
| MBAM | MB Capital | 2024 |

### Quỹ cân bằng (5)

| Mã quỹ | Quản lý | Từ ngày |
|---------|---------|---------|
| VCBFTBF | Vietcombank | 2013 |
| VCAMBF | BanViet Capital | 2014 |
| VIBF | VinaCapital | 2019 |
| MAFBAL | Manulife | 2017 |
| MDI | Manulife | 2024 |

### ETF (3)

| Mã quỹ | Quản lý | Từ ngày |
|---------|---------|---------|
| E1VFVN30 | Dragon Capital | 2014 |
| FUEVFVND | Dragon Capital | 2020 |
| FUEDCMID | Dragon Capital | 2022 |

### Nguồn dữ liệu
- **Quỹ mở:** [fmarket.vn](https://fmarket.vn) API
- **ETF:** [vnstock](https://github.com/thinh-vu/vnstock) (nguồn VCI)
- **Cập nhật:** GitHub Actions chạy tự động 18:00 (giờ VN), thứ 2–6
