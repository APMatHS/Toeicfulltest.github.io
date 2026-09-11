# TOEIC Full Test — V1.5

Bản V1.5 tập trung vào **thi thật**, trải nghiệm ít chớp/tải lại và luồng tạo bài kiểm tra lâu dài.

## 1. Chuyển trang gần như “đóng băng”

- Tổng quan / Tài khoản / Lớp / Bài kiểm tra / Hồ sơ được giữ sống trong DOM.
- Khi chuyển trang rồi quay lại:
  - không dựng lại trang nếu không cần;
  - giữ vị trí scroll;
  - giữ trạng thái giao diện đang mở;
  - dữ liệu nền được prefetch sau đăng nhập để lần mở đầu nhanh hơn.
- Bên trong một bài kiểm tra, các tab Tổng quan / LIVE / Bài làm / Soạn đề / Cài đặt vẫn giữ nguyên trạng thái như V1.3–V1.4.

## 2. Bốn cách tạo bài kiểm tra

Nút **Tạo bài kiểm tra** mở 4 tab:

1. **Tạo thủ công** — đang hoạt động.
2. **Nhập từ file** — frontend sẵn sàng cho PDF/DOCX/XLSX, AI chưa nối.
3. **Từ bài kiểm tra cũ** — hoạt động; nhân bản Part, stimulus, media, câu hỏi và đáp án nhưng không sao chép lượt làm/kết quả.
4. **Tạo đề bằng AI** — frontend placeholder để nối AI sau; AI chỉ tạo Draft.

## 3. Chỉnh sửa và quản trị bài kiểm tra

- Có nút **Chỉnh sửa bài kiểm tra**.
- Có thể chỉnh tên, mô tả, lớp, thời lượng, số lần làm, lịch mở/đóng, chống gian lận, số vi phạm cho phép, xem đáp án sau nộp.
- Sau khi sinh viên đầu tiên bắt đầu:
  - nội dung đề bị khóa server-side;
  - không đổi lớp;
  - không đổi thời lượng;
  - số lượt làm chỉ có thể tăng.
- Có **Lưu trữ bài kiểm tra** và **Xóa bài kiểm tra**.
- Không cho xóa bài kiểm tra nếu đang có sinh viên làm.
- Nếu đã có lượt làm, xóa vĩnh viễn yêu cầu nhập lại tên bài.

## 4. Preflight trước khi Publish

Trước khi Publish, hệ thống kiểm tra:

- đã gán lớp;
- có câu hỏi;
- mỗi câu đủ 4 lựa chọn;
- đáp án đúng hợp lệ;
- lịch mở/đóng hợp lệ;
- thống kê Part 5 / Part 6 / Part 7;
- media demo còn nằm ở GitHub hay chưa.

**Không cho Publish nếu media của TEST 1 / TEST 2 vẫn là đường dẫn GitHub.**

## 5. Chuyển ảnh TEST 1 / TEST 2 vào Supabase Storage

V1.5 vẫn kèm 56 ảnh demo chỉ để làm **nguồn chuyển một lần**.

Vào từng bài:

**Cài đặt → Chuyển media vào Supabase Storage**

Web sẽ:

1. đọc ảnh tĩnh hiện có;
2. upload sang bucket private `test-media`;
3. đổi `storage_path` trong Supabase;
4. sau đó preflight không còn báo media tĩnh.

Sau khi đã chuyển **cả TEST 1 và TEST 2**, nên dùng gói “clean” không chứa thư mục `assets/tests` để ảnh đề không còn tồn tại công khai trên GitHub.

## 6. Bài làm sinh viên

- Hỗ trợ nhiều lượt làm thật sự (`attempt_no`).
- Reset lượt giữ lịch sử cũ nhưng không tính vào số lượt đã dùng.
- Bài làm có:
  - Xem;
  - Reset lượt;
  - Xóa bài làm.
- Reset/Xóa ghi audit log.
- Excel có cột **Lần làm** và vẫn giữ các lượt đã reset để đối soát.

## 7. Bảo vệ đề và kết quả

- Khi lượt làm đầu tiên bắt đầu, `content_locked_at` được đặt.
- Các RPC soạn Part / stimulus / câu hỏi đều từ chối chỉnh nội dung sau khi khóa.
- Deadline vẫn do server quyết định.
- Autosave/offline queue/client event UUID của bài sinh viên vẫn giữ nguyên.
- Chống gian lận hiển thị theo cấu hình thật của từng bài, không hard-code “1 lần cảnh báo”.

## Deploy

Upload toàn bộ nội dung ZIP vào root branch `main` của GitHub Pages.

Bản V1.5 đã thêm cache-busting `?v=1.5` cho JS/CSS. Sau deploy vẫn nên Ctrl+F5 một lần.
