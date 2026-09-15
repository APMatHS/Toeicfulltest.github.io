# Deploy V1.18 Modular — single Listening audio

V1.18 dùng nền V1.17 và **một file audio chung chạy liên tục cho Listening Part 1–4**.

## Thứ tự an toàn

1. Sao lưu Supabase trước khi nâng cấp.
2. Nếu chưa từng chạy V1.18: chạy `supabase/migrations/v1.18_listening_full_test.sql`.
3. Chạy tiếp `supabase/migrations/v1.18b_single_listening_audio.sql`. Nếu đã chạy V1.18 trước đó thì chỉ cần bước này.
4. Deploy `index.html` + toàn bộ `assets/` cùng một lần để tránh trộn build.
5. Hard refresh trình duyệt.
6. Tạo/mở một bài Listening hoặc Full Test → **Cài đặt → Audio Listening Part 1–4** → tải đúng 1 file MP3/M4A.
7. Kiểm tra Reading cũ Part 5–7 vẫn làm/nộp/xem lại bình thường.
8. Kiểm tra Listening ngắn: bấm Bắt đầu nghe một lần; audio phải chạy liên tục khi chuyển câu, không pause/tua/nghe lại.
9. Refresh giữa lúc nghe để kiểm tra tiếp tục gần vị trí đã lưu; thử mất mạng khi audio kết thúc và xác nhận completion đồng bộ khi có mạng lại.
10. Kiểm tra Full Test: nghe hết file chung → chuyển Reading; refresh ở Reading không quay lại Listening.
11. Làm thử bằng tài khoản giảng viên và kiểm tra lịch sử làm thử riêng.
12. Chỉ sau khi staging đạt mới áp dụng production.

## Lưu ý

- V1.18b không xóa dữ liệu V1.18 cũ; các trạng thái audio unit cũ chỉ không còn được dùng.
- Audio chung bị khóa cùng nội dung đề sau khi sinh viên đầu tiên bắt đầu.
- Clone bài giữ cùng đường dẫn audio. Vì vậy frontend không tự xóa file audio cũ khỏi Storage khi thay/gỡ để tránh làm hỏng bản clone; có thể dọn media không còn tham chiếu sau.
- Reading cũ mặc định `test_kind='reading'`, nên không bị yêu cầu audio.
- Full Test dùng một deadline chung cho Listening và Reading.
