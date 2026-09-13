# TOEIC Full Test — V1.10

Ứng dụng thi TOEIC dùng Supabase cho tài khoản, đề thi, lượt làm, đáp án và media.

## Chống gian lận V1.10

- Mỗi lần sinh viên rời màn hình được tính **ngay 1 vi phạm**.
- Lần 1 và 2: hiện cảnh báo che toàn trang và đếm ngược 15 giây.
- Quay lại trước 15 giây: tiếp tục làm, nhưng vi phạm vẫn được giữ.
- Rời quá 15 giây: tự động nộp bài.
- Rời màn hình lần thứ 3: tự động nộp ngay, không chờ 15 giây.
- Desktop: `window_blur` và `tab_hidden` được gộp thành một phiên để không tính trùng.
- Mobile: chỉ `visibilitychange -> hidden` được dùng để tính vi phạm, tránh tính oan do mất focus.
- Thoát fullscreen riêng lẻ không tự cộng thêm vi phạm.
- Có cảnh báo toàn màn hình và âm báo khi trình duyệt cho phép.

## Lưu đáp án

- Khi chọn A/B/C/D, đáp án được ghi vào hàng đợi `localStorage` **trước khi** đồng bộ Supabase.
- Nếu đổi tab, thoát fullscreen, mất mạng, refresh hoặc quay lại bài thi, đáp án chưa đồng bộ được phục hồi từ hàng đợi cục bộ.
- Khi có mạng, hàng đợi tự đồng bộ qua `save_answer_v2`.
- Trạng thái “Đánh dấu xem lại” cũng được lưu kể cả khi câu chưa chọn đáp án.

## Xem lại sau khi nộp

- Sau khi nộp, sinh viên xem lại toàn bộ câu hỏi, passage, ảnh, bảng và phương án mình đã chọn ngay trên trang kết quả.
- Nếu giảng viên bật **Cho xem đáp án**, trang kết quả hiển thị đáp án đúng và đúng/sai từng câu.
- Nếu tắt, sinh viên vẫn xem được bài đã làm nhưng không nhận được đáp án đúng hoặc trạng thái đúng/sai từng câu.
- Bài tự nộp do chống gian lận/hết giờ vẫn có thể xem lại theo cùng quy tắc.

## Trộn câu

- Part 5: trộn từng câu.
- Part 6: trộn theo nguyên nhóm bài đọc.
- Part 7: giữ cố định.

## Media

Ảnh/audio nằm trong bucket private `test-media`. Signed URL dùng thời hạn 6 giờ để tránh hết hạn giữa bài thi dài.

## Triển khai

1. Upload toàn bộ mã nguồn V1.10 lên GitHub Pages.
2. Sau khi frontend V1.10 đã lên, chạy `supabase/v1.10_exam_integrity_and_review.sql` trong Supabase SQL Editor.
3. Migration V1.10 tự chứa phần lưu đáp án cần thiết, nên có thể nâng trực tiếp từ V1.8 hoặc V1.9; không bắt buộc chạy SQL V1.9 trước.
4. Không cần Python hay script ghép mã nào.
