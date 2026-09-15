# Verification V1.18 Modular

## Đã kiểm tra tự động

- `node tools/check-source.mjs` — import tương đối, vòng import, giới hạn file, feature contracts.
- `node --check` cho toàn bộ JavaScript runtime.
- `node tools/smoke-bootstrap.mjs` — bootstrap ứng dụng với môi trường giả nhẹ.
- `node tools/smoke-v118.mjs` — cấu hình 3 loại bài, Part, deterministic choice shuffle, Part 2 = 3 lựa chọn, student/staff Listening wiring và migration.
- `node tools/smoke-audio-sync.mjs` — mô phỏng trạng thái audio đã phát xong khi offline và xác nhận đồng bộ completion đúng unit khi có mạng.
- `node tools/check-migration.mjs` — kiểm tra tĩnh delimiter/function/parenthesis và các RPC/marker bắt buộc của migration V1.18.

## Hợp đồng V1.17 giữ nguyên

- Reading Part 5–7.
- Queue local chống race và đồng bộ `save_answer_v2`.
- Storage-safe fallback.
- Media lazy hydration/prefetch.
- Anti-cheat V1.16: route leave, hidden/blur, 15 giây, lần 3 tự nộp.
- Staff preview/practice, LIVE, submissions, reset/delete attempt, Excel export.
- Auth/recovery, accounts, classes, authoring draft/rich editor.

## Hợp đồng mới V1.18

- `tests.test_kind`: listening / reading / full.
- `test_parts.shuffle_choices`.
- Audio one-play được ghi server qua `attempt_audio_states`.
- Full Test lưu `listening_completed_at` trước khi sang Reading.
- Part 1–2 không hiển thị nội dung choice trên màn hình Listening.
- Part 3–4 trộn thứ tự nhưng nhãn hiển thị A–D và backend vẫn chấm key gốc.
- Preflight yêu cầu mọi câu Listening có audio trực tiếp hoặc qua stimulus group.
- Staff practice Listening có audio state riêng và Full Test chuyển tiếp sang Reading trong cùng lượt.
- Review/result nhận `shuffle_choices` từ backend để tái tạo đúng nhãn A–D mà người làm đã thấy.
- Audio phát xong khi mất mạng được giữ `pending_sync`, không được coi là server-complete cho đến khi đồng bộ thành công.

## Chưa thể xác nhận chỉ bằng source test

Cần staging Supabase thật để kiểm tra end-to-end: upload audio, phát/gián đoạn/resume, chuyển Listening → Reading, refresh giữa Full Test, timeout, anti-cheat trong khi audio đang phát, và kết quả sau nộp.
