-- Cho phép importer lưu câu đã nhận diện dù đáp án Excel bị thiếu/không đọc được.
-- UI Soạn đề đã đánh dấu câu không có correct_choice_key là "Cần kiểm tra".
alter table public.questions
  alter column correct_choice_key drop not null;
