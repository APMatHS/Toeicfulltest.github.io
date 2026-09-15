# Kiến trúc mã nguồn TOEIC Full Test

Mục tiêu của cấu trúc này là **sửa đúng module chức năng**, không tạo các file vá theo phiên bản như `v1.xx.js`, `fix-*.js` hay `patch-*.js`.

## Nguyên tắc

1. `assets/app.js` chỉ làm bootstrap, session, router và nối các controller.
2. Một module tương ứng với một cụm chức năng rõ ràng.
3. JavaScript chạy thật trong `assets/` không quá 320 dòng/file. Mục tiêu thông thường là 80–250 dòng.
4. Không truy cập `localStorage` trực tiếp ngoài `assets/modules/utils.js`; tất cả dùng helper storage-safe.
5. SheetJS/XLSX được tải động qua `assets/services/xlsx-service.js`, không tạo biến `XLSX` toàn cục.
6. Không đặt số phiên bản vào tên file JavaScript. Phiên bản chỉ xuất hiện trong `docs/releases/` và lịch sử Git.
7. `archive/` chỉ để đối chiếu lịch sử, tuyệt đối không được import vào ứng dụng.

## Cấu trúc runtime

```text
assets/
├─ app.js                         # bootstrap + router + session + shared context
├─ app-exam.js                    # facade cho luồng thi Reading V1.17
│
├─ auth/
│  └─ auth-pages.js               # home/login/recovery/profile
│
├─ exam/
│  ├─ answer-queue.js             # queue offline + chống race khi lưu đáp án
│  ├─ exam-media.js               # hydrate/prefetch media từng câu
│  ├─ exam-results.js             # kết quả + tái tạo đúng thứ tự lựa chọn đã thấy
│  ├─ practice-data.js            # dữ liệu làm thử dùng chung Reading/Listening
│  ├─ exam-coordinator.js         # chọn Reading / Listening / Full theo attempt
│  └─ listening/
│     ├─ listening-exam.js        # lifecycle lượt Listening sinh viên
│     ├─ listening-practice.js    # làm thử Listening/Full của giảng viên
│     ├─ audio-session.js         # one-play audio + resume + pending-sync
│     └─ listening-view.js        # render UI Listening dùng chung
│
├─ staff/
│  ├─ dashboard.js                # tổng quan giảng viên
│  ├─ accounts.js                 # tài khoản + nhập SV Excel/CSV
│  └─ classes.js                  # lớp + thành viên
│
├─ tests/
│  ├─ test-list.js                # danh sách bài kiểm tra
│  ├─ test-create.js              # tạo/clone bài; chọn Listening/Reading/Full
│  ├─ test-kind.js                # cấu hình Part và shuffle theo loại bài
│  ├─ test-workspace.js           # workspace, settings, preflight, publish
│  └─ authoring.js                # soạn đề + draft + editor actions
│
├─ services/
│  └─ xlsx-service.js             # dynamic import SheetJS dùng chung
│
├─ modules/
│  ├─ anti-cheat.js               # chính sách chống gian lận
│  ├─ authoring-view.js            # render/filter giao diện soạn đề
│  ├─ media.js                     # upload/nén ảnh + signed URL
│  ├─ rich-editor.js               # rich text editor
│  ├─ review-loader.js / review-ui.js
│  ├─ staff-results.js             # LIVE/bài làm/xuất Excel
│  ├─ staff-tests.js
│  ├─ score-utils.js
│  └─ utils.js                     # UI/string/storage helpers
│
└─ styles/                         # CSS chia theo miền chức năng
```

## Luồng phụ thuộc

- `app.js` tạo shared context rồi khởi tạo các controller.
- Controller không import vòng nhau; khi cần gọi controller khác thì nhận getter/callback từ `app.js`.
- `app-exam.js` ghép queue, media và results cho Reading; `exam-coordinator.js` điều phối sang Listening khi cần.
- Listening sinh viên tái sử dụng `answer-queue.js` và `exam-media.js`; làm thử giảng viên dùng cùng `listening-view.js`/`audio-session.js` để giao diện và luật audio không lệch nhau.
- Audio có hàng đợi `pending_sync` riêng: nếu phát xong đúng lúc mất mạng, trạng thái hoàn thành được giữ local và tự đồng bộ lại trước khi chuyển pha/nộp bài.
- RPC Supabase/schema hiện tại không đổi do refactor này.

## Kiểm tra nguồn

Chạy:

```bash
node tools/check-source.mjs
find assets -name '*.js' -print0 | xargs -0 -n1 node --check
```

Checker sẽ chặn:

- JS runtime quá dài;
- tên JS kiểu phiên bản;
- import tương đối bị thiếu;
- dùng `localStorage` trực tiếp ngoài helper;
- mất các feature contract quan trọng như lưu đáp án, anti-cheat, reset/xóa lượt, preflight, authoring, password recovery và nhập Excel.

GitHub Actions `.github/workflows/source-check.yml` chạy lại các kiểm tra này khi push/PR.
