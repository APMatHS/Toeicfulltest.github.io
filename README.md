# TOEIC Full Test

Ứng dụng thi TOEIC dùng Supabase cho tài khoản, đề thi, lượt làm, đáp án và media.

## Cấu trúc JavaScript

- `assets/app.js`: điều phối màn hình, route và luồng nghiệp vụ.
- `assets/modules/utils.js`: hàm dùng chung và trạng thái trình duyệt.
- `assets/modules/media.js`: tải media và tạo URL tạm từ Supabase Storage.
- `assets/modules/rich-editor.js`: trình soạn thảo, làm sạch HTML và ảnh nhúng.
- `assets/modules/authoring-view.js`: giao diện danh sách và tìm kiếm khi soạn đề.
- `assets/config.js`: cấu hình kết nối Supabase phía trình duyệt.

## Soạn nội dung

Giảng viên có thể dùng chữ đậm, nghiêng, gạch chân, danh sách, liên kết, bảng và
ảnh đặt trong nội dung. Ảnh được tải vào bucket private `test-media`; dữ liệu chỉ
lưu đường dẫn Storage, còn URL tạm được tạo khi mở đề.

Nội dung cũ dạng văn bản thuần vẫn được hỗ trợ. HTML được giới hạn bằng danh sách
thẻ an toàn trước khi lưu và trước khi hiển thị.

## Trộn câu

- Part 5: trộn từng câu.
- Part 6: trộn theo nguyên nhóm bài đọc.
- Part 7: giữ cố định.

## Chạy web

Đây là web tĩnh dùng ES modules, cần mở qua HTTP hoặc GitHub Pages; không mở trực
tiếp `index.html` bằng giao thức `file://`.
