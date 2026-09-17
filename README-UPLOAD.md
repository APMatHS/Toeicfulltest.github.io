TOEIC - sửa upload audio lớn
Ngày: 2026-09-17

Chép đè đúng 2 file:
1. assets/modules/media.js
2. assets/tests/listening-audio-settings.js

Thay đổi:
- TUS dùng direct Storage hostname: <project>.storage.supabase.co
- Giữ chunk 6 MB theo Supabase.
- Tìm và resume upload trước đó trước khi start.
- uploadDataDuringCreation=true.
- Hiện retry / chờ Supabase thay vì đứng im.
- Hiện tốc độ MB/s và ETA.
- Báo HTTP/body khi TUS trả lỗi.
- Giới hạn audio vẫn là 50 MB.

Không tạo JS phiên bản v1.xx.
Không cần migration Supabase mới cho thay đổi này; bucket test-media đã được nâng lên 50 MB trước đó.
