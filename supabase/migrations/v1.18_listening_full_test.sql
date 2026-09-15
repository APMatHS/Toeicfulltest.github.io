-- TOEIC Full Test V1.18 Modular — Listening / Full Test
-- Apply after the V1.17 backend. Existing Reading tests remain test_kind='reading'.

alter table public.tests add column if not exists test_kind text not null default 'reading';
do $$ begin
  alter table public.tests add constraint tests_test_kind_chk check (test_kind in ('listening','reading','full'));
exception when duplicate_object then null; end $$;

alter table public.test_parts add column if not exists shuffle_choices boolean not null default false;

create table if not exists public.attempt_runtime_states(
  attempt_id uuid primary key references public.attempts(id) on delete cascade,
  listening_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.attempt_audio_states(
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  unit_key text not null,
  started_at timestamptz not null default now(),
  last_position_seconds numeric not null default 0 check(last_position_seconds>=0),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(attempt_id,unit_key),
  check(length(unit_key) between 1 and 160)
);

revoke all on table public.attempt_runtime_states from public,anon,authenticated;
revoke all on table public.attempt_audio_states from public,anon,authenticated;

alter table public.staff_practice_attempts add column if not exists listening_completed_at timestamptz;

create table if not exists public.staff_practice_audio_states(
  attempt_id uuid not null references public.staff_practice_attempts(id) on delete cascade,
  unit_key text not null,
  started_at timestamptz not null default now(),
  last_position_seconds numeric not null default 0 check(last_position_seconds>=0),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(attempt_id,unit_key),
  check(length(unit_key) between 1 and 160)
);
revoke all on table public.staff_practice_audio_states from public,anon,authenticated;

create or replace function public.staff_upsert_test(p_data jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_id uuid; v_old public.tests%rowtype; v_new_class uuid; v_new_duration int;
  v_new_max int; v_new_kind text;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  v_id=nullif(p_data->>'id','')::uuid;
  v_new_kind=coalesce(nullif(p_data->>'test_kind',''),'reading');
  if v_new_kind not in ('listening','reading','full') then raise exception 'Invalid test kind'; end if;

  if v_id is null then
    insert into public.tests(
      class_id,title,description,duration_minutes,max_attempts,status,
      show_answers_after_submit,anti_cheat_mode,allowed_violations,
      opens_at,closes_at,created_by,test_kind
    ) values(
      nullif(p_data->>'class_id','')::uuid,p_data->>'title',p_data->>'description',
      coalesce(nullif(p_data->>'duration_minutes','')::int,75),
      coalesce(nullif(p_data->>'max_attempts','')::int,1),
      coalesce(nullif(p_data->>'status','')::public.test_status,'draft'),
      coalesce(nullif(p_data->>'show_answers_after_submit','')::boolean,false),
      coalesce(nullif(p_data->>'anti_cheat_mode','')::public.anti_cheat_mode,'warn_then_submit'),
      coalesce(nullif(p_data->>'allowed_violations','')::int,2),
      nullif(p_data->>'opens_at','')::timestamptz,nullif(p_data->>'closes_at','')::timestamptz,
      auth.uid(),v_new_kind
    ) returning id into v_id;
    insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values(auth.uid(),'test_created','test',v_id::text,coalesce(p_data,'{}'::jsonb));
  else
    select * into v_old from public.tests where id=v_id for update;
    if not found then raise exception 'Test not found'; end if;
    if v_old.archived_at is not null then raise exception 'Archived test cannot be edited'; end if;
    v_new_class:=case when p_data?'class_id' then nullif(p_data->>'class_id','')::uuid else v_old.class_id end;
    v_new_duration:=coalesce(nullif(p_data->>'duration_minutes','')::int,v_old.duration_minutes);
    v_new_max:=coalesce(nullif(p_data->>'max_attempts','')::int,v_old.max_attempts);
    v_new_kind:=case when p_data?'test_kind' then coalesce(nullif(p_data->>'test_kind',''),'reading') else v_old.test_kind end;
    if v_new_kind not in ('listening','reading','full') then raise exception 'Invalid test kind'; end if;
    if v_old.content_locked_at is not null then
      if v_new_class is distinct from v_old.class_id then raise exception 'Class is locked after the first student starts'; end if;
      if v_new_duration is distinct from v_old.duration_minutes then raise exception 'Duration is locked after the first student starts'; end if;
      if v_new_max < v_old.max_attempts then raise exception 'Cannot reduce max attempts after the test has started'; end if;
      if v_new_kind is distinct from v_old.test_kind then raise exception 'Test kind is locked after the first student starts'; end if;
    end if;
    update public.tests set
      class_id=v_new_class,title=coalesce(p_data->>'title',title),
      description=case when p_data?'description' then p_data->>'description' else description end,
      duration_minutes=v_new_duration,max_attempts=v_new_max,
      status=coalesce(nullif(p_data->>'status','')::public.test_status,status),
      show_answers_after_submit=coalesce(nullif(p_data->>'show_answers_after_submit','')::boolean,show_answers_after_submit),
      anti_cheat_mode=coalesce(nullif(p_data->>'anti_cheat_mode','')::public.anti_cheat_mode,anti_cheat_mode),
      allowed_violations=coalesce(nullif(p_data->>'allowed_violations','')::int,allowed_violations),
      opens_at=case when p_data?'opens_at' then nullif(p_data->>'opens_at','')::timestamptz else opens_at end,
      closes_at=case when p_data?'closes_at' then nullif(p_data->>'closes_at','')::timestamptz else closes_at end,
      test_kind=v_new_kind where id=v_id;
    insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
    values(auth.uid(),'test_updated','test',v_id::text,coalesce(p_data,'{}'::jsonb));
  end if;
  return v_id;
end $$;

create or replace function public.staff_upsert_part(p_data jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_test_id uuid;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  v_id=nullif(p_data->>'id','')::uuid;
  if v_id is null then
    v_test_id=(p_data->>'test_id')::uuid; perform public._assert_test_content_editable(v_test_id);
    insert into public.test_parts(test_id,part_no,title,shuffle_mode,shuffle_choices,sort_order)
    values(v_test_id,(p_data->>'part_no')::int,p_data->>'title',coalesce(p_data->>'shuffle_mode','fixed'),coalesce((p_data->>'shuffle_choices')::boolean,false),coalesce((p_data->>'sort_order')::int,(p_data->>'part_no')::int)) returning id into v_id;
  else
    select test_id into v_test_id from public.test_parts where id=v_id; perform public._assert_test_content_editable(v_test_id);
    update public.test_parts set
      title=coalesce(p_data->>'title',title),shuffle_mode=coalesce(p_data->>'shuffle_mode',shuffle_mode),
      shuffle_choices=coalesce((p_data->>'shuffle_choices')::boolean,shuffle_choices),
      sort_order=coalesce((p_data->>'sort_order')::int,sort_order) where id=v_id;
  end if;
  return v_id;
end $$;

create or replace function public.get_test_authoring(p_test_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  return jsonb_build_object(
    'test',(select to_jsonb(t) from public.tests t where t.id=p_test_id),
    'parts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',tp.id,'part_no',tp.part_no,'title',tp.title,'shuffle_mode',tp.shuffle_mode,
      'shuffle_choices',tp.shuffle_choices,'sort_order',tp.sort_order) order by tp.sort_order)
      from public.test_parts tp where tp.test_id=p_test_id),'[]'::jsonb),
    'questions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',q.id,'part_no',tp.part_no,'test_part_id',q.test_part_id,'source_number',q.source_number,
      'source_order',q.source_order,'content',q.content,'correct_choice_key',q.correct_choice_key,
      'score_weight',q.score_weight,'stimulus_group_id',q.stimulus_group_id,'media_type',q.media_type,
      'storage_path',q.storage_path,'choices',(select jsonb_agg(jsonb_build_object(
        'key',qc.choice_key,'content',qc.content,'media_type',qc.media_type,'storage_path',qc.storage_path)
        order by qc.choice_key) from public.question_choices qc where qc.question_id=q.id))
      order by tp.sort_order,q.source_order) from public.questions q join public.test_parts tp on tp.id=q.test_part_id
      where tp.test_id=p_test_id),'[]'::jsonb),
    'stimulus_groups',coalesce((select jsonb_agg(jsonb_build_object(
      'id',sg.id,'part_no',tp.part_no,'test_part_id',sg.test_part_id,'source_order',sg.source_order,
      'title',sg.title,'play_mode',sg.play_mode,'allow_replay',sg.allow_replay,'allow_seek',sg.allow_seek,
      'max_plays',sg.max_plays,'stimuli',(select jsonb_agg(jsonb_build_object(
        'id',s.id,'media_type',s.media_type,'content',s.content,'storage_path',s.storage_path,'sort_order',s.sort_order)
        order by s.sort_order) from public.stimuli s where s.stimulus_group_id=sg.id))
      order by tp.sort_order,sg.source_order) from public.stimulus_groups sg join public.test_parts tp on tp.id=sg.test_part_id
      where tp.test_id=p_test_id),'[]'::jsonb)
  );
