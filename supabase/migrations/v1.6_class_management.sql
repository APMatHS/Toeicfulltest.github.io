-- TOEIC Full Test V1.6
create or replace function public.staff_set_student_class(
  p_student_id uuid,
  p_class_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('teacher','system_admin')
      and coalesce(is_active, true) = true
  ) then
    raise exception 'Bạn không có quyền quản lý lớp.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_student_id and role = 'student'
  ) then
    raise exception 'Không tìm thấy tài khoản sinh viên.';
  end if;

  if p_class_id is not null and not exists (
    select 1 from public.classes where id = p_class_id
  ) then
    raise exception 'Không tìm thấy lớp.';
  end if;

  update public.profiles
  set class_id = p_class_id
  where id = p_student_id;
end;
$$;

revoke all on function public.staff_set_student_class(uuid, uuid) from public;
grant execute on function public.staff_set_student_class(uuid, uuid) to authenticated;
