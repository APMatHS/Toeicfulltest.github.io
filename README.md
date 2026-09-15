# TOEIC Full Test — V1.17


## V1.17 — Student Stability

- Chống lỗi `localStorage` làm dừng giao diện/nộp bài; có fallback in-memory.
- Compact queue đáp án và chống race khi request lưu trước còn đang chạy.
- Khi mở bài chỉ hydrate media của câu hiện tại; prefetch câu kế tiếp lúc browser rảnh.
- Ảnh upload mới được resize/nén WebP khi cần; ảnh render dùng lazy/async decode.
- SheetJS/XLSX chỉ tải khi giảng viên xuất Excel; review UI chỉ tải ở trang kết quả.
- Giữ nguyên toàn bộ quy tắc chống gian lận V1.16.
- **Không cần migration Supabase mới.**

Chi tiết: `docs/releases/V1.17.md`.


## V1.16 — chỉ tính vi phạm khi rời phần kiểm tra

- Thoát fullscreen nhưng vẫn ở trang thi: **không tính vi phạm**.
- Back/bấm liên kết/đổi route ra khỏi `#/exam/...`: giữ lại trong bài và tính **1 vi phạm**.
- Desktop vẫn bắt chuyển tab/cửa sổ; mobile chỉ bắt trạng thái trang bị ẩn để hạn chế báo nhầm.
- Nộp bài, hết giờ và tự nộp được đánh dấu là điều hướng hợp lệ, không bị cộng thêm vi phạm.
- Không cần migration Supabase mới.

Chi tiết: `docs/releases/V1.16.md`.

## V1.14 — Authoring workspace & grading UX


- Trang Soạn đề hiển thị đầy đủ passage/media, câu hỏi và bốn phương án; có cột số câu sticky để nhảy nhanh.
- Nhóm Part 6/7 có nền và header rõ hơn; câu thiếu dữ liệu được đánh dấu cần kiểm tra.
- Rich editor bật spellcheck tiếng Anh của trình duyệt; nút `AI kiểm tra — Bản sau` chưa gọi API.
- Danh sách bài kiểm tra hiển thị `Lượt đã làm` thật, tách khỏi `Giới hạn/SV`.
- Điểm hiển thị thống nhất theo thang 10 trên kết quả, LIVE, bảng bài làm và Excel.
- CSS tách theo chức năng trong `assets/styles/`; các helper JS mới nằm trong `assets/modules/`.

Chi tiết lịch sử: `docs/releases/V1.14.md`.

## Nền V1.12 — Exam Readiness
V1.12 đồng bộ lớp học/tài khoản/thi thật/xuất điểm trước ngày kiểm tra:

- `class_members` là nguồn gán lớp chính; `profiles.class_id` chỉ là trường mirror tương thích giao diện. Mỗi sinh viên chỉ thuộc tối đa 1 lớp.
- Gán/chuyển/bỏ sinh viên khỏi lớp dùng RPC `staff_set_student_class` và cập nhật đồng bộ.
- LIVE tách `Sĩ số` với `Lượt thi`; tab Bài làm chỉ liệt kê attempt thật.
- Excel `Tong_hop` không chứa lượt `reset`; thêm `Danh_sach_lop` và `Lich_su_reset` để đối soát.
- Sinh viên bị khóa không thể bắt đầu lượt thi mới. Xóa tài khoản chỉ cho phép khi chưa có lịch sử; nếu đã có lịch sử thì khóa thay vì xóa.
- Upload Excel/CSV dùng Edge Function `student-admin`: sinh viên đã tồn tại được gán/chuyển lớp; user mới được cleanup nếu tạo dở.
- Preflight chặn publish nếu lớp chưa có sinh viên hoạt động.
- Mặc định mới là không lộ đáp án sau nộp; hai đề thật ngày 15/09/2026 đã đặt `show_answers_after_submit=false`.
- Dọn khóa đề mồ côi khi test không còn attempt nào.

### Triển khai V1.12

