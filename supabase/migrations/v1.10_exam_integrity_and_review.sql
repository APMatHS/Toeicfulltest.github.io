-- TOEIC Full Test — V1.10
-- Chạy file này SAU KHI frontend V1.10 đã được triển khai.
-- File này tự chứa các thay đổi cần thiết của V1.9 liên quan đến lưu đáp án,
-- nên có thể nâng trực tiếp từ V1.8/V1.9 lên V1.10.
--
-- Chính sách chống gian lận V1.10:
--   * rời màn hình = tính ngay 1 vi phạm;
--   * quay lại trước 15 giây: tiếp tục làm, vi phạm vẫn giữ;
--   * rời quá 15 giây: tự động nộp bài;
--   * vi phạm lần thứ 3: tự động nộp ngay;
--   * mobile chỉ frontend gửi tab_hidden; desktop gộp blur/hidden thành một phiên;
--   * fullscreen_exit không tự tạo thêm vi phạm.

alter table public.tests
  alter column allowed_violations set default 2;

update public.tests
set allowed_violations=2
where anti_cheat_mode='warn_then_submit';

create or replace function public.register_violation_v2(
  p_attempt_id uuid,
  p_event_type text,
  p_details jsonb default '{}'::jsonb,
  p_client_event_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.attempts%rowtype;
  v_new int;
  v_mode public.anti_cheat_mode;
  v_policy text;
  v_phase text;
begin
  if p_event_type not in ('tab_hidden','fullscreen_exit','window_blur') then
    raise exception 'Invalid event';
  end if;

  select * into v_a
  from public.attempts
  where id=p_attempt_id and student_id=auth.uid()
  for update;

  if not found then raise exception 'Attempt unavailable'; end if;
  if v_a.status<>'in_progress' then
    return jsonb_build_object(
      'violation_count',v_a.violation_count,
      'submitted',true,
      'duplicate',false,
      'reason',coalesce(v_a.submission_reason,'already_closed')
    );
  end if;

  if now()>=v_a.expires_at then
    perform public._finalize_attempt(p_attempt_id,'timeout');
    return jsonb_build_object('submitted',true,'reason','timeout');
  end if;

  if p_client_event_id is not null and exists(
    select 1 from public.anti_cheat_events
    where client_event_id=p_client_event_id
  ) then
    return jsonb_build_object(
      'violation_count',v_a.violation_count,
      'submitted',false,
      'duplicate',true,
      'warning',false
    );
  end if;

  select anti_cheat_mode into v_mode
  from public.tests
  where id=v_a.test_id;

  if v_mode='off' then
    return jsonb_build_object(
      'violation_count',v_a.violation_count,
      'submitted',false,
      'warning',false,
      'ignored',true,
      'reason','anti_cheat_off'
    );
  end if;

  v_policy:=coalesce(p_details->>'policy','');
  v_phase:=coalesce(p_details->>'phase','');
  if v_policy<>'v1.10_exit_immediate' or v_phase<>'leave' then
    return jsonb_build_object(
      'violation_count',v_a.violation_count,
      'submitted',false,
      'warning',false,
      'ignored',true,
      'reason','unsupported_policy'
    );
  end if;

  update public.attempts
  set violation_count=violation_count+1
  where id=p_attempt_id
  returning violation_count into v_new;

  insert into public.anti_cheat_events(
    attempt_id,event_type,violation_number,details,client_event_id
  ) values(
    p_attempt_id,p_event_type,v_new,coalesce(p_details,'{}'::jsonb),p_client_event_id
  );

  if (v_mode='strict' and v_new>=1)
     or (v_mode='warn_then_submit' and v_new>=3) then
    perform public._finalize_attempt(p_attempt_id,'anti_cheat');
    return jsonb_build_object(
      'violation_count',v_new,
      'submitted',true,
      'duplicate',false,
      'warning',false,
      'reason','third_violation',
      'limit',case when v_mode='strict' then 1 else 3 end
    );
  end if;

  return jsonb_build_object(
    'violation_count',v_new,
    'submitted',false,
    'duplicate',false,
    'warning',true,
    'reason','screen_left',
    'limit',case when v_mode='strict' then 1 else 3 end,
    'remaining',case when v_mode='strict' then 0 else greatest(0,3-v_new) end
  );
end
$$;

revoke all on function public.register_violation_v2(uuid,text,jsonb,uuid)
from public, anon;
grant execute on function public.register_violation_v2(uuid,text,jsonb,uuid)
to authenticated;

create or replace function public.enforce_absence_timeout_v1(
  p_attempt_id uuid,
  p_leave_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.attempts%rowtype;
  v_mode public.anti_cheat_mode;
  v_left_at timestamptz;
  v_elapsed numeric;
begin
  select * into v_a
  from public.attempts
  where id=p_attempt_id and student_id=auth.uid()
  for update;

  if not found then raise exception 'Attempt unavailable'; end if;
  if v_a.status<>'in_progress' then
    return jsonb_build_object(
      'submitted',true,
      'already_closed',true,
      'reason',coalesce(v_a.submission_reason,'already_closed'),
      'violation_count',v_a.violation_count
    );
  end if;

  select anti_cheat_mode into v_mode
  from public.tests
  where id=v_a.test_id;

  if v_mode='off' then
    return jsonb_build_object('submitted',false,'ignored',true,'reason','anti_cheat_off');
  end if;

  select e.occurred_at into v_left_at
  from public.anti_cheat_events e
  where e.attempt_id=p_attempt_id
    and e.client_event_id=p_leave_event_id
    and e.details->>'policy'='v1.10_exit_immediate'
    and e.details->>'phase'='leave'
  order by e.id desc
  limit 1;

  if v_left_at is null then
    return jsonb_build_object('submitted',false,'ignored',true,'reason','leave_event_not_found');
  end if;

  v_elapsed:=extract(epoch from (now()-v_left_at));
  if v_elapsed<15 then
    return jsonb_build_object(
      'submitted',false,
      'reason','within_15_seconds',
      'remaining_seconds',greatest(0,ceil(15-v_elapsed))
    );
  end if;

  perform public._finalize_attempt(p_attempt_id,'anti_cheat');
  return jsonb_build_object(
    'submitted',true,
    'reason','away_over_15_seconds',
    'violation_count',v_a.violation_count
  );
end
$$;

revoke all on function public.enforce_absence_timeout_v1(uuid,uuid)
from public, anon;
grant execute on function public.enforce_absence_timeout_v1(uuid,uuid)
to authenticated;

-- Lưu ngay cả trạng thái đánh dấu xem lại khi chưa chọn A/B/C/D.
create or replace function public.save_answer_v2(
  p_attempt_id uuid,
  p_question_id uuid,
  p_choice character,
  p_marked boolean default false,
  p_client_event_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.attempts%rowtype;
begin
  select * into v_a
  from public.attempts
  where id=p_attempt_id and student_id=auth.uid()
  for update;

  if not found then raise exception 'Forbidden'; end if;
  if v_a.status<>'in_progress' then
    return jsonb_build_object('ok',true,'closed',true);
  end if;
  if now()>=v_a.expires_at then
    perform public._finalize_attempt(p_attempt_id,'timeout');
    return jsonb_build_object('submitted',true,'reason','timeout');
  end if;

  if p_choice is not null and p_choice not in ('A','B','C','D') then
    raise exception 'Invalid choice';
  end if;

  if not exists(
    select 1 from public.attempt_questions
    where attempt_id=p_attempt_id and question_id=p_question_id
  ) then
    raise exception 'Question not in attempt';
  end if;

  if p_client_event_id is not null then
    insert into public.answer_save_events(client_event_id,attempt_id,question_id)
    values(p_client_event_id,p_attempt_id,p_question_id)
    on conflict do nothing;
    if not found then
      return jsonb_build_object('ok',true,'duplicate',true);
    end if;
  end if;

  insert into public.answers(
    attempt_id,question_id,selected_choice_key,is_marked_review,answered_at
  ) values(
    p_attempt_id,p_question_id,p_choice,p_marked,now()
  )
  on conflict(attempt_id,question_id) do update
  set selected_choice_key=excluded.selected_choice_key,
      is_marked_review=excluded.is_marked_review,
      answered_at=now();

  return jsonb_build_object('ok',true,'duplicate',false);
end
$$;

revoke all on function public.save_answer_v2(uuid,uuid,character,boolean,uuid)
from public, anon;
grant execute on function public.save_answer_v2(uuid,uuid,character,boolean,uuid)
to authenticated;

-- Sau khi nộp, luôn cho chủ bài xem lại nội dung câu hỏi và phương án mình đã chọn.
-- Đáp án đúng/is_correct chỉ được trả về khi test cho phép hoặc người xem là staff.
create or replace function public.get_attempt_result(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.attempts%rowtype;
  v_show boolean;
  v_total int;
  v_staff boolean;
  v_can_show boolean;
begin
  select * into v_a from public.attempts where id=p_attempt_id;
  if not found or (v_a.student_id<>auth.uid() and public.current_role() not in ('teacher','system_admin')) then
    raise exception 'Forbidden';
  end if;

  if v_a.status='in_progress' and now()>=v_a.expires_at then
    perform public._finalize_attempt(p_attempt_id,'timeout');
    select * into v_a from public.attempts where id=p_attempt_id;
  end if;
  if v_a.status='in_progress' then raise exception 'Attempt is not submitted'; end if;

  select show_answers_after_submit into v_show from public.tests where id=v_a.test_id;
  v_staff:=public.current_role() in ('teacher','system_admin');
  v_can_show:=coalesce(v_show,false) or v_staff;
  select count(*)::int into v_total from public.attempt_questions where attempt_id=p_attempt_id;

  return jsonb_build_object(
    'attempt_id',v_a.id,
    'attempt_no',v_a.attempt_no,
    'status',v_a.status,
    'submission_reason',v_a.submission_reason,
    'violation_count',v_a.violation_count,
    'score',v_a.score,
    'correct_count',v_a.correct_count,
    'total_questions',v_total,
    'submitted_at',v_a.submitted_at,
    'show_answers',v_can_show,
    'answers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'number',aq.display_number,
        'question_id',q.id,
        'selected',a.selected_choice_key,
        'correct',case when v_can_show then q.correct_choice_key else null end,
        'is_correct',case when v_can_show then (a.selected_choice_key=q.correct_choice_key) else null end
      ) order by aq.display_order)
      from public.attempt_questions aq
      join public.questions q on q.id=aq.question_id
      left join public.answers a on a.attempt_id=aq.attempt_id and a.question_id=q.id
      where aq.attempt_id=p_attempt_id
    ),'[]'::jsonb),
    'questions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',q.id,
        'number',aq.display_number,
        'order',aq.display_order,
        'content',q.content,
        'part',tp.part_no,
        'stimulus_group_id',q.stimulus_group_id,
        'media_type',q.media_type,
        'storage_path',q.storage_path,
        'stimuli',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',s.id,
            'type',s.media_type,
            'content',s.content,
            'storage_path',s.storage_path
          ) order by s.sort_order)
          from public.stimuli s
          where s.stimulus_group_id=q.stimulus_group_id
        ),'[]'::jsonb),
        'choices',coalesce((
          select jsonb_agg(jsonb_build_object(
            'key',qc.choice_key,
            'content',qc.content,
            'media_type',qc.media_type,
            'storage_path',qc.storage_path
          ) order by qc.choice_key)
          from public.question_choices qc
          where qc.question_id=q.id
        ),'[]'::jsonb),
        'selected',a.selected_choice_key,
        'marked',coalesce(a.is_marked_review,false),
        'correct',case when v_can_show then q.correct_choice_key else null end,
        'is_correct',case when v_can_show then (a.selected_choice_key=q.correct_choice_key) else null end
      ) order by aq.display_order)
      from public.attempt_questions aq
      join public.questions q on q.id=aq.question_id
      join public.test_parts tp on tp.id=q.test_part_id
      left join public.answers a on a.attempt_id=aq.attempt_id and a.question_id=q.id
      where aq.attempt_id=p_attempt_id
    ),'[]'::jsonb)
  );
