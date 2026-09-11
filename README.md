# TOEIC Full Test — V1.1

Bản V1.1 cho GitHub Pages, dùng Supabase project hiện tại.

## Điểm mới
- Sửa luồng Auth/render để tránh màn hình trắng sau đăng nhập.
- Tạo tài khoản từng người, có gán lớp.
- Nhập danh sách sinh viên từ Excel/CSV với 4 cột: `Họ tên`, `MSSV`, `Email`, `Password`.
- Password chỉ dùng để tạo Supabase Auth, không lưu plaintext trong bảng `profiles`.
- Soạn đề trực tiếp:
  - nhóm nội dung dùng chung cho nhiều câu;
  - stimulus dạng text / ảnh / audio;
  - câu hỏi có thể gắn ảnh hoặc audio;
  - từng đáp án A/B/C/D có thể gắn ảnh hoặc audio.
- Kiến trúc sẵn sàng cho Listening: một audio có thể nằm ở Stimulus Group và dùng chung nhiều câu.
- Student exam render được ảnh/audio ở stimulus, câu hỏi và đáp án.
- Anti-cheat có `tab_hidden`, `window_blur`, `fullscreen_exit`, có chống đếm trùng cơ bản.

## Upload danh sách sinh viên
Dùng file `.xlsx`, `.xls` hoặc `.csv`.

Các tên cột được nhận:
- Họ tên: `Họ tên`, `HoTen`, `name`, `full_name`
- MSSV: `MSSV`, `Mã SV`, `student_code`
- Email: `Email`
- Password: `Password`, `Mật khẩu`

Password tối thiểu 6 ký tự.

## Media
Storage bucket: `test-media`.

V1.1 dùng:
- `image/png`
- `image/jpeg`
- `image/webp`
- `audio/mpeg`
- `audio/mp4`
- `audio/wav`

## Supabase
Backend đã được cập nhật cho V1.1:
- `manage-user` V3 hỗ trợ `bulk_create_students`;
- questions/choices có `media_type`, `storage_path`;
- stimulus groups có cấu hình Listening cơ bản;
- RPC authoring/payload đã trả media cho câu hỏi và đáp án.

## Deploy GitHub Pages
Upload toàn bộ nội dung ZIP vào root branch `main`, giữ nguyên cấu trúc:
- `index.html`
- `README.md`
- `assets/app.js`
- `assets/config.js`
- `assets/styles.css`

Sau đó reload trang bằng Ctrl+F5 nếu browser còn cache bản cũ.