end $$;

create or replace function public.get_attempt_payload(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid:=auth.uid(); v_a public.attempts%rowtype; v_mode public.anti_cheat_mode;
  v_allowed int; v_kind text; v_title text;
begin
  select * into v_a from public.attempts where id=p_attempt_id;
  if not found or (v_a.student_id<>v_uid and public.current_role() not in ('teacher','system_admin')) then raise exception 'Forbidden'; end if;
  if v_a.status='in_progress' and now()>=v_a.expires_at then perform public._finalize_attempt(p_attempt_id,'timeout'); select * into v_a from public.attempts where id=p_attempt_id; end if;
  if v_a.status<>'in_progress' then return public.get_attempt_result(p_attempt_id); end if;
  select anti_cheat_mode,allowed_violations,test_kind,title into v_mode,v_allowed,v_kind,v_title from public.tests where id=v_a.test_id;
  return jsonb_build_object(
    'attempt',jsonb_build_object('id',v_a.id,'test_id',v_a.test_id,'attempt_no',v_a.attempt_no,'status',v_a.status,
      'started_at',v_a.started_at,'expires_at',v_a.expires_at,'violation_count',v_a.violation_count,
      'anti_cheat_mode',v_mode,'allowed_violations',v_allowed,'test_kind',v_kind,'test_title',v_title),
    'questions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',q.id,'number',aq.display_number,'order',aq.display_order,'content',q.content,'part',tp.part_no,
      'shuffle_choices',tp.shuffle_choices,'stimulus_group_id',q.stimulus_group_id,'media_type',q.media_type,
      'storage_path',q.storage_path,'group_settings',(select jsonb_build_object('play_mode',sg.play_mode,
        'allow_replay',sg.allow_replay,'allow_seek',sg.allow_seek,'max_plays',sg.max_plays)
        from public.stimulus_groups sg where sg.id=q.stimulus_group_id),
      'stimuli',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'type',s.media_type,'content',s.content,'storage_path',s.storage_path) order by s.sort_order)
        from public.stimuli s where s.stimulus_group_id=q.stimulus_group_id),'[]'::jsonb),
      'choices',(select jsonb_agg(jsonb_build_object('key',qc.choice_key,'content',qc.content,'media_type',qc.media_type,'storage_path',qc.storage_path) order by qc.choice_key)
        from public.question_choices qc where qc.question_id=q.id),
      'selected',(select a.selected_choice_key from public.answers a where a.attempt_id=p_attempt_id and a.question_id=q.id),
      'marked',coalesce((select a.is_marked_review from public.answers a where a.attempt_id=p_attempt_id and a.question_id=q.id),false)) order by aq.display_order)
      from public.attempt_questions aq join public.questions q on q.id=aq.question_id join public.test_parts tp on tp.id=q.test_part_id
      where aq.attempt_id=p_attempt_id),'[]'::jsonb)
  );
