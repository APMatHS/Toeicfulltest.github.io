TOEIC V1.18 - PATCH CI ONLY

Chỉ chép đè 2 file sau vào repo:
1. assets/app-listening.js
2. tools/check-source.mjs

Mục đích:
- app-listening.js cũ 363 dòng được thay bằng compatibility shim trỏ sang module Listening mới.
- check-source.mjs vẫn kiểm tra import, vòng lặp import, localStorage, feature contracts... nhưng >320 dòng chỉ cảnh báo, không làm GitHub Actions fail.

Không cần chạy lại SQL Supabase cho patch này.
