# Refactor modular từ nền V1.17 FULL

## Mục tiêu

Refactor chỉ thay **cấu trúc mã nguồn**, không thay schema/RPC hay chính sách nghiệp vụ đang ổn định của V1.17/V1.16. Nền gốc được lấy từ file `TOEIC-Full-Test-V1.17-FULL`.

## Thay đổi chính

- `assets/app.js`: từ khoảng 1.666 dòng xuống khoảng 150 dòng; chỉ giữ bootstrap/router/session/context.
- `assets/app-exam.js`: từ khoảng 565 dòng xuống dưới 100 dòng; phần queue/media/results tách thành module riêng.
- Tách Auth, Dashboard, Tài khoản, Lớp, danh sách bài kiểm tra, workspace và authoring theo miền chức năng.
- Tạo `xlsx-service.js` dùng chung.
- Sửa lỗi V1.17: nhập sinh viên Excel/CSV từng gọi `XLSX.read(...)` nhưng `XLSX` không được import sau khi SheetJS chuyển sang lazy load.
- Review UI dùng storage helper chung thay vì truy cập `localStorage` trực tiếp.
- Không tạo JS mang tên phiên bản hay patch.

## Những tính năng được giữ bằng feature contract

- chống gian lận route/tab/cửa sổ và timeout 15 giây;
- `save_answer_v2` + queue offline/chống race;
- làm thử giảng viên và lưu lịch sử riêng;
- xem kết quả/xem lại bài;
- reset/xóa lượt làm;
- clone/preflight/publish bài;
- soạn câu hỏi/stimulus;
- password recovery và student admin;
- nhập/xuất Excel.

## Kết quả kiểm tra tĩnh

- Tất cả JS runtime pass `node --check`.
- Import tương đối được resolve đầy đủ.
- Không có vòng import giữa các module runtime.
- Không có JS runtime tên kiểu `v1.xx.js`.
- Không có truy cập `localStorage` trực tiếp ngoài `utils.js`.
- Mọi JS runtime đều dưới ngưỡng 320 dòng.

## Việc vẫn cần smoke-test trên trình duyệt/Supabase thật

Refactor tĩnh không thay thế được kiểm thử có session/backend. Trước khi đưa cho sinh viên thi thật cần chạy lần lượt:

1. đăng nhập student/teacher/admin;
2. tạo/import tài khoản SV từ XLSX và CSV;
3. tạo/sửa/publish một Reading test;
4. làm thử giảng viên;
5. sinh viên chọn nhanh nhiều đáp án, đổi lại đáp án trong lúc mạng chậm;
6. offline → trả lời → online → kiểm tra queue về `Đã lưu`;
7. đổi tab/Back/route và kiểm tra quy tắc chống gian lận;
8. nộp, hết giờ, xem lại bài;
9. reset/xóa lượt cuối và kiểm tra mở khóa đề;
10. LIVE và xuất Excel.