end $$;

create or replace function public.get_attempt_mode_v118(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_a public.attempts%rowtype; v_kind text; v_done timestamptz;
begin
  select * into v_a from public.attempts where id=p_attempt_id;
  if not found or (v_a.student_id<>auth.uid() and public.current_role() not in ('teacher','system_admin')) then raise exception 'Forbidden'; end if;
  select test_kind into v_kind from public.tests where id=v_a.test_id;
  select listening_completed_at into v_done from public.attempt_runtime_states where attempt_id=p_attempt_id;
  return jsonb_build_object('test_kind',coalesce(v_kind,'reading'),'listening_completed_at',v_done);
end $$;

create or replace function public.get_audio_states_v118(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.attempts a where a.id=p_attempt_id and (a.student_id=auth.uid() or public.current_role() in ('teacher','system_admin'))) then raise exception 'Forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('unit_key',s.unit_key,'started_at',s.started_at,
    'last_position_seconds',s.last_position_seconds,'completed_at',s.completed_at,'updated_at',s.updated_at) order by s.started_at)
    from public.attempt_audio_states s where s.attempt_id=p_attempt_id),'[]'::jsonb);
end $$;

create or replace function public.start_audio_unit_v118(p_attempt_id uuid,p_unit_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_a public.attempts%rowtype; v_s public.attempt_audio_states%rowtype;
begin
  if p_unit_key is null or length(p_unit_key) not between 1 and 160 then raise exception 'Invalid audio unit'; end if;
  select * into v_a from public.attempts where id=p_attempt_id and student_id=auth.uid() for update;
  if not found or v_a.status<>'in_progress' then raise exception 'Attempt unavailable'; end if;
  if now()>=v_a.expires_at then perform public._finalize_attempt(p_attempt_id,'timeout'); raise exception 'Attempt expired'; end if;
  if not exists(
    select 1 from public.questions q join public.test_parts tp on tp.id=q.test_part_id
      where tp.test_id=v_a.test_id and tp.part_no between 1 and 4 and q.media_type='audio' and q.storage_path is not null and p_unit_key='question:'||q.id::text
    union all
    select 1 from public.stimuli s join public.stimulus_groups sg on sg.id=s.stimulus_group_id join public.test_parts tp on tp.id=sg.test_part_id
      where tp.test_id=v_a.test_id and tp.part_no between 1 and 4 and s.media_type='audio' and s.storage_path is not null and p_unit_key='stimulus:'||s.id::text
  ) then raise exception 'Audio unit not in attempt test'; end if;
  insert into public.attempt_audio_states(attempt_id,unit_key) values(p_attempt_id,p_unit_key) on conflict do nothing;
  select * into v_s from public.attempt_audio_states where attempt_id=p_attempt_id and unit_key=p_unit_key;
  return jsonb_build_object('unit_key',v_s.unit_key,'started_at',v_s.started_at,'last_position_seconds',v_s.last_position_seconds,'completed_at',v_s.completed_at,'updated_at',v_s.updated_at);
end $$;

create or replace function public.update_audio_unit_v118(p_attempt_id uuid,p_unit_key text,p_position_seconds numeric,p_completed boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_a public.attempts%rowtype; v_s public.attempt_audio_states%rowtype; v_pos numeric;
begin
  select * into v_a from public.attempts where id=p_attempt_id and student_id=auth.uid() for update;
  if not found or v_a.status<>'in_progress' then raise exception 'Attempt unavailable'; end if;
  if now()>=v_a.expires_at then perform public._finalize_attempt(p_attempt_id,'timeout'); raise exception 'Attempt expired'; end if;
  v_pos:=greatest(0,coalesce(p_position_seconds,0));
  select * into v_s from public.attempt_audio_states where attempt_id=p_attempt_id and unit_key=p_unit_key for update;
  if not found then raise exception 'Audio unit not started'; end if;
  update public.attempt_audio_states set last_position_seconds=greatest(last_position_seconds,v_pos),
    completed_at=case when completed_at is not null then completed_at when p_completed then now() else null end,
    updated_at=now() where attempt_id=p_attempt_id and unit_key=p_unit_key;
  select * into v_s from public.attempt_audio_states where attempt_id=p_attempt_id and unit_key=p_unit_key;
  return jsonb_build_object('unit_key',v_s.unit_key,'started_at',v_s.started_at,'last_position_seconds',v_s.last_position_seconds,'completed_at',v_s.completed_at,'updated_at',v_s.updated_at);
end $$;

create or replace function public.complete_listening_phase_v118(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_a public.attempts%rowtype; v_kind text; v_missing int;
begin
  select * into v_a from public.attempts where id=p_attempt_id and student_id=auth.uid() for update;
  if not found or v_a.status<>'in_progress' then raise exception 'Attempt unavailable'; end if;
  if now()>=v_a.expires_at then perform public._finalize_attempt(p_attempt_id,'timeout'); raise exception 'Attempt expired'; end if;
  select test_kind into v_kind from public.tests where id=v_a.test_id;
  if v_kind<>'full' then raise exception 'Not a full test'; end if;
  with audio_units as (
    select distinct case when sa.id is not null then 'stimulus:'||sa.id::text else 'question:'||q.id::text end unit_key
    from public.questions q join public.test_parts tp on tp.id=q.test_part_id
    left join lateral (
      select s.id from public.stimuli s where s.stimulus_group_id=q.stimulus_group_id and s.media_type='audio' and s.storage_path is not null
      order by s.sort_order,s.id limit 1
    ) sa on true
    where tp.test_id=v_a.test_id and tp.part_no between 1 and 4
      and (sa.id is not null or (q.media_type='audio' and q.storage_path is not null))
  ) select count(*)::int into v_missing from audio_units u where not exists(
    select 1 from public.attempt_audio_states st where st.attempt_id=p_attempt_id and st.unit_key=u.unit_key and st.completed_at is not null);
  if v_missing>0 then return jsonb_build_object('ok',false,'blocked',true,'missing_audio_units',v_missing); end if;
  insert into public.attempt_runtime_states(attempt_id,listening_completed_at,updated_at) values(p_attempt_id,now(),now())
  on conflict(attempt_id) do update set listening_completed_at=coalesce(public.attempt_runtime_states.listening_completed_at,excluded.listening_completed_at),updated_at=now();
  return jsonb_build_object('ok',true,'blocked',false,'listening_completed_at',(select listening_completed_at from public.attempt_runtime_states where attempt_id=p_attempt_id));
end $$;


create or replace function public.staff_get_practice_audio_states_v118(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  if not exists(select 1 from public.staff_practice_attempts a where a.id=p_attempt_id and a.staff_id=auth.uid()) then raise exception 'Practice attempt not found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('unit_key',s.unit_key,'started_at',s.started_at,
    'last_position_seconds',s.last_position_seconds,'completed_at',s.completed_at,'updated_at',s.updated_at) order by s.started_at)
    from public.staff_practice_audio_states s where s.attempt_id=p_attempt_id),'[]'::jsonb);
