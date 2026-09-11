# TOEIC Full Test — V1.3

Bản này dùng Supabase hiện tại và được thiết kế cho nhập đề TOEIC từ PDF nhanh, an toàn khi thi thật.

## Mới trong V1.3

- Giảng viên/System Admin có trang Hồ sơ:
  - tự đổi mật khẩu;
  - giảng viên được đổi họ tên.
- Soạn đề có autosave nháp 2 lớp:
  - lưu ngay trên trình duyệt;
  - tự đồng bộ nháp lên Supabase.
- Nhớ tab Soạn đề và vị trí cuộn khi quay lại.
- Khi đóng form đang nhập, có thể khôi phục bản nháp.
- Paste ảnh trực tiếp bằng `Ctrl+V` từ PDF/Snipping Tool tại:
  - stimulus/nội dung chung;
  - media của câu hỏi;
  - media từng đáp án A/B/C/D.
- Ảnh/audio được upload ngay khi chọn/paste để bản nháp không mất media.
- Trang bài kiểm tra có 5 tab:
  - Tổng quan
  - LIVE
  - Bài làm
  - Soạn đề
  - Cài đặt
- LIVE dùng Supabase Realtime:
  - tổng số sinh viên;
  - đang làm;
  - đã nộp;
  - chưa vào;
  - có vi phạm;
  - số câu đã trả lời;
  - thời gian bắt đầu/còn lại;
  - điểm khi đã nộp.
- Có lọc LIVE nhanh và tải Excel.
- Excel kết quả có 3 sheet:
  - `Tong_hop`
  - `Chi_tiet`
  - `Vi_pham`
- Bài làm sinh viên có bảo vệ dữ liệu:
  - lưu đáp án ngay lập tức;
  - queue cục bộ khi mạng chập chờn;
  - tự đồng bộ khi có mạng lại;
  - client event UUID chống gửi trùng;
  - nhớ câu đang làm sau reload;
  - deadline vẫn do server quyết định.
- Chống gian lận dùng event UUID để giảm nguy cơ đếm trùng.


### Giao diện “đóng băng” giữa các tab của bài kiểm tra

- `Tổng quan / LIVE / Bài làm / Soạn đề / Cài đặt` được giữ sống trong cùng một workspace.
- Chuyển tab chỉ ẩn/hiện panel, **không hủy DOM và không gọi tải lại toàn trang**.
- Quay lại tab trước giữ nguyên gần như tuyệt đối:
  - vị trí cuộn;
  - form đang nhập;
  - vùng đang mở;
  - bộ lọc LIVE;
  - nội dung đã render.
- LIVE chỉ tải lần đầu, sau đó tiếp tục nhận Realtime ngầm kể cả khi đang xem tab khác.
- Bài làm chỉ tải lần đầu trong phiên workspace; quay lại không hiện “Đang tải…” nữa.
- URL vẫn thay đổi theo tab và nút Back/Forward vẫn hoạt động.
- Chỉ dựng lại workspace khi có thay đổi dữ liệu thật sự như thêm/sửa câu, thêm stimulus, xuất bản/đóng bài, F5 hoặc đổi sang bài kiểm tra khác.

## Import sinh viên

Excel/CSV:
- `Họ tên`
- `MSSV`
- `Email`
- `Password`

Password chỉ gửi tới Supabase Auth, không lưu plaintext trong bảng `profiles`.

## Deploy GitHub Pages

Giải nén ZIP rồi upload đè toàn bộ vào root branch `main`:
- `index.html`
- `README.md`
- `assets/app.js`
- `assets/config.js`
- `assets/styles.css`

Sau khi Pages deploy xong, dùng `Ctrl+F5` để tránh cache JS/CSS cũ.