1. Chạy lần lượt `supabase/migrations/v1.12a_class_architecture.sql`, `v1.12b_results_export.sql`, `v1.12c_exam_guards.sql`, `v1.12d_security_cleanup.sql`.
2. Deploy `supabase/functions/student-admin/index.ts` với Verify JWT ON.
3. Upload toàn bộ frontend V1.12 lên GitHub Pages.
4. Trước khi Publish đề thật, kiểm tra roster, giờ mở/đóng, và giữ `Cho xem đáp án = Không`.

Ứng dụng thi TOEIC dùng Supabase Auth/PostgreSQL/Storage và GitHub Pages.

## V1.11 — quản lý mật khẩu theo vai trò

### Giảng viên / System Admin

- Có **Quên mật khẩu** ngay tại trang đăng nhập.
- Nhập email → backend kiểm tra vai trò → Supabase gửi link recovery chỉ cho `teacher`/`system_admin` đang hoạt động.
- Link recovery mở trang đặt mật khẩu mới trên chính web TOEIC.
- Phản hồi công khai không tiết lộ email nào tồn tại trong hệ thống.

### Sinh viên

- Không tự recovery bằng email; giao diện yêu cầu liên hệ giảng viên.
- Giảng viên/System Admin có **Sinh lại mật khẩu** trong:
  - `Tài khoản`;
  - `Lớp → Thành viên lớp`.
- Chỉ tài khoản `student` mới được reset bằng chức năng này.
- Mật khẩu tạm dài 12 ký tự, chỉ hiển thị một lần và không ghi vào log.
- Sinh viên buộc đổi mật khẩu tạm trước khi tiếp tục vào bài kiểm tra.

## V1.10 vẫn được giữ nguyên

- Rời màn hình tính ngay 1 vi phạm.
- Lần 1–2 có cảnh báo và đếm ngược 15 giây; quá 15 giây tự nộp.
- Lần rời thứ 3 tự nộp ngay.
- Mobile chỉ dùng `visibilitychange -> hidden`; desktop gộp `blur + hidden` để tránh tính trùng.
- Đáp án được lưu local trước rồi đồng bộ Supabase, không mất khi đổi tab/fullscreen/mất mạng.
- Sau khi nộp, sinh viên xem lại toàn bộ câu và lựa chọn; đáp án đúng chỉ hiện nếu giảng viên cho phép.
- Xóa lượt làm cuối cùng sẽ tự mở khóa nội dung đề; Reset lượt vẫn giữ khóa.

## Cấu trúc quan trọng

- `assets/app.js` — giao diện, auth, thi, quản trị.
- `assets/modules/anti-cheat.js` — chống gian lận V1.10.
- `supabase/migrations/v1.10_exam_integrity_and_review.sql` — backend thi V1.10.
- `supabase/migrations/v1.11_password_recovery.sql` — schema/trigger mật khẩu V1.11.
- `supabase/functions/manage-user/index.ts` — tạo user + sinh lại mật khẩu sinh viên.
- `supabase/functions/request-password-reset/index.ts` — gửi recovery email cho staff.
- `archive/legacy-builds/` — các bản source trước.

## Triển khai V1.11

1. Nếu chưa có backend V1.10, chạy `supabase/migrations/v1.10_exam_integrity_and_review.sql` trước.
2. Chạy `supabase/migrations/v1.11_password_recovery.sql`.
3. Deploy `manage-user` với **Verify JWT = ON**.
4. Deploy `request-password-reset` với **Verify JWT = OFF**.
5. Supabase Auth → URL Configuration: thêm URL GitHub Pages vào Redirect URLs. Mặc định dự án này dùng `https://toeicfulltest.github.io/`.
6. Upload toàn bộ frontend V1.11 lên GitHub Pages.

> Lưu ý email: Supabase password recovery cần dịch vụ gửi email. Với triển khai thật, nên cấu hình SMTP riêng thay vì phụ thuộc email thử nghiệm mặc định.


## Cấu trúc mã từ V1.14

CSS được tổ chức tại `assets/styles/` theo nhóm chức năng; JavaScript dùng các module trong `assets/modules/`. Ghi chú phiên bản nằm trong `docs/releases/`.
