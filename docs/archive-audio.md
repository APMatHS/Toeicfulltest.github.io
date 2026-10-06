# Archive.org audio pipeline

## Mục tiêu

Audio Listening Part 1–4 mới được lưu lâu dài trên Internet Archive. Supabase Storage chỉ làm vùng tạm khi giảng viên tải file lên.

## Secrets

Edge Function `archive-audio` đọc đúng hai Supabase Edge Function secrets:

- `ARCHIVE_ACCESS_KEY`
- `ARCHIVE_SECRET_KEY`

Không đưa hai giá trị này vào frontend, GitHub source, localStorage hay bảng database.

## Luồng upload

1. Trình duyệt tải audio vào bucket private `test-media` dưới `tests/<test_id>/archive-staging/`.
2. Frontend gọi Edge Function `archive-audio` bằng JWT của giảng viên.
3. Edge Function kiểm tra role Teacher/System Admin, quyền đọc test và `content_locked_at`.
4. Backend tải file staging bằng Supabase server key rồi PUT sang Internet Archive S3-like API.
5. Khi Internet Archive chấp nhận file, RPC `staff_set_listening_audio_v118b` lưu đường dẫn dạng:
   `archive:<identifier>/<filename>`.
6. File staging được xóa.
7. File cũ chỉ bị xóa khi không còn test nào khác tham chiếu tới đường dẫn đó.

## Tương thích ngược

`assets/modules/media.js` hỗ trợ đồng thời:

- đường dẫn Supabase Storage cũ;
- đường dẫn `archive:` mới.

Vì vậy các bài kiểm tra hiện có không cần migration. Khi một bài cũ được thay audio, audio mới sẽ chuyển sang Archive.org.

## Playback

`archive:<identifier>/<filename>` được phân giải thành:

`https://archive.org/download/<identifier>/<filename>`

Teacher preview và student Listening player tiếp tục gọi chung `signedUrl` / `signedUrlMap`, nên các module thi không cần biết provider phía sau.

## Xóa / thay audio

Mọi thao tác xóa hoặc thay audio đi qua Edge Function. Không dùng frontend để gọi Archive.org trực tiếp.

Nếu một file đang được nhiều test clone dùng chung, backend giữ file đó cho tới khi không còn test nào tham chiếu.

## Kiểm tra sau deploy

- Edge Function `archive-audio` phải ACTIVE và `verify_jwt=true`.
- Tải một MP3 thử từ Cài đặt của test Listening/Full.
- Sau khi hoàn tất, `tests.listening_audio_storage_path` phải bắt đầu bằng `archive:`.
- Teacher preview phải phát được.
- Mở lượt làm thử và xác nhận audio phát qua URL Archive.
- Kiểm tra object staging tương ứng đã được xóa khỏi `test-media`.
