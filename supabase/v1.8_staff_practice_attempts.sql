create table if not exists public.staff_practice_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  staff_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress','submitted','expired')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  total_questions integer not null default 0 check (total_questions >= 0),
  correct_count integer check (correct_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.staff_practice_answers (
  attempt_id uuid not null references public.staff_practice_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  selected_choice_key char(1) check (selected_choice_key in ('A','B','C','D')),
  is_marked_review boolean not null default false,
  answered_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create unique index if not exists staff_practice_one_open_attempt
on public.staff_practice_attempts(test_id, staff_id)
where status = 'in_progress';

create index if not exists staff_practice_attempts_test_staff_started
on public.staff_practice_attempts(test_id, staff_id, started_at desc);
create index if not exists staff_practice_attempts_staff_id
on public.staff_practice_attempts(staff_id);
create index if not exists staff_practice_answers_question_id
on public.staff_practice_answers(question_id);

alter table public.staff_practice_attempts enable row level security;
alter table public.staff_practice_answers enable row level security;

create policy "staff_read_own_practice_attempts" on public.staff_practice_attempts
for select to authenticated
using ((select auth.uid()) = staff_id and (select public.current_role()) in ('teacher','system_admin'));

create policy "staff_read_own_practice_answers" on public.staff_practice_answers
for select to authenticated
using (exists (
  select 1 from public.staff_practice_attempts a
  where a.id=attempt_id and a.staff_id=(select auth.uid())
) and (select public.current_role()) in ('teacher','system_admin'));

revoke all on public.staff_practice_attempts from anon, authenticated;
revoke all on public.staff_practice_answers from anon, authenticated;

create or replace function public.staff_finish_practice_attempt(p_attempt_id uuid, p_status text default 'submitted')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.staff_practice_attempts%rowtype;
  v_correct integer;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  if p_status not in ('submitted','expired') then raise exception 'Invalid status'; end if;

  select * into v_attempt from public.staff_practice_attempts
  where id=p_attempt_id and staff_id=auth.uid() for update;
  if not found then raise exception 'Practice attempt not found'; end if;

  select count(*)::integer into v_correct
  from public.staff_practice_answers a
  join public.questions q on q.id=a.question_id
  where a.attempt_id=p_attempt_id and a.selected_choice_key=q.correct_choice_key;

  update public.staff_practice_attempts
  set status=p_status, submitted_at=coalesce(submitted_at,now()), correct_count=v_correct
  where id=p_attempt_id;

  return jsonb_build_object('attempt_id',p_attempt_id,'status',p_status,
    'correct_count',v_correct,'total_questions',v_attempt.total_questions);
end $$;

create or replace function public.staff_start_practice_attempt(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_duration integer;
  v_total integer;
  v_expired uuid;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;

  select id into v_expired from public.staff_practice_attempts
  where test_id=p_test_id and staff_id=auth.uid() and status='in_progress' and expires_at<=now()
  for update;
  if v_expired is not null then
    perform public.staff_finish_practice_attempt(v_expired,'expired');
  end if;

  select id into v_id from public.staff_practice_attempts
  where test_id=p_test_id and staff_id=auth.uid() and status='in_progress'
  order by started_at desc limit 1;
  if v_id is not null then return jsonb_build_object('attempt_id',v_id,'resumed',true); end if;

  select duration_minutes into v_duration from public.tests where id=p_test_id and archived_at is null;
  if not found then raise exception 'Test not found'; end if;
  select count(*)::integer into v_total from public.questions q join public.test_parts tp on tp.id=q.test_part_id where tp.test_id=p_test_id;
  if v_total=0 then raise exception 'Test has no questions'; end if;

  insert into public.staff_practice_attempts(test_id,staff_id,expires_at,total_questions)
  values(p_test_id,auth.uid(),now()+make_interval(mins=>v_duration),v_total)
  returning id into v_id;
  return jsonb_build_object('attempt_id',v_id,'resumed',false);
end $$;

create or replace function public.staff_get_practice_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.staff_practice_attempts%rowtype;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select * into v_attempt from public.staff_practice_attempts where id=p_attempt_id and staff_id=auth.uid();
  if not found then raise exception 'Practice attempt not found'; end if;
  if v_attempt.status='in_progress' and v_attempt.expires_at<=now() then
    perform public.staff_finish_practice_attempt(p_attempt_id,'expired');
    select * into v_attempt from public.staff_practice_attempts where id=p_attempt_id;
  end if;
  return jsonb_build_object(
    'attempt',to_jsonb(v_attempt),
    'answers',coalesce((select jsonb_agg(jsonb_build_object(
      'question_id',a.question_id,'selected',a.selected_choice_key,'marked',a.is_marked_review
    )) from public.staff_practice_answers a where a.attempt_id=p_attempt_id),'[]'::jsonb)
  );
end $$;

create or replace function public.staff_save_practice_answer(p_attempt_id uuid,p_question_id uuid,p_choice char,p_marked boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_attempt public.staff_practice_attempts%rowtype;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select * into v_attempt from public.staff_practice_attempts where id=p_attempt_id and staff_id=auth.uid() for update;
  if not found or v_attempt.status<>'in_progress' then raise exception 'Practice attempt is not active'; end if;
  if v_attempt.expires_at<=now() then
    perform public.staff_finish_practice_attempt(p_attempt_id,'expired');
    raise exception 'Practice time has expired';
  end if;
  if not exists(select 1 from public.questions q join public.test_parts tp on tp.id=q.test_part_id where q.id=p_question_id and tp.test_id=v_attempt.test_id) then
    raise exception 'Question does not belong to this test';
  end if;
  insert into public.staff_practice_answers(attempt_id,question_id,selected_choice_key,is_marked_review,answered_at)
  values(p_attempt_id,p_question_id,p_choice,p_marked,now())
  on conflict(attempt_id,question_id) do update set selected_choice_key=excluded.selected_choice_key,is_marked_review=excluded.is_marked_review,answered_at=now();
  return jsonb_build_object('saved',true);
end $$;

create or replace function public.staff_list_practice_attempts(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',a.id,'status',a.status,'started_at',a.started_at,'expires_at',a.expires_at,
    'submitted_at',a.submitted_at,'correct_count',a.correct_count,'total_questions',a.total_questions,
    'answered_count',(select count(*) from public.staff_practice_answers x where x.attempt_id=a.id and x.selected_choice_key is not null)
  ) order by a.started_at desc) from public.staff_practice_attempts a
  where a.test_id=p_test_id and a.staff_id=auth.uid()),'[]'::jsonb);
end $$;

revoke all on function public.staff_finish_practice_attempt(uuid,text) from public, anon;
revoke all on function public.staff_start_practice_attempt(uuid) from public, anon;
revoke all on function public.staff_get_practice_attempt(uuid) from public, anon;
revoke all on function public.staff_save_practice_answer(uuid,uuid,char,boolean) from public, anon;
revoke all on function public.staff_list_practice_attempts(uuid) from public, anon;
grant execute on function public.staff_finish_practice_attempt(uuid,text) to authenticated;
grant execute on function public.staff_start_practice_attempt(uuid) to authenticated;
grant execute on function public.staff_get_practice_attempt(uuid) to authenticated;
grant execute on function public.staff_save_practice_answer(uuid,uuid,char,boolean) to authenticated;
grant execute on function public.staff_list_practice_attempts(uuid) to authenticated;
