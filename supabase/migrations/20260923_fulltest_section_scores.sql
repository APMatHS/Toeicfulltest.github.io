-- Full Test section scores: expose aggregate Listening/Reading counts after submission
-- without revealing per-question correctness when answers are hidden.

create or replace function public.get_attempt_section_scores_v119(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_a public.attempts%rowtype;
  v_kind text;
  v_listening_total int:=0;
  v_listening_correct int:=0;
  v_reading_total int:=0;
  v_reading_correct int:=0;
  v_total int:=0;
begin
  select * into v_a
  from public.attempts
  where id=p_attempt_id;

  if not found or (v_a.student_id<>auth.uid() and public.current_role() not in ('teacher','system_admin')) then
    raise exception 'Forbidden';
  end if;

  if v_a.status='in_progress' and now()>=v_a.expires_at then
    perform public._finalize_attempt(p_attempt_id,'timeout');
    select * into v_a from public.attempts where id=p_attempt_id;
  end if;

  if v_a.status='in_progress' then
    raise exception 'Attempt is not submitted';
  end if;

  select coalesce(t.test_kind,'reading') into v_kind
  from public.tests t
  where t.id=v_a.test_id;

  select
    count(*) filter(where tp.part_no between 1 and 4)::int,
    count(*) filter(where tp.part_no between 1 and 4 and a.selected_choice_key=q.correct_choice_key)::int,
    count(*) filter(where tp.part_no between 5 and 7)::int,
    count(*) filter(where tp.part_no between 5 and 7 and a.selected_choice_key=q.correct_choice_key)::int,
    count(*)::int
  into
    v_listening_total,
    v_listening_correct,
    v_reading_total,
    v_reading_correct,
    v_total
  from public.attempt_questions aq
  join public.questions q on q.id=aq.question_id
  join public.test_parts tp on tp.id=q.test_part_id
  left join public.answers a on a.attempt_id=aq.attempt_id and a.question_id=q.id
  where aq.attempt_id=p_attempt_id;

  return jsonb_build_object(
    'test_kind',v_kind,
    'listening',jsonb_build_object(
      'correct_count',coalesce(v_listening_correct,0),
      'total_questions',coalesce(v_listening_total,0)
    ),
    'reading',jsonb_build_object(
      'correct_count',coalesce(v_reading_correct,0),
      'total_questions',coalesce(v_reading_total,0)
    ),
    'total',jsonb_build_object(
      'correct_count',coalesce(v_a.correct_count,0),
      'total_questions',coalesce(v_total,0)
    )
  );
end
$$;

revoke all on function public.get_attempt_section_scores_v119(uuid) from public,anon;
grant execute on function public.get_attempt_section_scores_v119(uuid) to authenticated;
