# TOEIC Full Test — V1.9

Ứng dụng thi TOEIC dùng Supabase cho tài khoản, đề thi, lượt làm, đáp án và media.

## Cấu trúc JavaScript

- `assets/app.js`: điều phối màn hình, route và luồng nghiệp vụ.
- `assets/modules/anti-cheat.js`: theo dõi phiên rời màn hình và chính sách 30 giây.
- `assets/modules/utils.js`: hàm dùng chung và trạng thái trình duyệt.
- `assets/modules/media.js`: tải media và tạo URL tạm từ Supabase Storage.
- `assets/modules/rich-editor.js`: trình soạn thảo, làm sạch HTML và ảnh nhúng.
- `assets/modules/authoring-view.js`: giao diện danh sách và tìm kiếm khi soạn đề.
- `assets/config.js`: cấu hình kết nối Supabase phía trình duyệt.

## Chống gian lận V1.9

- Rời tab/cửa sổ không quá 30 giây: không tính vi phạm.
- Rời trên 30 giây: tính 1 lần.
- Lần 1 và 2: cảnh báo.
- Lần 3: tự động nộp bài.
- Thoát fullscreen riêng lẻ không được tính thêm một vi phạm.

## Trộn câu

- Part 5: trộn từng câu.
- Part 6: trộn theo nguyên nhóm bài đọc.
- Part 7: giữ cố định.

## Media

Ảnh/audio nằm trong bucket private `test-media`. V1.9 dùng signed URL 6 giờ để không hết hạn giữa bài thi dài.

## Triển khai

1. Upload toàn bộ mã nguồn V1.9 lên GitHub Pages.
2. Sau khi frontend mới đã lên, chạy `supabase/v1.9_anti_cheat_and_stability.sql` trong Supabase SQL Editor.
3. Không cần chạy Python hay script ghép mã nào.
