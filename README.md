# TOEIC Full Test

Ứng dụng GitHub Pages + Supabase cho bài kiểm tra TOEIC Reading.

## V1 hiện có
- Supabase Auth với 3 vai trò: `system_admin`, `teacher`, `student`.
- Giáo viên tạo Student/Teacher qua Edge Function `manage-user`.
- Quản lý lớp và bài kiểm tra.
- Tạo bài mặc định 75 phút, 1 lượt, hiện đáp án sau khi nộp.
- Part 5: `shuffle_questions`; Part 6: `shuffle_stimulus_groups`; Part 7: `fixed`.
- Đồng hồ dựa trên `expires_at` phía server.
- Lưu đáp án qua RPC.
- Chống gian lận: lần 1 cảnh báo, lần 2 tự nộp.
- Kết quả hiển thị ngay sau khi nộp.

## Supabase
Project ref: `ulnjhgrwqsxoidkzumwc`

Storage: private bucket `test-media`.

## Khởi tạo tài khoản đầu tiên
Project đang dùng cơ chế bootstrap: Auth user đầu tiên sẽ trở thành `system_admin`.
Tạo user đầu tiên trong Supabase Dashboard > Authentication > Users, sau đó đăng nhập trên web.

## GitHub Pages
Repo dự kiến: `Toeicfulltest/Toeicfulltest.github.io`.

Các file cần đặt ở root:
- `index.html`
- `assets/config.js`
- `assets/styles.css`
- `assets/app.js`

Publishable key trong `config.js` là khóa công khai dành cho frontend; không dùng service-role key trong GitHub Pages.
