# Deploy V1.18 Modular

V1.18 frontend cần backend V1.17 hiện có và migration Listening/Full Test mới.

## Thứ tự an toàn

1. Sao lưu Supabase trước khi nâng cấp.
2. Trên staging/test project, chạy `supabase/migrations/v1.18_listening_full_test.sql` sau toàn bộ migration V1.17/V1.8 staff-practice đã có.
3. Kiểm tra RPC mới tồn tại: mode attempt, audio student, audio staff-practice, complete Listening và preflight.
4. Deploy `index.html` + toàn bộ `assets/` cùng một lần để tránh trộn build cũ/mới.
5. Hard refresh trình duyệt.
6. Tạo một Reading cũ và xác nhận vẫn làm/nộp/xem lại bình thường.
7. Tạo Listening ngắn: thử audio một lần, refresh giữa audio, mất mạng rồi có mạng lại, nộp bài.
8. Tạo Full Test ngắn: hoàn thành Listening, chuyển Reading, refresh ở Reading và xác nhận không quay lại Listening.
9. Làm thử bằng tài khoản giảng viên cả Listening và Full Test; kiểm tra lịch sử làm thử riêng.
10. Chỉ sau khi staging đạt mới chạy migration/deploy trên project thật.

## Lưu ý

- Không cần và không nên copy các file trong `archive/` lên GitHub Pages.
- Không đổi `test_kind` sau khi sinh viên đã bắt đầu bài.
- Reading cũ mặc định `test_kind='reading'`, nên migration không đổi hành vi của các đề V1.17.
- Full Test dùng một deadline chung cho cả Listening và Reading.
- Frontend không cho chuyển sang Reading khi còn đáp án hoặc trạng thái audio chưa đồng bộ.
