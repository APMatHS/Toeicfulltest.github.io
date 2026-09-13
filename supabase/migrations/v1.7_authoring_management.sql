-- TOEIC Full Test V1.7: safe deletion for the authoring screen.

create or replace function public.staff_delete_question(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_test_id uuid;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select tp.test_id into v_test_id
  from public.questions q join public.test_parts tp on tp.id=q.test_part_id
  where q.id=p_question_id;
  if v_test_id is null then raise exception 'Question not found'; end if;
  perform public._assert_test_content_editable(v_test_id);
  delete from public.questions where id=p_question_id;
end;
$$;

create or replace function public.staff_delete_stimulus(p_stimulus_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_test_id uuid;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select tp.test_id into v_test_id
  from public.stimuli s
  join public.stimulus_groups sg on sg.id=s.stimulus_group_id
  join public.test_parts tp on tp.id=sg.test_part_id
  where s.id=p_stimulus_id;
  if v_test_id is null then raise exception 'Stimulus not found'; end if;
  perform public._assert_test_content_editable(v_test_id);
  delete from public.stimuli where id=p_stimulus_id;
end;
$$;

create or replace function public.staff_delete_stimulus_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_test_id uuid;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select tp.test_id into v_test_id
  from public.stimulus_groups sg join public.test_parts tp on tp.id=sg.test_part_id
  where sg.id=p_group_id;
  if v_test_id is null then raise exception 'Stimulus group not found'; end if;
  perform public._assert_test_content_editable(v_test_id);
  delete from public.stimulus_groups where id=p_group_id;
end;
$$;

revoke all on function public.staff_delete_question(uuid) from public;
revoke all on function public.staff_delete_stimulus(uuid) from public;
revoke all on function public.staff_delete_stimulus_group(uuid) from public;
revoke all on function public.staff_delete_question(uuid) from anon;
revoke all on function public.staff_delete_stimulus(uuid) from anon;
revoke all on function public.staff_delete_stimulus_group(uuid) from anon;
grant execute on function public.staff_delete_question(uuid) to authenticated;
grant execute on function public.staff_delete_stimulus(uuid) to authenticated;
grant execute on function public.staff_delete_stimulus_group(uuid) to authenticated;
