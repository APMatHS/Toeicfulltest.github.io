# Cấu trúc mã nguồn

- `index.html`: shell GitHub Pages.
- `assets/app.js`: bộ điều phối route, session và các workflow chính.
- `assets/modules/`: module theo chức năng (authoring, chống gian lận, media, review, rich editor, điểm, danh sách bài kiểm tra).
- `assets/styles/`: CSS theo miền chức năng, không đặt tên theo phiên bản.
- `supabase/migrations/`: migration/RPC; `supabase/functions/`: Edge Functions.
- `docs/releases/`: ghi chú lịch sử phiên bản, không trộn với mã chạy.
- `archive/legacy-builds/`: bản nén lịch sử; không được import vào ứng dụng.
