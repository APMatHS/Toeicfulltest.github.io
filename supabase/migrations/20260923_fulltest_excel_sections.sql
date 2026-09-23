-- Full Test Excel export: include Part/Section for every attempt question
-- so the frontend can calculate Listening (Part 1-4) and Reading (Part 5-7)
-- without inferring the section from display question numbers.

create or replace function public.staff_get_test_export(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_test public.tests%rowtype;
begin
  if public.current_role() not in ('teacher','system_admin') then
    raise exception 'Forbidden';
  end if;

  select * into v_test from public.tests where id=p_test_id;
  if not found then raise exception 'Test not found'; end if;

  return jsonb_build_object(
    'test',to_jsonb(v_test),
    'students',coalesce((
      select jsonb_agg(x.obj order by x.full_name,x.student_code,x.attempt_no)
      from (
        select
          coalesce(p.full_name,'(Tài khoản không còn)') full_name,
          p.student_code,
          a.attempt_no,
          jsonb_build_object(
            'student_id',a.student_id,
            'full_name',coalesce(p.full_name,'(Tài khoản không còn)'),
            'student_code',p.student_code,
            'attempt_id',a.id,
            'attempt_no',a.attempt_no,
            'status',a.status,
            'started_at',a.started_at,
            'expires_at',a.expires_at,
            'submitted_at',a.submitted_at,
            'score',a.score,
            'correct_count',a.correct_count,
            'violation_count',coalesce(a.violation_count,0),
            'submission_reason',a.submission_reason,
            'answers',coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'number',aq.display_number,
                  'question_id',q.id,
                  'part',tp.part_no,
                  'section',case when tp.part_no between 1 and 4 then 'listening' when tp.part_no between 5 and 7 then 'reading' else null end,
                  'selected',an.selected_choice_key,
                  'correct',q.correct_choice_key,
                  'is_correct',(an.selected_choice_key=q.correct_choice_key)
                ) order by aq.display_order
              )
              from public.attempt_questions aq
              join public.questions q on q.id=aq.question_id
              join public.test_parts tp on tp.id=q.test_part_id
              left join public.answers an on an.attempt_id=aq.attempt_id and an.question_id=q.id
              where aq.attempt_id=a.id
            ),'[]'::jsonb),
            'violations',coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'event_type',e.event_type,
                  'occurred_at',e.occurred_at,
                  'violation_number',e.violation_number
                ) order by e.occurred_at
              )
              from public.anti_cheat_events e
              where e.attempt_id=a.id
            ),'[]'::jsonb)
          ) obj
        from public.attempts a
        left join public.profiles p on p.id=a.student_id
        where a.test_id=p_test_id and a.status<>'reset'
      ) x
    ),'[]'::jsonb),
    'reset_history',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'attempt_id',a.id,
          'student_id',a.student_id,
          'full_name',coalesce(p.full_name,'(Tài khoản không còn)'),
          'student_code',p.student_code,
          'attempt_no',a.attempt_no,
          'status',a.status,
          'started_at',a.started_at,
          'submitted_at',a.submitted_at,
          'submission_reason',a.submission_reason
        ) order by coalesce(p.full_name,''),a.attempt_no
      )
      from public.attempts a
      left join public.profiles p on p.id=a.student_id
      where a.test_id=p_test_id and a.status='reset'
    ),'[]'::jsonb),
    'roster',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'student_id',p.id,
          'full_name',p.full_name,
          'student_code',p.student_code,
          'email',p.email,
          'is_active',p.is_active
        ) order by p.full_name,p.student_code
      )
      from public.class_members cm
      join public.profiles p on p.id=cm.user_id
      where cm.class_id=v_test.class_id and p.role='student'
    ),'[]'::jsonb)
  );
end
$$;

revoke all on function public.staff_get_test_export(uuid) from public,anon;
grant execute on function public.staff_get_test_export(uuid) to authenticated;
