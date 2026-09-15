-- TOEIC Full Test V1.18b — one continuous Listening audio for Part 1–4
-- Apply AFTER v1.18_listening_full_test.sql.
-- This migration is additive for data and replaces only RPC logic that previously expected per-question/per-group audio units.

alter table public.tests add column if not exists listening_audio_storage_path text;
alter table public.tests add column if not exists listening_audio_filename text;
alter table public.tests add column if not exists listening_audio_duration_seconds numeric;

do $$ begin
  alter table public.tests add constraint tests_listening_audio_duration_chk
    check (listening_audio_duration_seconds is null or listening_audio_duration_seconds >= 0);
exception when duplicate_object then null; end $$;

create or replace function public.staff_set_listening_audio_v118b(
  p_test_id uuid,
  p_storage_path text,
  p_filename text default null,
  p_duration_seconds numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_t public.tests%rowtype;
  v_path text:=nullif(trim(coalesce(p_storage_path,'')),'');
  v_name text:=nullif(trim(coalesce(p_filename,'')),'');
  v_duration numeric:=case when p_duration_seconds is null then null else greatest(0,p_duration_seconds) end;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  perform public._assert_test_content_editable(p_test_id);
  select * into v_t from public.tests where id=p_test_id for update;
  if not found then raise exception 'Test not found'; end if;
  if coalesce(v_t.test_kind,'reading')='reading' and v_path is not null then raise exception 'Reading test does not use Listening audio'; end if;
  if v_path is not null and length(v_path)>1000 then raise exception 'Audio storage path is too long'; end if;
  if v_name is not null and length(v_name)>255 then v_name:=left(v_name,255); end if;

  update public.tests set
    listening_audio_storage_path=v_path,
    listening_audio_filename=case when v_path is null then null else coalesce(v_name,'Audio Listening Part 1-4') end,
    listening_audio_duration_seconds=case when v_path is null then null else v_duration end
  where id=p_test_id;

  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(auth.uid(),case when v_path is null then 'listening_audio_removed' else 'listening_audio_updated' end,'test',p_test_id::text,
    jsonb_build_object('storage_path',v_path,'filename',v_name,'duration_seconds',v_duration));

  return jsonb_build_object('ok',true,'storage_path',v_path,'filename',v_name,'duration_seconds',v_duration);
end
$$;

create or replace function public.get_listening_audio_v118b(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_a public.attempts%rowtype;
  v_t public.tests%rowtype;
begin
  select * into v_a from public.attempts where id=p_attempt_id;
  if not found or (v_a.student_id<>auth.uid() and public.current_role() not in ('teacher','system_admin')) then raise exception 'Forbidden'; end if;
  select * into v_t from public.tests where id=v_a.test_id;
  if coalesce(v_t.test_kind,'reading') not in ('listening','full') then raise exception 'Attempt is not a Listening test'; end if;
  return jsonb_build_object(
    'storage_path',v_t.listening_audio_storage_path,
    'filename',v_t.listening_audio_filename,
    'duration_seconds',v_t.listening_audio_duration_seconds
  );
end
$$;

-- Existing state table is reused, but V1.18b has exactly one unit: listening:main.
create or replace function public.start_audio_unit_v118(p_attempt_id uuid,p_unit_key text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_a public.attempts%rowtype;
  v_s public.attempt_audio_states%rowtype;
  v_kind text;
  v_path text;
begin
  if p_unit_key<>'listening:main' then raise exception 'Invalid Listening audio unit'; end if;
  select * into v_a from public.attempts where id=p_attempt_id and student_id=auth.uid() for update;
  if not found or v_a.status<>'in_progress' then raise exception 'Attempt unavailable'; end if;
  if now()>=v_a.expires_at then perform public._finalize_attempt(p_attempt_id,'timeout'); raise exception 'Attempt expired'; end if;
  select test_kind,listening_audio_storage_path into v_kind,v_path from public.tests where id=v_a.test_id;
  if v_kind not in ('listening','full') or v_path is null then raise exception 'Listening audio is not configured'; end if;
  insert into public.attempt_audio_states(attempt_id,unit_key) values(p_attempt_id,'listening:main') on conflict do nothing;
  select * into v_s from public.attempt_audio_states where attempt_id=p_attempt_id and unit_key='listening:main';
  return jsonb_build_object('unit_key',v_s.unit_key,'started_at',v_s.started_at,'last_position_seconds',v_s.last_position_seconds,'completed_at',v_s.completed_at,'updated_at',v_s.updated_at);
end
$$;

create or replace function public.update_audio_unit_v118(p_attempt_id uuid,p_unit_key text,p_position_seconds numeric,p_completed boolean default false)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_a public.attempts%rowtype;
  v_s public.attempt_audio_states%rowtype;
  v_pos numeric;
begin
  if p_unit_key<>'listening:main' then raise exception 'Invalid Listening audio unit'; end if;
  select * into v_a from public.attempts where id=p_attempt_id and student_id=auth.uid() for update;
  if not found or v_a.status<>'in_progress' then raise exception 'Attempt unavailable'; end if;
  if now()>=v_a.expires_at then perform public._finalize_attempt(p_attempt_id,'timeout'); raise exception 'Attempt expired'; end if;
  v_pos:=greatest(0,coalesce(p_position_seconds,0));
  select * into v_s from public.attempt_audio_states where attempt_id=p_attempt_id and unit_key='listening:main' for update;
  if not found then raise exception 'Listening audio has not started'; end if;
  update public.attempt_audio_states set
    last_position_seconds=greatest(last_position_seconds,v_pos),
    completed_at=case when completed_at is not null then completed_at when p_completed then now() else null end,
    updated_at=now()
  where attempt_id=p_attempt_id and unit_key='listening:main';
  select * into v_s from public.attempt_audio_states where attempt_id=p_attempt_id and unit_key='listening:main';
  return jsonb_build_object('unit_key',v_s.unit_key,'started_at',v_s.started_at,'last_position_seconds',v_s.last_position_seconds,'completed_at',v_s.completed_at,'updated_at',v_s.updated_at);
end
$$;

create or replace function public.complete_listening_phase_v118(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_a public.attempts%rowtype;
  v_kind text;
  v_path text;
  v_done timestamptz;
begin
  select * into v_a from public.attempts where id=p_attempt_id and student_id=auth.uid() for update;
  if not found or v_a.status<>'in_progress' then raise exception 'Attempt unavailable'; end if;
  if now()>=v_a.expires_at then perform public._finalize_attempt(p_attempt_id,'timeout'); raise exception 'Attempt expired'; end if;
  select test_kind,listening_audio_storage_path into v_kind,v_path from public.tests where id=v_a.test_id;
  if v_kind<>'full' then raise exception 'Not a full test'; end if;
  if v_path is null then return jsonb_build_object('ok',false,'blocked',true,'reason','listening_audio_missing'); end if;
  select completed_at into v_done from public.attempt_audio_states where attempt_id=p_attempt_id and unit_key='listening:main';
  if v_done is null then return jsonb_build_object('ok',false,'blocked',true,'reason','listening_audio_not_completed'); end if;
  insert into public.attempt_runtime_states(attempt_id,listening_completed_at,updated_at)
  values(p_attempt_id,now(),now())
  on conflict(attempt_id) do update set listening_completed_at=coalesce(public.attempt_runtime_states.listening_completed_at,excluded.listening_completed_at),updated_at=now();
  return jsonb_build_object('ok',true,'blocked',false,'listening_completed_at',(select listening_completed_at from public.attempt_runtime_states where attempt_id=p_attempt_id));
end
$$;

create or replace function public.staff_start_practice_audio_unit_v118(p_attempt_id uuid,p_unit_key text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_a public.staff_practice_attempts%rowtype;
  v_s public.staff_practice_audio_states%rowtype;
  v_kind text;
  v_path text;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  if p_unit_key<>'listening:main' then raise exception 'Invalid Listening audio unit'; end if;
  select * into v_a from public.staff_practice_attempts where id=p_attempt_id and staff_id=auth.uid() for update;
  if not found or v_a.status<>'in_progress' then raise exception 'Practice attempt unavailable'; end if;
  if now()>=v_a.expires_at then perform public.staff_finish_practice_attempt(p_attempt_id,'expired'); raise exception 'Practice attempt expired'; end if;
  select test_kind,listening_audio_storage_path into v_kind,v_path from public.tests where id=v_a.test_id;
  if v_kind not in ('listening','full') or v_path is null then raise exception 'Listening audio is not configured'; end if;
  insert into public.staff_practice_audio_states(attempt_id,unit_key) values(p_attempt_id,'listening:main') on conflict do nothing;
  select * into v_s from public.staff_practice_audio_states where attempt_id=p_attempt_id and unit_key='listening:main';
  return jsonb_build_object('unit_key',v_s.unit_key,'started_at',v_s.started_at,'last_position_seconds',v_s.last_position_seconds,'completed_at',v_s.completed_at,'updated_at',v_s.updated_at);
end
$$;

create or replace function public.staff_update_practice_audio_unit_v118(p_attempt_id uuid,p_unit_key text,p_position_seconds numeric,p_completed boolean default false)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_a public.staff_practice_attempts%rowtype;
  v_s public.staff_practice_audio_states%rowtype;
  v_pos numeric;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  if p_unit_key<>'listening:main' then raise exception 'Invalid Listening audio unit'; end if;
  select * into v_a from public.staff_practice_attempts where id=p_attempt_id and staff_id=auth.uid() for update;
  if not found or v_a.status<>'in_progress' then raise exception 'Practice attempt unavailable'; end if;
  if now()>=v_a.expires_at then perform public.staff_finish_practice_attempt(p_attempt_id,'expired'); raise exception 'Practice attempt expired'; end if;
  v_pos:=greatest(0,coalesce(p_position_seconds,0));
  select * into v_s from public.staff_practice_audio_states where attempt_id=p_attempt_id and unit_key='listening:main' for update;
  if not found then raise exception 'Practice Listening audio has not started'; end if;
  update public.staff_practice_audio_states set
    last_position_seconds=greatest(last_position_seconds,v_pos),
    completed_at=case when completed_at is not null then completed_at when p_completed then now() else null end,
    updated_at=now()
  where attempt_id=p_attempt_id and unit_key='listening:main';
  select * into v_s from public.staff_practice_audio_states where attempt_id=p_attempt_id and unit_key='listening:main';
  return jsonb_build_object('unit_key',v_s.unit_key,'started_at',v_s.started_at,'last_position_seconds',v_s.last_position_seconds,'completed_at',v_s.completed_at,'updated_at',v_s.updated_at);
end
$$;

create or replace function public.staff_complete_practice_listening_v118(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_a public.staff_practice_attempts%rowtype;
  v_kind text;
  v_path text;
  v_done timestamptz;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select * into v_a from public.staff_practice_attempts where id=p_attempt_id and staff_id=auth.uid() for update;
  if not found or v_a.status<>'in_progress' then raise exception 'Practice attempt unavailable'; end if;
  if now()>=v_a.expires_at then perform public.staff_finish_practice_attempt(p_attempt_id,'expired'); raise exception 'Practice attempt expired'; end if;
  select test_kind,listening_audio_storage_path into v_kind,v_path from public.tests where id=v_a.test_id;
  if v_kind<>'full' then raise exception 'Not a full test'; end if;
  if v_path is null then return jsonb_build_object('ok',false,'blocked',true,'reason','listening_audio_missing'); end if;
  select completed_at into v_done from public.staff_practice_audio_states where attempt_id=p_attempt_id and unit_key='listening:main';
  if v_done is null then return jsonb_build_object('ok',false,'blocked',true,'reason','listening_audio_not_completed'); end if;
  update public.staff_practice_attempts set listening_completed_at=coalesce(listening_completed_at,now()) where id=p_attempt_id;
  return jsonb_build_object('ok',true,'blocked',false,'listening_completed_at',(select listening_completed_at from public.staff_practice_attempts where id=p_attempt_id));
end
$$;

create or replace function public.staff_preflight_test(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_t public.tests%rowtype;
  v_q int; v_bad_choices int; v_bad_correct int; v_static_media int; v_attempts int; v_students int;
  v_p1 int;v_p2 int;v_p3 int;v_p4 int;v_p5 int;v_p6 int;v_p7 int;
  v_required_ok boolean; v_standard boolean; v_label text; v_audio_ready boolean; v_audio_time_ok boolean;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select * into v_t from public.tests where id=p_test_id;
  if not found then raise exception 'Test not found'; end if;
  select count(*)::int,
    count(*) filter(where tp.part_no=1)::int,count(*) filter(where tp.part_no=2)::int,count(*) filter(where tp.part_no=3)::int,count(*) filter(where tp.part_no=4)::int,
    count(*) filter(where tp.part_no=5)::int,count(*) filter(where tp.part_no=6)::int,count(*) filter(where tp.part_no=7)::int
  into v_q,v_p1,v_p2,v_p3,v_p4,v_p5,v_p6,v_p7
  from public.questions q join public.test_parts tp on tp.id=q.test_part_id where tp.test_id=p_test_id;

  select count(*)::int into v_bad_choices
  from public.questions q join public.test_parts tp on tp.id=q.test_part_id
  where tp.test_id=p_test_id and (select count(*) from public.question_choices c where c.question_id=q.id)<>case when tp.part_no=2 then 3 else 4 end;
  select count(*)::int into v_bad_correct
  from public.questions q join public.test_parts tp on tp.id=q.test_part_id
  where tp.test_id=p_test_id and not exists(select 1 from public.question_choices c where c.question_id=q.id and c.choice_key=q.correct_choice_key);
  select count(*)::int into v_static_media
  from public.stimuli s join public.stimulus_groups sg on sg.id=s.stimulus_group_id join public.test_parts tp on tp.id=sg.test_part_id
  where tp.test_id=p_test_id and s.storage_path like 'static:%';
  select count(*)::int into v_attempts from public.attempts where test_id=p_test_id;
  select count(*)::int into v_students from public.class_members cm join public.profiles p on p.id=cm.user_id
  where cm.class_id=v_t.class_id and p.role='student' and coalesce(p.is_active,true)=true;

  v_audio_ready:=v_t.listening_audio_storage_path is not null;
  v_audio_time_ok:=v_t.listening_audio_duration_seconds is null or v_t.listening_audio_duration_seconds<=v_t.duration_minutes*60;
  if v_t.test_kind='listening' then
    v_required_ok:=v_p1>0 and v_p2>0 and v_p3>0 and v_p4>0 and v_audio_ready;
    v_standard:=v_p1=6 and v_p2=25 and v_p3=39 and v_p4=30 and v_q=100;
    v_label:=format('Listening: P1=%s, P2=%s, P3=%s, P4=%s',v_p1,v_p2,v_p3,v_p4);
  elsif v_t.test_kind='full' then
    v_required_ok:=v_p1>0 and v_p2>0 and v_p3>0 and v_p4>0 and v_p5>0 and v_p6>0 and v_p7>0 and v_audio_ready;
    v_standard:=v_p1=6 and v_p2=25 and v_p3=39 and v_p4=30 and v_p5=30 and v_p6=16 and v_p7=54 and v_q=200;
    v_label:=format('Full: P1=%s, P2=%s, P3=%s, P4=%s, P5=%s, P6=%s, P7=%s',v_p1,v_p2,v_p3,v_p4,v_p5,v_p6,v_p7);
  else
    v_required_ok:=v_p5>0 and v_p6>0 and v_p7>0;
    v_standard:=v_p5=30 and v_p6=16 and v_p7=54 and v_q=100;
    v_label:=format('Reading: P5=%s, P6=%s, P7=%s',v_p5,v_p6,v_p7);
  end if;

  return jsonb_build_object(
    'ok',(v_t.class_id is not null and v_students>0 and v_q>0 and v_required_ok and (v_t.test_kind='reading' or v_audio_time_ok) and v_bad_choices=0 and v_bad_correct=0 and not(v_t.opens_at is not null and v_t.closes_at is not null and v_t.closes_at<=v_t.opens_at)),
    'test_kind',v_t.test_kind,'question_count',v_q,
    'part1_count',v_p1,'part2_count',v_p2,'part3_count',v_p3,'part4_count',v_p4,'part5_count',v_p5,'part6_count',v_p6,'part7_count',v_p7,
    'structure_complete',v_required_ok,'structure_standard',v_standard,'structure_label',v_label,
    'listening_audio_ready',v_audio_ready,'listening_audio_filename',v_t.listening_audio_filename,'listening_audio_duration_seconds',v_t.listening_audio_duration_seconds,'listening_audio_duration_ok',v_audio_time_ok,
    'listening_audio_parts',case when v_audio_ready then 4 else 0 end,'missing_listening_audio_questions',0,
    'reading_standard',(v_t.test_kind='reading' and v_standard),'missing_or_extra_choices',v_bad_choices,'invalid_correct_choice',v_bad_correct,
    'class_missing',(v_t.class_id is null),'active_student_count',v_students,'class_empty',(v_students=0),
    'schedule_invalid',(v_t.opens_at is not null and v_t.closes_at is not null and v_t.closes_at<=v_t.opens_at),
    'static_media_count',v_static_media,'attempt_count',v_attempts,'show_answers_after_submit',v_t.show_answers_after_submit,
    'content_locked',(v_t.content_locked_at is not null),'content_locked_at',v_t.content_locked_at
  );
end
$$;

create or replace function public.staff_clone_test_v118b(p_source_test_id uuid,p_overrides jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_new uuid;
  v_source public.tests%rowtype;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select * into v_source from public.tests where id=p_source_test_id;
  if not found then raise exception 'Source test not found'; end if;
  v_new:=public.staff_clone_test(p_source_test_id,p_overrides);
  update public.tests set
    listening_audio_storage_path=v_source.listening_audio_storage_path,
    listening_audio_filename=v_source.listening_audio_filename,
    listening_audio_duration_seconds=v_source.listening_audio_duration_seconds
  where id=v_new;
  return v_new;
end
$$;

revoke all on function public.staff_set_listening_audio_v118b(uuid,text,text,numeric) from public,anon;
revoke all on function public.get_listening_audio_v118b(uuid) from public,anon;
revoke all on function public.staff_clone_test_v118b(uuid,jsonb) from public,anon;
grant execute on function public.staff_set_listening_audio_v118b(uuid,text,text,numeric) to authenticated;
grant execute on function public.get_listening_audio_v118b(uuid) to authenticated;
grant execute on function public.staff_clone_test_v118b(uuid,jsonb) to authenticated;
