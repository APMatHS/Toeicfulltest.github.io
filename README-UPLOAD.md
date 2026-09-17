# TOEIC update — 2026-09-17

Chép đè đúng các đường dẫn sau vào repo `Toeicfulltest/Toeicfulltest.github.io`:

1. `assets/modules/media.js`
   - Nâng giới hạn audio từ 45 MiB lên 50 MiB.
   - Giữ nguyên resumable upload (TUS) cho file > 6 MiB.

2. `assets/modules/authoring-view.js`
   - Thêm nút `+ Thêm sau` tại mỗi câu hỏi.
   - Nút mở đúng form thêm câu của Part hiện tại, không tạo luồng JS vá/version riêng.
   - Nếu câu đang thuộc nhóm, form mới tự chọn lại nhóm đó.
   - Số câu vẫn dùng logic hiện hữu của `authoring.js` (tự lấy số kế tiếp lớn nhất), tránh trùng số khi bấm ở một câu giữa Part.

3. `assets/styles/exam.css`
   - Nội dung câu hỏi đậm hơn và cỡ chữ 1.1rem.
   - Lựa chọn giữ 1rem / weight 500.
   - Áp dụng chung cho giao diện thi và làm thử vì dùng cùng markup.

4. `supabase/migrations/20260917_increase_test_media_limit_50mb.sql`
   - Lưu migration đồng bộ cấu hình Storage vào Git.
   - Migration này đã được áp dụng trên Supabase production: bucket `test-media` hiện có `file_size_limit = 52428800`.

Không cần thêm file JS kiểu `v1.xx.js` và không cần sửa `index.html`.
