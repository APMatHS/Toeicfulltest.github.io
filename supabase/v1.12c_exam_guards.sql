-- TOEIC Full Test V1.12c - exam guards and preflight

drop policy if exists students_read_assigned_published_tests on public.tests;
create policy students_read_assigned_published_tests
on public.tests for select
to authenticated
using (
  status='published'::public.test_status
  and exists (
    select 1
    from public.class_members cm
    join public.profiles p on p.id=cm.user_id
    where cm.class_id=tests.class_id
      and cm.user_id=auth.uid()
      and p.role='student'
      and coalesce(p.is_active,true)=true
  )
);

create or replace function public.start_attempt(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_test public.tests%rowtype;
  v_attempt_id uuid;
  v_exp timestamptz;
  v_existing public.attempts%rowtype;
  v_used int:=0;
  v_next_no int:=1;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists(
    select 1 from public.profiles p
    where p.id=v_uid and p.role='student' and coalesce(p.is_active,true)=true
  ) then raise exception 'Tài khoản sinh viên đang bị khóa hoặc không hợp lệ'; end if;

  select * into v_test
  from public.tests t
  where t.id=p_test_id and t.archived_at is null and t.status='published'
    and (t.opens_at is null or now()>=t.opens_at)
    and (t.closes_at is null or now()<=t.closes_at)
    and exists(select 1 from public.class_members cm where cm.class_id=t.class_id and cm.user_id=v_uid);
  if not found then raise exception 'Test is not available'; end if;

  select * into v_existing
  from public.attempts
  where test_id=p_test_id and student_id=v_uid and status='in_progress'
  order by attempt_no desc
  limit 1;
  if found then
    return jsonb_build_object('attempt_id',v_existing.id,'existing',true,'attempt_no',v_existing.attempt_no,'expires_at',v_existing.expires_at);
  end if;

  select count(*)::int into v_used
  from public.attempts
  where test_id=p_test_id and student_id=v_uid and status<>'reset';
  select coalesce(max(attempt_no),0)+1 into v_next_no
  from public.attempts
  where test_id=p_test_id and student_id=v_uid;
  if v_used>=v_test.max_attempts then raise exception 'No attempts remaining'; end if;

  v_exp:=least(now()+make_interval(mins=>v_test.duration_minutes),coalesce(v_test.closes_at,'infinity'::timestamptz));
  insert into public.attempts(test_id,student_id,expires_at,attempt_no)
  values(p_test_id,v_uid,v_exp,v_next_no)
  returning id into v_attempt_id;

  update public.tests set content_locked_at=coalesce(content_locked_at,now()) where id=p_test_id;

  with base as (
    select q.id question_id,tp.part_no,tp.sort_order part_sort,q.source_order,tp.shuffle_mode,q.stimulus_group_id,
      case when tp.shuffle_mode='shuffle_questions' then md5(v_attempt_id::text||q.id::text)
           when tp.shuffle_mode='shuffle_stimulus_groups' then md5(v_attempt_id::text||coalesce(q.stimulus_group_id::text,q.id::text))
           else lpad(q.source_order::text,8,'0') end primary_key
    from public.questions q join public.test_parts tp on tp.id=q.test_part_id where tp.test_id=p_test_id
  ), ordered as (
    select question_id,part_no,stimulus_group_id,
      row_number() over(order by part_sort,primary_key,source_order)::int global_rn,
      row_number() over(partition by part_no order by primary_key,source_order)::int part_rn,
      dense_rank() over(partition by part_no order by primary_key)::int grp_rn
    from base
  )
  insert into public.attempt_questions(attempt_id,question_id,display_number,display_order,stimulus_group_display_order)
  select v_attempt_id,question_id,
    case part_no when 5 then 100+part_rn when 6 then 130+part_rn when 7 then 146+part_rn else global_rn end,
    global_rn,case when stimulus_group_id is null then null else grp_rn end
  from ordered;

  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(v_uid,'attempt_started','attempt',v_attempt_id::text,jsonb_build_object('test_id',p_test_id,'attempt_no',v_next_no));

  return jsonb_build_object('attempt_id',v_attempt_id,'existing',false,'attempt_no',v_next_no,'expires_at',v_exp,'remaining_after_start',v_test.max_attempts-v_used-1);
end;
$$;
revoke all on function public.start_attempt(uuid) from public,anon;
grant execute on function public.start_attempt(uuid) to authenticated;

create or replace function public.staff_preflight_test(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_t public.tests%rowtype;
  v_q int; v_bad_choices int; v_bad_correct int; v_static_media int; v_attempts int;
  v_p5 int; v_p6 int; v_p7 int; v_students int;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select * into v_t from public.tests where id=p_test_id;
  if not found then raise exception 'Test not found'; end if;
  select count(*)::int,
         count(*) filter(where tp.part_no=5)::int,
         count(*) filter(where tp.part_no=6)::int,
         count(*) filter(where tp.part_no=7)::int
    into v_q,v_p5,v_p6,v_p7
  from public.questions q join public.test_parts tp on tp.id=q.test_part_id where tp.test_id=p_test_id;
  select count(*)::int into v_bad_choices from public.questions q join public.test_parts tp on tp.id=q.test_part_id where tp.test_id=p_test_id and (select count(*) from public.question_choices c where c.question_id=q.id)<>4;
  select count(*)::int into v_bad_correct from public.questions q join public.test_parts tp on tp.id=q.test_part_id where tp.test_id=p_test_id and not exists(select 1 from public.question_choices c where c.question_id=q.id and c.choice_key=q.correct_choice_key);
  select count(*)::int into v_static_media from public.stimuli s join public.stimulus_groups sg on sg.id=s.stimulus_group_id join public.test_parts tp on tp.id=sg.test_part_id where tp.test_id=p_test_id and s.storage_path like 'static:%';
  select count(*)::int into v_attempts from public.attempts where test_id=p_test_id;
  select count(*)::int into v_students
  from public.class_members cm join public.profiles p on p.id=cm.user_id
  where cm.class_id=v_t.class_id and p.role='student' and p.is_active;
  return jsonb_build_object(
    'ok',(v_t.class_id is not null and v_students>0 and v_q>0 and v_bad_choices=0 and v_bad_correct=0 and not(v_t.opens_at is not null and v_t.closes_at is not null and v_t.closes_at<=v_t.opens_at)),
    'question_count',v_q,'part5_count',v_p5,'part6_count',v_p6,'part7_count',v_p7,
    'reading_standard',(v_p5=30 and v_p6=16 and v_p7=54 and v_q=100),
    'missing_or_extra_choices',v_bad_choices,'invalid_correct_choice',v_bad_correct,
    'class_missing',(v_t.class_id is null),'active_student_count',v_students,'class_empty',(v_students=0),
    'schedule_invalid',(v_t.opens_at is not null and v_t.closes_at is not null and v_t.closes_at<=v_t.opens_at),
    'static_media_count',v_static_media,'attempt_count',v_attempts,
    'show_answers_after_submit',v_t.show_answers_after_submit,
    'content_locked',(v_t.content_locked_at is not null),'content_locked_at',v_t.content_locked_at
  );
end;
$$;
revoke all on function public.staff_preflight_test(uuid) from public,anon;
grant execute on function public.staff_preflight_test(uuid) to authenticated;

alter table public.tests alter column show_answers_after_submit set default false;
update public.tests
set show_answers_after_submit=false
where title in ('TEST 1_15/09/2026','TEST 2_15/09/2026') and archived_at is null;

update public.tests t
set content_locked_at=null
where t.content_locked_at is not null
  and not exists(select 1 from public.attempts a where a.test_id=t.id);
