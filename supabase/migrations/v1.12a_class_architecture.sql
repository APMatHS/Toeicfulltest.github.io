-- V1.12a: class architecture. class_members is authoritative; profiles.class_id is a UI mirror.
alter table public.profiles add column if not exists class_id uuid null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='profiles_class_id_fkey' and conrelid='public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_class_id_fkey foreign key(class_id) references public.classes(id) on delete set null;
  end if;
end $$;
create unique index if not exists class_members_one_class_per_user_uidx on public.class_members(user_id);
update public.profiles p set class_id=cm.class_id from public.class_members cm where cm.user_id=p.id and p.class_id is distinct from cm.class_id;
update public.profiles p set class_id=null where p.role='student' and p.class_id is not null and not exists(select 1 from public.class_members cm where cm.user_id=p.id);
create or replace function public.sync_profile_class_from_membership() returns trigger language plpgsql security definer set search_path=public as $$
declare v_user uuid; begin
 v_user:=case when tg_op='DELETE' then old.user_id else new.user_id end;
 update public.profiles p set class_id=(select cm.class_id from public.class_members cm where cm.user_id=v_user limit 1) where p.id=v_user;
 if tg_op='UPDATE' and old.user_id is distinct from new.user_id then update public.profiles p set class_id=(select cm.class_id from public.class_members cm where cm.user_id=old.user_id limit 1) where p.id=old.user_id; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists toeic_sync_profile_class_from_membership on public.class_members;
create trigger toeic_sync_profile_class_from_membership after insert or update or delete on public.class_members for each row execute function public.sync_profile_class_from_membership();
create or replace function public.staff_set_student_class(p_student_id uuid,p_class_id uuid default null) returns void language plpgsql security definer set search_path=public as $$
declare v_old_class uuid; begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role in ('teacher','system_admin') and coalesce(is_active,true)=true) then raise exception 'Bạn không có quyền quản lý lớp.'; end if;
 if not exists(select 1 from public.profiles where id=p_student_id and role='student') then raise exception 'Không tìm thấy tài khoản sinh viên.'; end if;
 if p_class_id is not null and not exists(select 1 from public.classes where id=p_class_id) then raise exception 'Không tìm thấy lớp.'; end if;
 select class_id into v_old_class from public.class_members where user_id=p_student_id limit 1;
 delete from public.class_members where user_id=p_student_id;
 if p_class_id is not null then insert into public.class_members(class_id,user_id) values(p_class_id,p_student_id); end if;
 insert into public.audit_logs(actor_id,action,target_type,target_id,metadata) values(auth.uid(),'student_class_changed','profile',p_student_id::text,jsonb_build_object('old_class_id',v_old_class,'new_class_id',p_class_id));
end $$;
revoke all on function public.staff_set_student_class(uuid,uuid) from public,anon;
grant execute on function public.staff_set_student_class(uuid,uuid) to authenticated;