end
$$;

revoke all on function public.get_attempt_result(uuid)
from public, anon;
grant execute on function public.get_attempt_result(uuid)
to authenticated;

-- Khi staff xóa hẳn lượt sinh viên cuối cùng của một bài kiểm tra,
-- tự mở khóa nội dung để bài kiểm tra có thể được chỉnh sửa lại.
-- Reset lượt KHÔNG mở khóa vì bản ghi lượt cũ vẫn được giữ để đối soát.
create or replace function public.staff_delete_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.attempts%rowtype;
  p public.profiles%rowtype;
  v_remaining int;
  v_unlocked boolean:=false;
begin
  if public.current_role() not in ('teacher','system_admin') then
    raise exception 'Forbidden';
  end if;

  select * into a
  from public.attempts
  where id=p_attempt_id
  for update;
  if not found then raise exception 'Attempt not found'; end if;

  select * into p from public.profiles where id=a.student_id;

  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(
    auth.uid(),'attempt_deleted','attempt',a.id::text,
    jsonb_build_object(
      'test_id',a.test_id,
      'student_id',a.student_id,
      'student_name',p.full_name,
      'student_code',p.student_code,
      'attempt_no',a.attempt_no,
      'status',a.status,
      'score',a.score,
      'correct_count',a.correct_count,
      'started_at',a.started_at,
      'submitted_at',a.submitted_at
    )
  );

  delete from public.attempts where id=p_attempt_id;

  select count(*)::int into v_remaining
  from public.attempts
  where test_id=a.test_id;

  if v_remaining=0 then
    update public.tests
    set content_locked_at=null
    where id=a.test_id
      and content_locked_at is not null;
    v_unlocked:=found;
  end if;

  return jsonb_build_object(
    'ok',true,
    'remaining_attempts',v_remaining,
    'content_unlocked',v_unlocked
  );
end
$$;

revoke all on function public.staff_delete_attempt(uuid)
from public, anon;
grant execute on function public.staff_delete_attempt(uuid)
to authenticated;

