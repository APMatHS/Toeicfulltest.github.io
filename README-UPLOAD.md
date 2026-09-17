TOEIC - nâng cấp "Nhập từ file" (2026-09-17)

Chép lên GitHub đúng các đường dẫn:
- index.html
- assets/modules/import-file.js   (file mới)
- supabase/migrations/20260917_allow_incomplete_imported_questions.sql

Supabase production đã áp dụng migration allow_incomplete_imported_questions.
Không cần chạy SQL lại nếu đang dùng project ul... hiện tại.

Luồng mới:
1. Soạn đề -> Nhập từ file.
2. Chọn Word .docx (chỉ chữ) + Excel đáp án.
3. Web nhận PART, số câu, nội dung và A/B/C/D; ghép đáp án theo số câu.
4. Xem trước số câu OK / cần kiểm tra / đã có.
5. Lưu tất cả câu nhận diện được; câu chưa đủ vẫn lưu và UI hiện "Cần kiểm tra".
6. Câu đã tồn tại không bị ghi đè.
7. Không nhập ảnh/audio. Giảng viên bổ sung sau.

Đã kiểm tra file mẫu TOEIC Test 6: parser theo cấu trúc nhận đủ 100 câu,
Part 1=6, Part 2=25, Part 3=39, Part 4=30. Excel mẫu có 100 đáp án.
