# Xác minh bản modular trên nền V1.17 FULL

Ngày rà soát: 15/09/2026.

## Kiểm tra đã chạy

- `node tools/check-source.mjs` — đạt.
- `node --check` trên toàn bộ JavaScript runtime — đạt.
- `node tools/smoke-bootstrap.mjs` — đạt.
- Import tương đối — đủ file; không có vòng import runtime.
- Feature contract đối chiếu nền V1.17 — đủ RPC, Edge Function, table/bucket và route được ghi trong `tools/feature-contracts.json`.
- Không có JS runtime tên theo phiên bản/patch.
- Không module nào truy cập `localStorage` trực tiếp ngoài `modules/utils.js`.
- Không JS runtime nào vượt 24 KiB; không file nào vượt 320 dòng.
- `supabase/` và `assets/config.js` giống nguyên bản V1.17 FULL.
- CSS chức năng giữ nguyên.

## Lỗi đã sửa

Importer sinh viên Excel/CSV từng gọi `XLSX.read(...)` nhưng sau tối ưu lazy-load lại không import SheetJS. Bản modular dùng `services/xlsx-service.js` để cả import và export tải SheetJS theo nhu cầu.

## Giới hạn của kiểm tra này

Smoke test xác nhận bootstrap/module wiring nhưng không thay thế kiểm thử end-to-end với tài khoản Supabase thật. Trước kỳ thi thật vẫn cần chạy checklist trong `docs/refactor-modular.md` trên môi trường triển khai.
