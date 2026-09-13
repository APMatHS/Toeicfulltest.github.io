-- TOEIC Full Test — V1.9
-- Chính sách chống gian lận mặc định:
--   * chỉ tính khi rời tab/cửa sổ > 30 giây;
--   * 2 lần đầu cảnh báo;
--   * lần thứ 3 tự động nộp;
--   * fullscreen_exit riêng lẻ không còn được tính là một vi phạm.
--
-- Chạy file này SAU KHI frontend V1.9 đã được triển khai.

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
  v_duration numeric;
  v_policy text;
begin
  if p_event_type not in ('tab_hidden','fullscreen_exit','window_blur') then
    raise exception 'Invalid event';
  end if;

  select * into v_a
  from public.attempts
  where id=p_attempt_id and student_id=auth.uid()
  for update;

  if not found or v_a.status<>'in_progress' then
    raise exception 'Attempt unavailable';
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

  -- V1.9 chỉ chấp nhận một "phiên rời màn hình" có thời lượng đo được.
  -- Nhờ vậy event tức thời của frontend V1.8 hoặc fullscreen_exit riêng lẻ
  -- không còn làm tăng vi phạm.
  v_policy:=coalesce(p_details->>'policy','');
  if v_policy<>'v1.9_30s_grace' then
    return jsonb_build_object(
      'violation_count',v_a.violation_count,
      'submitted',false,
      'warning',false,
      'ignored',true,
      'reason','legacy_or_unmeasured_event'
    );
  end if;

  begin
    v_duration:=nullif(p_details->>'duration_seconds','')::numeric;
  exception when others then
    v_duration:=null;
  end;

  if v_duration is null or v_duration<=30 then
    return jsonb_build_object(
      'violation_count',v_a.violation_count,
      'submitted',false,
      'warning',false,
      'ignored',true,
      'reason','within_30_second_grace'
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
      'limit',case when v_mode='strict' then 1 else 3 end
    );
  end if;

  return jsonb_build_object(
    'violation_count',v_new,
    'submitted',false,
    'duplicate',false,
    'warning',true,
    'limit',case when v_mode='strict' then 1 else 3 end,
    'remaining',case when v_mode='strict' then 0 else greatest(0,3-v_new) end
  );
end
$$;

revoke all on function public.register_violation_v2(uuid,text,jsonb,uuid)
from public, anon;
grant execute on function public.register_violation_v2(uuid,text,jsonb,uuid)
to authenticated;

-- V1.9: cho phép lưu trạng thái "đánh dấu xem lại" ngay cả khi chưa chọn A/B/C/D.
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
