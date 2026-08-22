const ENTRIES = [
  {
    version: 'v4.4',
    date: '22/08/2026',
    items: [
      'Sửa cách tính giá quỹ có cổ tức, để lợi nhuận và số tiền nhận lại sát với thực tế hơn.',
      'Sửa lỗi dữ liệu lặp ngày: dashboard vẫn hiển thị được quỹ và báo rõ chỗ cần kiểm tra, thay vì làm mất cả quỹ.',
      'Vàng giờ có cả giá mua vào và bán ra. DCA và tái cân bằng đều tính đến chênh lệch giữa hai mức giá này.',
      'Tab So Sánh gọn hơn: bỏ phần "Đọc nhanh trước khi nhìn biểu đồ". Xem cảnh báo dữ liệu xong là tới ngay KPI và biểu đồ.',
      'Chọn một khoảng thời gian ngắn giờ dễ hơn. Ngày đang nhập không bị thay đổi giữa chừng, biểu đồ bám đúng khoảng đã chọn.',
      'Tab Phân Tích Quỹ không còn hiện nhầm biểu đồ của kỳ báo cáo cũ khi bạn đổi sang kỳ mới.',
    ],
  },
  {
    version: 'v4.3',
    date: '18/08/2026',
    items: [
      'Sửa lỗi các tab mô phỏng tự tính lại khi đang chỉnh thông số. Kết quả chỉ cập nhật sau khi bấm nút chạy.',
      'Sửa lỗi cho phép tính khi dữ liệu còn đang tải hoặc đang có lỗi; dashboard giờ chờ dữ liệu đầy đủ trước khi chạy.',
      'Sửa lỗi tab Bitcoin ghép kết quả mới với thông số cũ trong lúc phần phân tích chi tiết đang tính.',
      'Thêm cảnh báo khi thông số đã thay đổi nhưng kết quả đang hiển thị vẫn là lần chạy trước.',
      'Sửa phần cổ tức trong tab DCA, để giá quỹ, tiền cổ tức và số chứng chỉ được tính đúng.',
      'Bổ sung kiểm tra với dữ liệu thật của DCDE và TCBF, từ ngày trước khi chia đến ngày nhận tiền.',
      'Dọn lại phần tính DCA để các mô phỏng xử lý ngày và tái cân bằng thống nhất hơn, không làm đổi kết quả cũ.',
      'Mở rộng Monte Carlo trong tab DCA.',
    ],
  },
  {
    version: 'v4.2',
    date: '14/08/2026',
    items: [
      'Thêm tab "Phân Tích Quỹ" (beta)',
      'Sửa lỗi số liệu ở tab LS vs DCA: câu kể "về đích X triệu" giờ khớp đúng con số chênh lệch hiển thị (trước đây hai cái mâu thuẫn nhau).',
      'Sửa lỗi trục y biểu đồ "Lợi nhuận tích lũy" ở tab So Sánh: trước hiển thị mốc −200% dù chuỗi không bao giờ âm sâu vậy, giờ tự căn theo dữ liệu thật.',
      'Gom các hàm dùng chung cho biểu đồ (trục thời gian, định dạng ngày/%, làm mờ legend) về một nơi, sửa một chỗ là hết tất cả biểu đồ.',
      'Gom danh sách 12 tab về một nơi trong code. Thêm tab mới chỉ cần khai báo một chỗ, không phải sửa rải rác App.tsx nữa.',
      'Dọn lại code nội bộ: gom những đoạn tính toán bị viết lặp ở nhiều chỗ về một nơi duy nhất, để sửa lỗi sau này chỉ cần đụng một chỗ.',
      'Gom định nghĩa "danh mục" trong code về một nơi, để sửa một chỗ là hết tất cả các tab.',
      'Sửa lỗi link chia sẻ: danh mục có tiết kiệm ngân hàng (mã "SAVINGS:6") mở ra bị hiểu thành quỹ "SAVINGS", mất luôn khoản tiền đang hưởng lãi. Trọng số có phần thập phân như 33,3% cũng bị cắt mất phần lẻ.',
      'Sửa lỗi link chia sẻ ghi đè dữ liệu của người nhận: giờ mở link thấy đúng danh mục của người gửi, dữ liệu đã lưu của mình vẫn nguyên vẹn. Danh mục lưu từ phiên bản cũ có tần suất tái cân bằng không hợp lệ giờ tự chuyển về "Hàng quý" thay vì âm thầm chạy sai.',
      'Sửa lỗi bộ lọc thời gian: đang ở tab DCA mà không có link chia sẻ, chuyển sang tab khác thì khoảng ngày đang chọn ở tab So Sánh bị mất. Giờ chỉ xoá bộ lọc khi URL thật sự chứa link chia sẻ.',
      'Link chia sẻ ở tab DCA và LS vs DCA giờ áp dụng: dán link mới vào thanh địa chỉ là trang tự cập nhật, không cần tải lại.',
      'Gom code xử lý link chia sẻ của hai tab DCA và LS vs DCA về một chỗ.',
    ],
  },
  {
    version: 'v4.1',
    date: '11/08/2026',
    items: [
      'Thêm tab Overlap: So sánh mức độ trùng lặp của các quỹ cổ phiếu',
      'Thêm dữ liệu vàng nhẫn DOJI',
      'Bổ sung thêm các quỹ mở',
    ],
  },
  {
    version: 'v4.0',
    date: '04/08/2026',
    items: [
      'Thêm tab Máy tính nhanh.',
      'Thêm biểu đồ heatmap lợi nhuận theo tháng cho tab So Sánh. Mỗi quỹ hiển thị đầy đủ lịch sử riêng, không bị cắt theo bộ lọc thời gian đang chọn; năm mới nhất luôn ở trên cùng.',
      'Thêm "Tiết kiệm ngân hàng (lãi suất cố định, tự nhập)" vào danh sách chọn quỹ.',
      'Sửa lỗi MWRR bị tính 2 lần (khuếch đại con số thực lên làm 2) trong mục "Nếu bạn hoảng loạn dừng đầu tư khi thấy đỏ".',
      'Thêm biểu đồ "Giá trị tài sản" trong tab Chiến Thuật Phân Bổ, đặt ngay trên biểu đồ lợi nhuận tích lũy: cùng 3 đường (chiến thuật, mua giữ luôn danh mục A, mua giữ luôn danh mục B) nhưng vẽ theo giá trị tiền thật thay vì phần trăm.',
      'Thêm khối "Phân tích từng giai đoạn" trong tab Chiến Thuật Phân Bổ: tách lợi thế cuối kỳ của chiến thuật thành từng đoạn giữ nguyên một danh mục, cảnh báo khi một đoạn duy nhất chiếm hơn nửa phần lợi thế dương. Nhiều chiến thuật thắng mua-giữ trên giấy thật ra chỉ nhờ đúng một lần chuyển may mắn, không phải nhờ cả trăm lần quyết định.',
      'Thêm tuỳ chọn "Chốt tín hiệu" (Mỗi phiên / Cuối tuần / Cuối tháng) trong tab Chiến Thuật Phân Bổ.',
      'Sửa lỗi tab Chiến Thuật Phân Bổ: cửa sổ chỉ báo (SMA/EMA/RSI) bị pha loãng khi tín hiệu hoặc danh mục có tiết kiệm ngân hàng. Tiết kiệm sinh giá cho mọi ngày lịch, kể cả cuối tuần, nên "SMA200" vô tình chỉ còn tính trên khoảng 136 phiên giao dịch thật thay vì 200 phiên như tên gọi.',
      'Sửa lỗi tab Chiến Thuật Phân Bổ: chọn quỹ khác trong lúc màn hình đang có kết quả làm trang đứng hình vài giây, dù chưa bấm "Chạy lại".',
      'Đồng bộ giao diện 3 khối kết quả trong tab Chiến Thuật Phân Bổ (Bảng thống kê, Phân tích từng giai đoạn, Nhật ký chuyển đổi) theo đúng kiểu thẻ dùng chung của dashboard, viết lại một số đoạn giải thích cho dễ hiểu hơn.',
    ],
  },
  {
    version: 'v3.9',
    date: '28/07/2026',
    items: [
      'Thêm biểu đồ "Giá tài sản" ở đầu tab So Sánh, dành cho ai chỉ muốn biết giá thực tế của một chứng chỉ quỹ, một lượng vàng hay một đồng Bitcoin, thay vì xem lợi nhuận phần trăm.',
      'Thêm bảng hiệu suất Bitcoin theo năm nhiệm kỳ tổng thống Mỹ trong tab Bitcoin.',
      'Thêm khối "DCA tốn bao nhiêu tiền so với đầu tư một lần?" trong tab LS vs DCA. Bảng heatmap sẵn có chỉ trả lời DCA thua bao nhiêu lần, khối mới trả lời thua bao nhiêu tiền, quy ra tiền thật ở từng mốc thời gian nắm giữ.',
      'Mỗi ô trong bảng heatmap của tab LS vs DCA giờ hiện thêm số giai đoạn tách rời. Các kịch bản lịch sử chồng lấn nhau rất nặng, ví dụ 2.507 kịch bản ở mốc giữ 5 năm thật ra chỉ là 2 giai đoạn không dùng chung dữ liệu. Ô nào có dưới 3 giai đoạn tách rời thì bị làm mờ và có dấu cảnh báo.',
      'Thêm khối "Đỉnh đã qua bao lâu rồi?" trong tab LS vs DCA. Đây là khối quan trọng hơn khối chia theo mức giảm ngay bên trên nó: đo trên dữ liệu thật thì mức giảm là biến yếu, còn thời gian kể từ đỉnh là biến mạnh. Cùng dải giảm 50 tới 60% của Bitcoin, vào lệnh 2 tháng sau đỉnh thì một năm sau lỗ 61%, vào lệnh 29 tháng sau đỉnh thì lãi 430%. Quy luật này lặp lại ở cả bốn quỹ đã thử. Mỗi dòng ghi kèm tình trạng thị trường lúc đó, tức bao nhiêu phần trăm số lần vẫn đang lỗ vào ngày bán.',
      'Mỗi dòng trong hai khối chia theo mức giảm và theo thời gian kể từ đỉnh giờ ghi rõ tháng bắt đầu của từng giai đoạn, để bạn tự đối chiếu thay vì phải tin. Sửa luôn cách đếm giai đoạn: bản cũ gộp nguyên một sóng tăng ba năm thành một giai đoạn ở dải sát đỉnh, trong khi dải giảm nhẹ lại vỡ thành 23 mẩu, hai dải không so được với nhau.',
      'Thêm khối "Vào lệnh lúc thị trường đã giảm sâu thì sao?" trong tab LS vs DCA. Các khối khác gộp chung mọi thời điểm bắt đầu, khối này tách theo mức giảm so với đỉnh lúc vào lệnh (sát đỉnh, −10 tới −20%, ... , dưới −60%), để xem đầu tư một lần và DCA khác nhau ra sao khi giá đã rơi sâu. Mức giảm đo bằng đỉnh cao nhất tính tới đúng ngày đó, không dùng đỉnh của cả chuỗi. Mỗi dòng ghi kèm số đợt sụt giảm tách rời, vì các dải sâu dồn hàng trăm kịch bản vào đúng vài cú sập: Bitcoin giảm quá 60% có 735 kịch bản nhưng chỉ thuộc 3 đợt. Chọn được ba kỳ nắm giữ: bán ngay khi rải xong, giữ thêm 1 năm, hoặc giữ thêm 2 năm rồi mới bán.',
      'Khối "DCA lời/lỗ bao nhiêu so với đầu tư một lần?" (trước tên là "DCA tốn bao nhiêu tiền...") giờ có mốc liên tục từ 1 tới 10 năm thay vì nhảy cóc, và mỗi dòng ghi sẵn cách tách ra: dòng "3 năm" với kỳ DCA 12 tháng hiện thêm dòng phụ "rải 12 tháng + giữ 2 năm". Mốc luôn là tổng thời gian tính từ ngày xuống tiền lần đầu, khỏi phải đoán đếm từ đâu.',
      'Thêm khối "Bắt đầu đúng vào một tháng thì khoản đầu tư sẽ ra sao?" trong tab LS vs DCA. Heatmap và bảng chi phí đều là con số gộp của hàng nghìn lần thử, khối này mở đúng một lần thử ra xem bên trong: hai đường tiền cùng xuất phát, tách nhau ở đâu, chênh bao nhiêu lúc bán. Có ba nút chọn sẵn tháng tệ nhất, thường gặp, tốt nhất, và thanh trượt để tự kéo qua từng tháng khởi đầu.',
      'Sửa lỗi nặng ở tab LS vs DCA với danh mục nhiều quỹ khác ngày ra đời. Dashboard chạy thử từ ngày quỹ đầu tiên trong danh mục, kể cả những ngày mà quỹ còn lại chưa ra đời. Phần vốn của quỹ chưa có mặt bị trừ khỏi tổng vốn nhưng không mua được gì, nên bốc hơi im lặng và hiện thành khoản lỗ không có thật. Kết quả còn đổi theo thứ tự bạn xếp quỹ: danh mục DCDS với E1VFVN30 chia đôi, đặt DCDS trước cho lãi trung bình 8,1%, đặt E1VFVN30 trước cho 17,1%. Giờ mọi phép thử chỉ chạy trên quãng thời gian mà tất cả các quỹ đều đã có giá, nên xếp quỹ theo thứ tự nào cũng ra một kết quả.',
      'Cùng lỗi trên, số giai đoạn tách rời cũng bị thổi lên. Với danh mục DCDS và E1VFVN30, heatmap hàng 2 năm báo 11 giai đoạn trong khi con số đúng là 5, tức lớp cảnh báo về cỡ mẫu nói quá gấp đôi. Dòng ghi khoảng thời gian phân tích cũng sai theo, ghi từ 2004 trong khi thực tế chỉ chạy được từ 2014. Cả hai đã sửa.',
      'Sửa lỗi tab LS vs DCA: đổi tên quỹ làm hệ thống tự tính lại và gây khựng máy, dù người dùng chưa bấm "Chạy Phân Tích". Tệ hơn, kết quả hiện ra được tính bằng cấu hình cũ. Giờ chỉ nút "Chạy Phân Tích" mới kích hoạt tính toán.',
    ],
  },
  {
    version: 'v3.8',
    date: '24/07/2026',
    items: [
      'Thêm chức năng mô phỏng Monte Carlo trong mục Endgame của tab DCA.',
      'Thêm tab "Chiến Thuật Phân Bổ": mô phỏng chuyển đổi giữa 2 danh mục dựa trên tín hiệu SMA/EMA/RSI của một quỹ hoặc chỉ số bạn chọn.',
      'Thêm biểu đồ mô phỏng tăng thêm tiền DCA khi thị trường giảm sâu, trong mục "Nếu bạn hoảng loạn dừng đầu tư khi thấy đỏ?" của tab DCA.',
      'Thêm tab "Minh Bạch Hoá": tài liệu giải thích chính xác cách dashboard tính từng con số (công thức, cách tính, dữ liệu dùng), bắt đầu từ tab DCA. Mỗi chỉ số đều có công thức, giải thích và ví dụ số cụ thể để bạn tự kiểm chứng.',
      'Rà soát lại toàn bộ công thức tính, bảng và biểu đồ trong dashboard; sửa một số lỗi tính toán: mức tệ nhất 1 tuần/1 tháng ở tab Bitcoin, thứ hạng rolling return trong tab DCA, và độ lệch chuẩn/Sharpe của danh mục có Bitcoin trong tab Tái Cân Bằng.',
    ],
  },
  {
    version: 'v3.7',
    date: '21/07/2026',
    items: [
      'Thêm dữ liệu giá vàng SJC (lấy từ nguồn sjc.com.vn), chọn được như một quỹ trong tab DCA và So Sánh.',
      'Sửa lỗi tính toán trong tab DCA, mục "Nếu bạn hoảng loạn dừng nạp khi thấy đỏ?": số lần bỏ nạp bị đếm trùng nhiều lần cho cùng một đợt sụt giảm.',
      'Chỉnh sửa table kết quả kịch bản trong mục "Hoảng loạn dừng đầu tư" cho dễ hiểu hơn.',
      'Thêm dữ liệu giá vàng nhẫn SJC 99,99% (1/2/5 chỉ), chọn được như một quỹ riêng bên cạnh vàng miếng SJC trong tab DCA và So Sánh.',
      'Thêm cảnh báo trong tab DCA: kiểm tra số tiền đầu tư vào vàng (ban đầu hoặc định kỳ) có đủ mua ít nhất 1 lô ngoài đời (0,5 chỉ) hay không — vì mô phỏng vẫn giả định mua được đúng số tiền đó mỗi kỳ, kể cả khi thực tế chưa đủ.',
      <>Sửa lỗi phần Endgame bị sai do sử dụng CAGR của danh mục thay vì CAGR của chính tài sản (đóng góp bởi bạn{' '}
        <a href="https://substack.com/@trinhlecong94" target="_blank" rel="noopener noreferrer">@trinhlecong94</a>).</>
    ],
  },
  {
    version: 'v3.6',
    date: '19/07/2026',
    items: [
      'Thêm tab "Tái Cân Bằng": kiểm tra chọn lịch tái cân bằng nào (hàng ngày, hàng tuần, theo ngưỡng lệch tỷ trọng...) cho kết quả tốt hơn, thử tự động hàng trăm biến thể trên cùng một danh mục.',
      'Sửa lỗi: Mất tên danh mục tự đặt khi chia sẻ link.',
    ],
  },
  {
    version: 'v3.5',
    date: '17/07/2026',
    items: [
      'Thêm mục "Sự kiện" trên biểu đồ "Giá trị tài sản" trong tab DCA: bật lên để xem các sự kiện Wall of Worry (chiến tranh, đại dịch, khủng hoảng...) đè lên đúng thời điểm trong hành trình DCA của bạn.',
      'Thêm biểu đồ "Danh mục nào đang dẫn trước?" trong tab DCA: tỷ số giá trị giữa 2 danh mục theo thời gian, giúp thấy giai đoạn nào danh mục nào mạnh hơn thay vì nhìn 2 đường chồng lên nhau.',
      'Thêm biểu đồ "Bản đồ lợi nhuận và rủi ro" trong tab DCA: đặt lợi nhuận cạnh mức sụt giảm tối đa của từng danh mục trên cùng một biểu đồ, kèm nhận xét danh mục nào đang hiệu quả nhất.',
      'Thêm nút chọn nhanh từng phần kết quả (Hiệu suất đầu tư / Hành trình của bạn / Rủi ro & biến động / Endgame) ngay dưới nút "Chạy DCA", giúp xem đúng phần cần mà không phải cuộn qua toàn bộ trang.',
      'Thêm mục "Cùng 100 triệu, vào ở thời điểm khác nhau" trong phần Rủi ro & biến động: mô phỏng mua một lần 100 triệu tại 5 mốc thời gian (10 năm/5 năm/3 năm/1 năm/6 tháng trước) rồi giữ đến nay, xem mỗi khoản hiện thành bao nhiêu.',
      'Mục "Kiên trì qua bão" ghi thêm mức tăng cần thiết để hòa vốn sau mỗi lần sụt giảm (vd -42% cần tăng +73% mới về lại đỉnh cũ), nhấn mạnh sụt càng sâu thì càng khó gỡ lại.',
      'Biểu đồ "Bản đồ lợi nhuận và rủi ro" bổ sung nhận xét về đánh đổi giữa các danh mục: giữ được bao nhiêu % lợi nhuận và né được bao nhiêu % sụt giảm so với danh mục lời nhất.',
      'Sắp xếp lại tab DCA: chuyển mục "Cùng 100 triệu..." và "Nếu bạn bắt đầu ở thời điểm khác thì sao?" (rolling returns) vào phần Rủi ro & biến động; Endgame giờ chỉ còn phần dự phóng tương lai.',
    ],
  },
  {
    version: 'v3.4',
    date: '13/07/2026',
    items: [
      'Thêm tab "Wall of Worry": biểu đồ giá E1VFVN30 từ ngày niêm yết, đánh dấu 25 sự kiện bất ổn lớn (thế giới, vĩ mô Việt Nam, doanh nghiệp Việt Nam) từng khiến nhà đầu tư tin rằng thị trường sẽ giảm.',
      'Danh sách sự kiện có checkbox bật/tắt hiện từng sự kiện trên biểu đồ, bấm vào tên để xem mô tả kèm link nguồn báo chí chính thống.',
      'Sửa lỗi hiển thị: nút "Log"/"Sự kiện" đang bật (nền cam) mà rê chuột vào thì chữ bị chìm vào nền (chữ cam trên nền cam).',
      'Sửa lỗi biểu đồ "Đóng góp của Bitcoin vào lợi nhuận tích lũy" trong tab Bitcoin.',
    ],
  },
  {
    version: 'v3.3',
    date: '12/07/2026',
    items: [
      'Bỏ tab Mô Phỏng: tab DCA giờ đã mô phỏng được cả đầu tư 1 lần (để "Số tiền đầu tư định kỳ" = 0) lẫn định kỳ, nên không cần tách riêng 2 tab nữa.',
      'Thêm nhóm "Hiệu suất đầu tư" trong tab DCA, gom biểu đồ Giá trị tài sản, Bảng thống kê và Hiệu suất từng năm vào cùng một mục.',
      'Thêm bảng "Các đợt sụt giảm lớn nhất" trong mục Kiên trì qua bão: liệt kê top 5 đợt sụt từ 5% trở lên, kèm ngày lập đỉnh, chạm đáy, hồi phục và tổng thời gian dưới đỉnh.',
      'Bảng thống kê có thêm 3 cột: Sụt giảm trung bình, Dưới đỉnh lâu nhất, và Biến động (độ lệch chuẩn quy năm).',
      'Thêm nút "Log" cho biểu đồ Giá trị tài sản, giúp nhìn rõ tốc độ tăng trưởng ở giai đoạn đầu khi giá trị còn nhỏ.',
      'Cập nhật bảng cổ tức DCDE chi tiết hơn: thêm cột "Thuế TNCN" và "Tiền mặt trước thuế" bên cạnh "Tiền mặt thực nhận", giúp thấy rõ số tiền cổ tức gốc trước khi bị khấu trừ thuế.',
    ],
  },
  {
    version: 'v3.2',
    date: '10/07/2026',
    items: [
      'Sửa cách đặt tên danh mục DCA',
      'Chỉnh sửa lại thiết kế biểu đồ cho dễ nhìn',
      'Rút ngắn định dạng đường link chia sẻ',
      'Cập nhật công thức: nếu danh mục có quỹ bị thiếu dữ liệu trong thời gian lớn hơn 1 tuần (thường xảy ra với các quỹ đời đầu) thì lấy dữ liệu gần nhất của tuần trước đó.',
      'Thêm quỹ ETF: FUESSVFL (Finlead) và FUEVN100 (VN100)',
      'Sửa lỗi tính toán: trước đây một số chỉ số (CAGR, rolling return, sụt giảm tối đa...) dùng dữ liệu đã resample theo tuần nên có sai số nhỏ ở các mốc ngắn hạn. Nay toàn bộ các tab tính trực tiếp trên dữ liệu theo ngày.',
      'Sửa lỗi hiệu năng: chuyển tab đôi khi bị đơ nhẹ và biểu đồ tự vẽ lại dù không có gì thay đổi. Nay các tab không còn tính toán lại mỗi lần chuyển qua chuyển lại, và biểu đồ không animate lại mỗi lần xuất hiện.',
      'Sửa lỗi giao diện: gõ số vào ô "Số tiền đầu tiên" / "Số tiền đầu tư định kỳ" đôi khi làm con trỏ nhảy lung tung, nhất là khi sửa số ở giữa chứ không phải gõ tiếp ở cuối. Nay con trỏ giữ đúng vị trí khi gõ.',
      'Sửa lỗi hiệu năng: sau khi bấm "Chạy DCA", gõ số vào bất kỳ ô nào (kể cả không liên quan) có thể làm trang bị đơ nặng trong chốc lát vì toàn bộ biểu đồ, bảng thống kê, hiệu suất từng năm... tự tính lại dù dữ liệu chưa đổi. Nay các mục này chỉ tính lại khi bạn thực sự bấm "Chạy DCA".',
    ],
  },
  {
    version: 'v3.1',
    date: '24/04/2026',
    items: [
      'Sửa đổi cách tính hiệu suất của DCDE vì quỹ có chi trả cổ tức. Dashboard tự điều chỉnh lịch sử giá tại layer CSV loader (Yahoo-style factor: (closePreEx − div × 95%) / closePreEx), áp dụng nhất quán cho toàn bộ các tab So Sánh, Mô Phỏng, LS vs DCA, Bitcoin và DCA. File .csv gốc không thay đổi — adjustment chạy in-memory mỗi lần load.',
      'Tab DCA có thêm mục "Cổ tức & tái đầu tư" liệt kê các đợt chi trả của DCDE rơi vào kỳ DCA của bạn, kèm giải thích về raw NAV vs adjusted NAV.',
      'Thiết kế pipeline xử lý cổ tức tách biệt hoàn toàn khỏi dữ liệu gốc: DCDE.csv vẫn là raw NAV từ fmarket, dễ audit và so khớp trực tiếp với fmarket. Khi DCDE chia thêm cổ tức, chỉ cần thêm 1 dòng vào dividends.json — không sửa CSV, không đụng GitHub Actions. Nếu sau này thuế TNCN thay đổi, chỉ cần sửa 1 hàm.',
    ],
  },
  {
    version: 'v3.0',
    date: '20/04/2026',
    items: [
      'Thiết kế lại toàn bộ giao diện và thêm nhiều mục phân tích trong tab So Sánh, DCA và Bitcoin',
      'Thêm mục "Kể chuyện so sánh" trong tab So Sánh',
      'Thêm mục "Chất lượng dữ liệu" ở đầu tab So Sánh: minh bạch khoảng dữ liệu của từng quỹ, phát hiện khoảng trống giữa các tuần, và cảnh báo khi dữ liệu chậm cập nhật quá 10 ngày so với hôm nay',
      'Thêm chỉ số phục hồi sau sụt giảm và số tuần nằm dưới đỉnh cũ vào thống kê drawdown',
      'Viết lại lời kể ở tab DCA cho gần retail hơn',
    ],
  },
  {
    version: 'v2.9',
    date: '17/04/2026',
    items: [
      'Tab Bitcoin được thiết kế lại theo hướng kể chuyện cho nhà đầu tư retail: mỗi biểu đồ kèm một hộp "takeaway" nhỏ giải thích con số có ý nghĩa gì với ví tiền của bạn',
      'Thêm section divider phân nhóm các biểu đồ trong tab Bitcoin thành 3 khu vực rõ ràng: kết quả & tâm lý → vai trò của Bitcoin trong danh mục → phân tích chi tiết theo tỷ trọng 0%–10%',
    ],
  },
  {
    version: 'v2.8',
    date: '15/04/2026',
    items: [
      'Thêm Bitcoin (BTC/VND)',
      'Dữ liệu BTC/VND lấy trực tiếp từ CoinGecko, lịch sử từ tháng 9/2014, tự động cập nhật hàng ngày',
      'Tab Bitcoin: chọn quỹ nền tảng, tự đặt tỷ trọng Bitcoin (3 mức tùy chỉnh, mặc định 1%/2%/3%), so sánh lợi nhuận tích lũy với danh mục thuần quỹ, có tái cân bằng định kỳ',
      'Thêm nút "Log" trên biểu đồ Lợi Nhuận Tích Lũy: chuyển sang trục logarithmic để so sánh tài sản có mức tăng trưởng chênh lệch lớn (ví dụ: Bitcoin vs quỹ cổ phiếu)',
      'Bấm vào legend trên tất cả biểu đồ để làm mờ đường/cột thay vì ẩn hoàn toàn, giúp dễ quan sát hơn',
    ],
  },
  {
    version: 'v2.7',
    date: '10/04/2026',
    items: [
      'Thêm nút "Copy link chia sẻ" vào tất cả các tab',
      'Lưu cấu hình vào bộ nhớ trình duyệt: quỹ đã chọn, số tiền, tần suất... tự động khôi phục khi vào lại',
    ],
  },
  {
    version: 'v2.6',
    date: '09/04/2026',
    items: [
      'Ô nhập số tiền tự động thêm dấu chấm phân cách hàng nghìn khi nhập (ví dụ: 5.000.000 thay vì 5000000)',
    ],
  },
  {
    version: 'v2.5',
    date: '08/04/2026',
    items: [
      'Sửa lỗi 3 quỹ ETF (E1VFVN30, FUEVFVND, FUEDCMID) ngừng cập nhật giá từ 27/03 do thiếu API key khi tự động lấy dữ liệu',
    ],
  },
  {
    version: 'v2.4',
    date: '03/04/2026',
    items: [
      'Sửa lỗi dropdown "Quỹ đầu tư khi chờ" trong tab LS vs DCA không hiển thị danh sách quỹ',
      'Chỉ hiển thị 5 quỹ trái phiếu lâu đời nhất để làm vốn chờ: VFF, DCBF, BVBF, SSIBF, DCIP',
      'Cải thiện tính toán vốn chờ: dùng giá gần nhất trước đó khi quỹ trái phiếu bị thiếu data ngày lễ',
    ],
  },
  {
    version: 'v2.3',
    date: '02/04/2026',
    items: [
      'Thêm tab LS vs DCA: so sánh chiến lược đầu tư một lần (Lump Sum) và rải vốn định kỳ (DCA) qua phân tích rolling kịch bản lịch sử',
      'Heatmap xác suất chiến thắng: ma trận 4×4 thời gian nắm giữ × thời gian DCA, hiển thị số kịch bản (n=) trên từng ô',
      'Biểu đồ phân bố chênh lệch LS−DCA và 5 kịch bản percentile (rất xấu → rất tốt)',
      'Thêm chỉ số Profit Factor vào tab DCA: tổng lợi nhuận các tuần tăng ÷ tổng lỗ các tuần giảm',
      'Sửa một số lỗi nhỏ trong tính toán LS vs DCA, tăng độ ổn định khi số lượng kịch bản lớn',
    ],
  },
  {
    version: 'v2.2',
    date: '01/04/2026',
    items: [
      'Thêm 24 quỹ mới: 19 quỹ trái phiếu và 5 quỹ cân bằng từ fmarket.vn',
      'Nâng tổng số quỹ từ 30 → 54 (27 cổ phiếu + 19 trái phiếu + 5 cân bằng + 3 ETF)',
      'Cập nhật tên đầy đủ tiếng Việt cho toàn bộ 51 quỹ mở theo dữ liệu chính thức từ fmarket.vn',
      'Sửa lỗi biểu đồ lợi nhuận tích lũy và drawdown không hiển thị điểm bắt đầu 0% tại ngày đầu tư',
    ],
  },
  {
    version: 'v2.1',
    date: '03/2026',
    items: [
      'Tab DCA: tự động đặt tên danh mục theo mã quỹ khi chỉ chọn 1 quỹ',
      'Sửa lỗi căn chỉnh ngày (date alignment) khi so sánh nhiều danh mục trong DCA',
    ],
  },
  {
    version: 'v2.0',
    date: '03/2026',
    items: [
      'Thêm tab Tích Lũy Định Kỳ (DCA): mô phỏng đầu tư định kỳ với nhiều danh mục, rebalance tự động, biểu đồ giá trị danh mục và chỉ số MWRR',
    ],
  },
  {
    version: 'v1.2',
    date: '03/2026',
    items: [
      'Thêm CSS responsive cho màn hình tablet và điện thoại',
    ],
  },
  {
    version: 'v1.1',
    date: '03/2026',
    items: [
      'Thêm GitHub Actions: tự động cập nhật NAV hàng ngày lúc 18:00 (giờ VN), thứ 2–6',
    ],
  },
  {
    version: 'v1.0',
    date: '03/2026',
    items: [
      'Ra mắt dashboard: So sánh quỹ, Mô Phỏng danh mục, biểu đồ CAGR/Drawdown/Rolling Returns',
    ],
  },
]

export function ChangelogPanel() {
  return (
    <div className="changelog-panel">
      <h2>Changelog</h2>
      <div className="changelog-list">
        {ENTRIES.map(entry => (
          <div key={entry.version} className="changelog-entry">
            <div className="changelog-header">
              <span className="changelog-version">{entry.version}</span>
              <span className="changelog-date">{entry.date}</span>
            </div>
            <ul className="changelog-items">
              {entry.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
