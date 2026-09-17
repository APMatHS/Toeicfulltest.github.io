# TOEIC – sửa đúng luồng Tạo bài kiểm tra → Nhập từ file

Thay đúng 2 file:
- assets/tests/test-create.js
- assets/modules/import-file.js

Không cần sửa index.html. Importer cũ gắn ở màn hình Soạn đề đã được loại khỏi module import-file.js.

Luồng mới:
1. Chọn file đề .docx
2. Chọn file đáp án .xlsx/.xls
3. Đọc file và xem trước
4. Tự nhận diện Listening / Reading / Full Test từ Part
5. Tạo bài nháp và Part
6. Lưu mọi câu nhận diện được; câu thiếu dữ liệu vẫn lưu nếu backend cho phép đáp án NULL
7. Mở màn hình Soạn đề để giảng viên chỉnh tiếp

Không đụng Tạo thủ công, Từ bài kiểm tra cũ, audio, anti-cheat, submissions.

Lưu ý: Supabase production trước đó đã được nới questions.correct_choice_key cho phép NULL.
\nFix 2: tương thích đúng ESM export của Mammoth/XLSX; sửa lỗi `Cannot read properties of undefined (reading 'split')` khi đọc file.\n