end $$;

create or replace function public.staff_start_practice_audio_unit_v118(p_attempt_id uuid,p_unit_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_a public.staff_practice_attempts%rowtype; v_s public.staff_practice_audio_states%rowtype;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  if p_unit_key is null or length(p_unit_key) not between 1 and 160 then raise exception 'Invalid audio unit'; end if;
  select * into v_a from public.staff_practice_attempts where id=p_attempt_id and staff_id=auth.uid() for update;
  if not found or v_a.status<>'in_progress' then raise exception 'Practice attempt unavailable'; end if;
  if now()>=v_a.expires_at then perform public.staff_finish_practice_attempt(p_attempt_id,'expired'); raise exception 'Practice attempt expired'; end if;
  if not exists(
    select 1 from public.questions q join public.test_parts tp on tp.id=q.test_part_id
      where tp.test_id=v_a.test_id and tp.part_no between 1 and 4 and q.media_type='audio' and q.storage_path is not null and p_unit_key='question:'||q.id::text
    union all
    select 1 from public.stimuli s join public.stimulus_groups sg on sg.id=s.stimulus_group_id join public.test_parts tp on tp.id=sg.test_part_id
      where tp.test_id=v_a.test_id and tp.part_no between 1 and 4 and s.media_type='audio' and s.storage_path is not null and p_unit_key='stimulus:'||s.id::text
  ) then raise exception 'Audio unit not in practice test'; end if;
  insert into public.staff_practice_audio_states(attempt_id,unit_key) values(p_attempt_id,p_unit_key) on conflict do nothing;
  select * into v_s from public.staff_practice_audio_states where attempt_id=p_attempt_id and unit_key=p_unit_key;
  return jsonb_build_object('unit_key',v_s.unit_key,'started_at',v_s.started_at,'last_position_seconds',v_s.last_position_seconds,'completed_at',v_s.completed_at,'updated_at',v_s.updated_at);
end $$;

create or replace function public.staff_update_practice_audio_unit_v118(p_attempt_id uuid,p_unit_key text,p_position_seconds numeric,p_completed boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_a public.staff_practice_attempts%rowtype; v_s public.staff_practice_audio_states%rowtype; v_pos numeric;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select * into v_a from public.staff_practice_attempts where id=p_attempt_id and staff_id=auth.uid() for update;
  if not found or v_a.status<>'in_progress' then raise exception 'Practice attempt unavailable'; end if;
  if now()>=v_a.expires_at then perform public.staff_finish_practice_attempt(p_attempt_id,'expired'); raise exception 'Practice attempt expired'; end if;
  v_pos:=greatest(0,coalesce(p_position_seconds,0));
  select * into v_s from public.staff_practice_audio_states where attempt_id=p_attempt_id and unit_key=p_unit_key for update;
  if not found then raise exception 'Practice audio unit not started'; end if;
  update public.staff_practice_audio_states set last_position_seconds=greatest(last_position_seconds,v_pos),
    completed_at=case when completed_at is not null then completed_at when p_completed then now() else null end,
    updated_at=now() where attempt_id=p_attempt_id and unit_key=p_unit_key;
  select * into v_s from public.staff_practice_audio_states where attempt_id=p_attempt_id and unit_key=p_unit_key;
  return jsonb_build_object('unit_key',v_s.unit_key,'started_at',v_s.started_at,'last_position_seconds',v_s.last_position_seconds,'completed_at',v_s.completed_at,'updated_at',v_s.updated_at);
end $$;

create or replace function public.staff_complete_practice_listening_v118(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_a public.staff_practice_attempts%rowtype; v_kind text; v_missing int;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select * into v_a from public.staff_practice_attempts where id=p_attempt_id and staff_id=auth.uid() for update;
  if not found or v_a.status<>'in_progress' then raise exception 'Practice attempt unavailable'; end if;
  if now()>=v_a.expires_at then perform public.staff_finish_practice_attempt(p_attempt_id,'expired'); raise exception 'Practice attempt expired'; end if;
  select test_kind into v_kind from public.tests where id=v_a.test_id; if v_kind<>'full' then raise exception 'Not a full test'; end if;
  with audio_units as (
    select distinct case when sa.id is not null then 'stimulus:'||sa.id::text else 'question:'||q.id::text end unit_key
    from public.questions q join public.test_parts tp on tp.id=q.test_part_id
    left join lateral (
      select s.id from public.stimuli s where s.stimulus_group_id=q.stimulus_group_id and s.media_type='audio' and s.storage_path is not null
      order by s.sort_order,s.id limit 1
    ) sa on true
    where tp.test_id=v_a.test_id and tp.part_no between 1 and 4
      and (sa.id is not null or (q.media_type='audio' and q.storage_path is not null))
  ) select count(*)::int into v_missing from audio_units u where not exists(
    select 1 from public.staff_practice_audio_states st where st.attempt_id=p_attempt_id and st.unit_key=u.unit_key and st.completed_at is not null);
  if v_missing>0 then return jsonb_build_object('ok',false,'blocked',true,'missing_audio_units',v_missing); end if;
  update public.staff_practice_attempts set listening_completed_at=coalesce(listening_completed_at,now()) where id=p_attempt_id;
  return jsonb_build_object('ok',true,'blocked',false,'listening_completed_at',(select listening_completed_at from public.staff_practice_attempts where id=p_attempt_id));
end $$;

-- V1.18: include shuffle_choices so review reproduces the exact Listening choice order.
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
        'shuffle_choices',tp.shuffle_choices,
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



create or replace function public.staff_preflight_test(p_test_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_t public.tests%rowtype; v_q int; v_bad_choices int; v_bad_correct int; v_static_media int;
  v_attempts int; v_students int; v_p1 int; v_p2 int; v_p3 int; v_p4 int; v_p5 int; v_p6 int; v_p7 int;
  v_required_ok boolean; v_standard boolean; v_label text; v_audio_parts int:=0; v_missing_audio_q int:=0;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select * into v_t from public.tests where id=p_test_id; if not found then raise exception 'Test not found'; end if;
  select count(*)::int,count(*) filter(where tp.part_no=1)::int,count(*) filter(where tp.part_no=2)::int,
    count(*) filter(where tp.part_no=3)::int,count(*) filter(where tp.part_no=4)::int,count(*) filter(where tp.part_no=5)::int,
    count(*) filter(where tp.part_no=6)::int,count(*) filter(where tp.part_no=7)::int
    into v_q,v_p1,v_p2,v_p3,v_p4,v_p5,v_p6,v_p7 from public.questions q join public.test_parts tp on tp.id=q.test_part_id where tp.test_id=p_test_id;
  select count(*)::int into v_bad_choices from public.questions q join public.test_parts tp on tp.id=q.test_part_id
    where tp.test_id=p_test_id and (select count(*) from public.question_choices c where c.question_id=q.id)<>case when tp.part_no=2 then 3 else 4 end;
  select count(*)::int into v_bad_correct from public.questions q join public.test_parts tp on tp.id=q.test_part_id
    where tp.test_id=p_test_id and not exists(select 1 from public.question_choices c where c.question_id=q.id and c.choice_key=q.correct_choice_key);
  select count(*)::int into v_static_media from public.stimuli s join public.stimulus_groups sg on sg.id=s.stimulus_group_id
    join public.test_parts tp on tp.id=sg.test_part_id where tp.test_id=p_test_id and s.storage_path like 'static:%';
  select count(*)::int into v_attempts from public.attempts where test_id=p_test_id;
  select count(*)::int into v_students from public.class_members cm join public.profiles p on p.id=cm.user_id
    where cm.class_id=v_t.class_id and p.role='student' and coalesce(p.is_active,true)=true;
  select count(distinct part_no)::int into v_audio_parts from (
    select tp.part_no from public.questions q join public.test_parts tp on tp.id=q.test_part_id
      where tp.test_id=p_test_id and tp.part_no between 1 and 4 and q.media_type='audio' and q.storage_path is not null
    union
    select tp.part_no from public.stimuli s join public.stimulus_groups sg on sg.id=s.stimulus_group_id
      join public.test_parts tp on tp.id=sg.test_part_id where tp.test_id=p_test_id and tp.part_no between 1 and 4 and s.media_type='audio' and s.storage_path is not null
  ) audio_parts;
  select count(*)::int into v_missing_audio_q from public.questions q join public.test_parts tp on tp.id=q.test_part_id
    where tp.test_id=p_test_id and tp.part_no between 1 and 4 and not(
      (q.media_type='audio' and q.storage_path is not null) or exists(
        select 1 from public.stimuli s where s.stimulus_group_id=q.stimulus_group_id and s.media_type='audio' and s.storage_path is not null));

  if v_t.test_kind='listening' then
    v_required_ok:=v_p1>0 and v_p2>0 and v_p3>0 and v_p4>0 and v_audio_parts=4 and v_missing_audio_q=0;
    v_standard:=v_p1=6 and v_p2=25 and v_p3=39 and v_p4=30 and v_q=100;
    v_label:=format('Listening: P1=%s, P2=%s, P3=%s, P4=%s',v_p1,v_p2,v_p3,v_p4);
  elsif v_t.test_kind='full' then
    v_required_ok:=v_p1>0 and v_p2>0 and v_p3>0 and v_p4>0 and v_p5>0 and v_p6>0 and v_p7>0 and v_audio_parts=4 and v_missing_audio_q=0;
    v_standard:=v_p1=6 and v_p2=25 and v_p3=39 and v_p4=30 and v_p5=30 and v_p6=16 and v_p7=54 and v_q=200;
    v_label:=format('Full: P1=%s, P2=%s, P3=%s, P4=%s, P5=%s, P6=%s, P7=%s',v_p1,v_p2,v_p3,v_p4,v_p5,v_p6,v_p7);
  else
    v_required_ok:=v_p5>0 and v_p6>0 and v_p7>0;
    v_standard:=v_p5=30 and v_p6=16 and v_p7=54 and v_q=100;
    v_label:=format('Reading: P5=%s, P6=%s, P7=%s',v_p5,v_p6,v_p7);
  end if;
  return jsonb_build_object(
    'ok',(v_t.class_id is not null and v_students>0 and v_q>0 and v_required_ok and v_bad_choices=0 and v_bad_correct=0 and not(v_t.opens_at is not null and v_t.closes_at is not null and v_t.closes_at<=v_t.opens_at)),
    'test_kind',v_t.test_kind,'question_count',v_q,'part1_count',v_p1,'part2_count',v_p2,'part3_count',v_p3,
    'part4_count',v_p4,'part5_count',v_p5,'part6_count',v_p6,'part7_count',v_p7,'structure_complete',v_required_ok,
    'structure_standard',v_standard,'structure_label',v_label,'listening_audio_parts',v_audio_parts,'missing_listening_audio_questions',v_missing_audio_q,
    'reading_standard',(v_t.test_kind='reading' and v_standard),'missing_or_extra_choices',v_bad_choices,'invalid_correct_choice',v_bad_correct,
    'class_missing',(v_t.class_id is null),'active_student_count',v_students,'class_empty',(v_students=0),
    'schedule_invalid',(v_t.opens_at is not null and v_t.closes_at is not null and v_t.closes_at<=v_t.opens_at),
    'static_media_count',v_static_media,'attempt_count',v_attempts,'show_answers_after_submit',v_t.show_answers_after_submit,
    'content_locked',(v_t.content_locked_at is not null),'content_locked_at',v_t.content_locked_at
  );
end $$;

create or replace function public.staff_clone_test(p_source_test_id uuid,p_overrides jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  s public.tests%rowtype; new_test uuid; sp public.test_parts%rowtype; np uuid;
  sg public.stimulus_groups%rowtype; ng uuid; q public.questions%rowtype; nq uuid; mapped_group uuid;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select * into s from public.tests where id=p_source_test_id; if not found then raise exception 'Source test not found'; end if;
  insert into public.tests(class_id,title,description,duration_minutes,max_attempts,status,show_answers_after_submit,anti_cheat_mode,allowed_violations,opens_at,closes_at,created_by,test_kind)
  values(case when p_overrides?'class_id' then nullif(p_overrides->>'class_id','')::uuid else s.class_id end,
    coalesce(nullif(p_overrides->>'title',''),s.title||' - Bản sao'),coalesce(p_overrides->>'description',s.description),
    coalesce(nullif(p_overrides->>'duration_minutes','')::int,s.duration_minutes),coalesce(nullif(p_overrides->>'max_attempts','')::int,s.max_attempts),
    'draft',coalesce(nullif(p_overrides->>'show_answers_after_submit','')::boolean,s.show_answers_after_submit),
    coalesce(nullif(p_overrides->>'anti_cheat_mode','')::public.anti_cheat_mode,s.anti_cheat_mode),
    coalesce(nullif(p_overrides->>'allowed_violations','')::int,s.allowed_violations),nullif(p_overrides->>'opens_at','')::timestamptz,
    nullif(p_overrides->>'closes_at','')::timestamptz,auth.uid(),s.test_kind) returning id into new_test;
  create temporary table if not exists tmp_group_map(old_id uuid primary key,new_id uuid) on commit drop; truncate tmp_group_map;
  for sp in select * from public.test_parts where test_id=p_source_test_id order by sort_order loop
    insert into public.test_parts(test_id,part_no,title,shuffle_mode,shuffle_choices,sort_order)
    values(new_test,sp.part_no,sp.title,sp.shuffle_mode,sp.shuffle_choices,sp.sort_order) returning id into np;
    for sg in select * from public.stimulus_groups where test_part_id=sp.id order by source_order loop
      insert into public.stimulus_groups(test_part_id,source_order,title,play_mode,allow_replay,allow_seek,max_plays)
      values(np,sg.source_order,sg.title,sg.play_mode,sg.allow_replay,sg.allow_seek,sg.max_plays) returning id into ng;
      insert into tmp_group_map values(sg.id,ng);
      insert into public.stimuli(stimulus_group_id,media_type,content,storage_path,sort_order)
      select ng,media_type,content,storage_path,sort_order from public.stimuli where stimulus_group_id=sg.id;
    end loop;
    for q in select * from public.questions where test_part_id=sp.id order by source_order loop
      mapped_group:=null; if q.stimulus_group_id is not null then select new_id into mapped_group from tmp_group_map where old_id=q.stimulus_group_id; end if;
      insert into public.questions(test_part_id,stimulus_group_id,source_number,source_order,content,score_weight,correct_choice_key,media_type,storage_path)
      values(np,mapped_group,q.source_number,q.source_order,q.content,q.score_weight,q.correct_choice_key,q.media_type,q.storage_path) returning id into nq;
      insert into public.question_choices(question_id,choice_key,content,media_type,storage_path)
      select nq,choice_key,content,media_type,storage_path from public.question_choices where question_id=q.id;
    end loop;
  end loop;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(auth.uid(),'test_cloned','test',new_test::text,jsonb_build_object('source_test_id',p_source_test_id));
  return new_test;
end $$;

revoke all on function public.staff_get_practice_audio_states_v118(uuid) from public,anon;
revoke all on function public.staff_start_practice_audio_unit_v118(uuid,text) from public,anon;
revoke all on function public.staff_update_practice_audio_unit_v118(uuid,text,numeric,boolean) from public,anon;
revoke all on function public.staff_complete_practice_listening_v118(uuid) from public,anon;
grant execute on function public.staff_get_practice_audio_states_v118(uuid) to authenticated;
grant execute on function public.staff_start_practice_audio_unit_v118(uuid,text) to authenticated;
grant execute on function public.staff_update_practice_audio_unit_v118(uuid,text,numeric,boolean) to authenticated;
grant execute on function public.staff_complete_practice_listening_v118(uuid) to authenticated;

revoke all on function public.get_attempt_mode_v118(uuid) from public,anon;
revoke all on function public.get_audio_states_v118(uuid) from public,anon;
revoke all on function public.start_audio_unit_v118(uuid,text) from public,anon;
revoke all on function public.update_audio_unit_v118(uuid,text,numeric,boolean) from public,anon;
revoke all on function public.complete_listening_phase_v118(uuid) from public,anon;
grant execute on function public.get_attempt_mode_v118(uuid) to authenticated;
grant execute on function public.get_audio_states_v118(uuid) to authenticated;
grant execute on function public.start_audio_unit_v118(uuid,text) to authenticated;
grant execute on function public.update_audio_unit_v118(uuid,text,numeric,boolean) to authenticated;
grant execute on function public.complete_listening_phase_v118(uuid) to authenticated;
