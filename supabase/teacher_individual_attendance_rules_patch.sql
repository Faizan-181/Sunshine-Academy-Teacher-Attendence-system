-- Production migration: per-teacher attendance schedule overrides.
alter table public.teachers add column if not exists attendance_start_time time;
alter table public.teachers add column if not exists attendance_grace_minutes integer;
alter table public.teachers add column if not exists auto_absent_mode text not null default 'school';
alter table public.teachers add column if not exists auto_absent_time time;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.teachers'::regclass and conname = 'teachers_attendance_grace_minutes_check') then
    alter table public.teachers add constraint teachers_attendance_grace_minutes_check
      check (attendance_grace_minutes is null or attendance_grace_minutes between 0 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.teachers'::regclass and conname = 'teachers_auto_absent_mode_check') then
    alter table public.teachers add constraint teachers_auto_absent_mode_check
      check (auto_absent_mode in ('school', 'custom', 'off'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.teachers'::regclass and conname = 'teachers_auto_absent_time_mode_check') then
    alter table public.teachers add constraint teachers_auto_absent_time_mode_check
      check ((auto_absent_mode = 'custom') = (auto_absent_time is not null));
  end if;
end $$;
-- 8. Per-teacher attendance schedules. NULL start/grace values inherit the school defaults.
-- auto_absent_mode is school, custom (requires auto_absent_time), or off.
create or replace function private.teacher_start_time(p_teacher bigint) returns time
language sql stable security definer set search_path = '' as $$
  select coalesce(t.attendance_start_time,
    case when coalesce(private.setting('school_start', '08:00'), '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      then private.setting('school_start', '08:00')::time else time '08:00' end)
  from public.teachers t where t.id = p_teacher
$$;

create or replace function private.teacher_grace_minutes(p_teacher bigint) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(t.attendance_grace_minutes,
    case when coalesce(private.setting('grace_minutes', '15'), '') ~ '^[0-9]{1,3}$'
           and private.setting('grace_minutes', '15')::integer between 0 and 120
      then private.setting('grace_minutes', '15')::integer else 15 end)
  from public.teachers t where t.id = p_teacher
$$;

create or replace function private.on_time_limit(p_teacher bigint) returns integer
language sql stable security definer set search_path = '' as $$
  select least(private.minutes_of(private.teacher_start_time(p_teacher))
    + private.teacher_grace_minutes(p_teacher), 23 * 60 + 59)
$$;

create or replace function private.teacher_absent_cutoff(p_teacher bigint) returns time
language sql stable security definer set search_path = '' as $$
  select case
    when t.auto_absent_mode = 'off' then null::time
    when t.auto_absent_mode = 'custom' then t.auto_absent_time
    else case when coalesce(private.setting('auto_absent_time', ''), '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      then private.setting('auto_absent_time', '')::time else null::time end
  end
  from public.teachers t where t.id = p_teacher
$$;

create or replace function private.teacher_rules_json(p_teacher bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'startTime', to_char(private.teacher_start_time(p_teacher), 'HH24:MI'),
    'graceMinutes', private.teacher_grace_minutes(p_teacher),
    'selfCheckin', private.setting('self_checkin', '1') = '1',
    'lateAfter', lpad((private.on_time_limit(p_teacher) / 60)::text, 2, '0') || ':' || lpad((private.on_time_limit(p_teacher) % 60)::text, 2, '0'),
    'timezone', private.academy_tz(),
    'autoAbsentTime', coalesce(to_char(private.teacher_absent_cutoff(p_teacher), 'HH24:MI'), ''),
    'weeklyOffDays', coalesce((
      select jsonb_agg(day::integer order by ordinal)
      from unnest(string_to_array(private.setting('weekly_off_days', '0'), ',')) with ordinality as days(day, ordinal)
    ), '[]'::jsonb))
$$;

create or replace function private.normalize_teacher_attendance_rules(
  p_rules jsonb,
  p_school_start text default null,
  p_school_grace integer default null,
  p_school_cutoff text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_start time;
  v_grace_text text;
  v_grace integer;
  v_mode text;
  v_custom_cutoff time;
  v_effective_cutoff time;
  v_school_start time;
  v_school_grace integer;
  v_school_cutoff text;
  v_effective_start time;
  v_effective_grace integer;
begin
  if coalesce(jsonb_typeof(p_rules), 'null') <> 'object' then
    perform private.fail(400, 'Enter valid teacher attendance rules.');
  end if;

  v_school_start := private.parse_time(coalesce(nullif(p_school_start, ''), private.setting('school_start', '08:00')), 'schoolStart');
  v_school_grace := coalesce(p_school_grace, nullif(private.setting('grace_minutes', '15'), '')::integer, 15);
  v_school_cutoff := case when p_school_cutoff is null then private.setting('auto_absent_time', '') else p_school_cutoff end;

  v_start := private.parse_time(nullif(trim(coalesce(p_rules ->> 'startTime', '')), ''), 'startTimeOverride');
  v_grace_text := nullif(trim(coalesce(p_rules ->> 'graceMinutes', '')), '');
  if v_grace_text is not null then
    if v_grace_text !~ '^[0-9]{1,3}$' then perform private.fail(400, 'Enter a whole number of minutes (0-120), or leave blank for the school default.', 'graceMinutesOverride'); end if;
    v_grace := v_grace_text::integer;
    if v_grace not between 0 and 120 then perform private.fail(400, 'Enter a whole number of minutes (0-120), or leave blank for the school default.', 'graceMinutesOverride'); end if;
  end if;

  v_mode := coalesce(nullif(trim(p_rules ->> 'autoAbsentMode'), ''), 'school');
  if v_mode not in ('school', 'custom', 'off') then
    perform private.fail(400, 'Choose a valid automatic absent rule.', 'autoAbsentMode');
  end if;
  if v_mode = 'custom' then
    v_custom_cutoff := private.parse_time(nullif(trim(coalesce(p_rules ->> 'autoAbsentTime', '')), ''), 'autoAbsentTime');
    if v_custom_cutoff is null then perform private.fail(400, 'Choose a custom absent cutoff time.', 'autoAbsentTime'); end if;
    v_effective_cutoff := v_custom_cutoff;
  elsif v_mode = 'school' then
    v_effective_cutoff := private.parse_time(nullif(trim(coalesce(v_school_cutoff, '')), ''), 'autoAbsentTime');
  end if;

  v_effective_start := coalesce(v_start, v_school_start);
  v_effective_grace := coalesce(v_grace, v_school_grace);
  if v_effective_cutoff is not null and private.minutes_of(v_effective_cutoff) <= least(
    private.minutes_of(v_effective_start) + v_effective_grace, 23 * 60 + 59
  ) then
    perform private.fail(400, 'The absent cutoff must be later than this teacher’s start time and grace period.', 'autoAbsentTime');
  end if;

  return jsonb_build_object(
    'attendanceStartTime', coalesce(to_char(v_start, 'HH24:MI'), ''),
    'attendanceGraceMinutes', v_grace,
    'autoAbsentMode', v_mode,
    'autoAbsentTime', coalesce(to_char(v_custom_cutoff, 'HH24:MI'), '')
  );
end
$$;

create or replace function private.teacher_json(t public.teachers) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'teacher_id', t.teacher_id, 'name', t.name, 'email', t.email, 'phone', t.phone,
    'subject', t.subject, 'date_of_birth', coalesce(to_char(t.date_of_birth, 'YYYY-MM-DD'), ''),
    'joining_date', to_char(t.joining_date, 'YYYY-MM-DD'), 'leaving_date', coalesce(to_char(t.leaving_date, 'YYYY-MM-DD'), ''),
    'address', t.address, 'status', t.status,
    'attendance_start_time', coalesce(to_char(t.attendance_start_time, 'HH24:MI'), ''),
    'attendance_grace_minutes', t.attendance_grace_minutes,
    'auto_absent_mode', t.auto_absent_mode,
    'auto_absent_time', coalesce(to_char(t.auto_absent_time, 'HH24:MI'), ''),
    'created_at', t.created_at, 'updated_at', t.updated_at)
$$;

create or replace function private.teachers_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_action text;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_sens text[] := '{}';
begin
  if private.is_importing() then return new; end if;
  if new.status is distinct from old.status then
    v_action := case
      when old.status = 'pending' and new.status = 'active' then 'teacher_approved'
      when new.status = 'rejected' then 'teacher_rejected'
      when new.status = 'active' then 'teacher_activated'
      when new.status = 'inactive' then 'teacher_deactivated'
      else 'teacher_status_changed' end;
    v_old := v_old || jsonb_build_object('status', old.status);
    v_new := v_new || jsonb_build_object('status', new.status);
  end if;
  if new.name is distinct from old.name then v_old := v_old || jsonb_build_object('name', old.name); v_new := v_new || jsonb_build_object('name', new.name); end if;
  if new.teacher_id is distinct from old.teacher_id then v_old := v_old || jsonb_build_object('teacher_id', old.teacher_id); v_new := v_new || jsonb_build_object('teacher_id', new.teacher_id); end if;
  if new.subject is distinct from old.subject then v_old := v_old || jsonb_build_object('subject', old.subject); v_new := v_new || jsonb_build_object('subject', new.subject); end if;
  if new.joining_date is distinct from old.joining_date then v_old := v_old || jsonb_build_object('joining_date', old.joining_date); v_new := v_new || jsonb_build_object('joining_date', new.joining_date); end if;
  if new.attendance_start_time is distinct from old.attendance_start_time then v_old := v_old || jsonb_build_object('attendance_start_time', old.attendance_start_time); v_new := v_new || jsonb_build_object('attendance_start_time', new.attendance_start_time); end if;
  if new.attendance_grace_minutes is distinct from old.attendance_grace_minutes then v_old := v_old || jsonb_build_object('attendance_grace_minutes', old.attendance_grace_minutes); v_new := v_new || jsonb_build_object('attendance_grace_minutes', new.attendance_grace_minutes); end if;
  if new.auto_absent_mode is distinct from old.auto_absent_mode then v_old := v_old || jsonb_build_object('auto_absent_mode', old.auto_absent_mode); v_new := v_new || jsonb_build_object('auto_absent_mode', new.auto_absent_mode); end if;
  if new.auto_absent_time is distinct from old.auto_absent_time then v_old := v_old || jsonb_build_object('auto_absent_time', old.auto_absent_time); v_new := v_new || jsonb_build_object('auto_absent_time', new.auto_absent_time); end if;
  if new.phone is distinct from old.phone then v_sens := array_append(v_sens, 'phone'); end if;
  if new.address is distinct from old.address then v_sens := array_append(v_sens, 'address'); end if;
  if new.date_of_birth is distinct from old.date_of_birth then v_sens := array_append(v_sens, 'date_of_birth'); end if;
  if v_new = '{}'::jsonb and cardinality(v_sens) = 0 then return new; end if;
  if cardinality(v_sens) > 0 then v_new := v_new || jsonb_build_object('sensitive_fields_changed', to_jsonb(v_sens)); end if;
  perform private.audit(auth.uid(), coalesce(v_action, 'teacher_updated'), 'teacher', new.id::text, v_old, v_new);
  return new;
end
$$;

create or replace function private.attendance_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_school_start text;
  v_start time;
begin
  if tg_op = 'UPDATE' and (new.teacher_id is distinct from old.teacher_id or new.attendance_date is distinct from old.attendance_date) then
    raise exception 'The teacher and date cannot be changed.' using errcode = 'PT400';
  end if;
  if not private.is_importing() and new.attendance_date > private.academy_today() then
    raise exception 'You cannot record attendance for a future date.' using errcode = 'PT400';
  end if;
  v_school_start := coalesce(private.setting('school_start', '08:00'), '08:00');
  if v_school_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then v_start := v_school_start::time; else v_start := time '08:00'; end if;
  select coalesce(t.attendance_start_time, v_start) into v_start from public.teachers t where t.id = new.teacher_id;
  if new.status = 'late' and new.check_in is not null then
    new.late_minutes := greatest(0, private.minutes_of(new.check_in) - private.minutes_of(v_start));
  else
    new.late_minutes := 0;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end
$$;

create or replace function public.admin_precheck_new_teacher(
  p_teacher_id text, p_name text, p_email text, p_phone text, p_subject text,
  p_date_of_birth text, p_joining_date text, p_address text, p_status text,
  p_attendance_rules jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_rules jsonb; v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not private.is_admin() then perform private.fail(403, 'You don’t have permission to do that.'); end if;
  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 120 then perform private.fail(400, 'Enter a valid email address.', 'email'); end if;
  v := private.validate_teacher_input(p_teacher_id, p_name, p_phone, p_subject, p_date_of_birth, p_joining_date, p_address, coalesce(nullif(p_status, ''), 'active'));
  if v ->> 'status' not in ('active', 'inactive') then perform private.fail(400, 'Choose a status.', 'status'); end if;
  v_rules := private.normalize_teacher_attendance_rules(p_attendance_rules);
  if exists (select 1 from public.teachers t where t.teacher_id = v ->> 'teacher_id') then perform private.fail(409, 'This Teacher ID is already in use.', 'teacher_id'); end if;
  if exists (select 1 from public.teachers t where lower(t.email) = v_email) or exists (select 1 from auth.users u where lower(u.email) = v_email) then perform private.fail(409, 'This email is already in use.', 'email'); end if;
  return true;
end
$$;

create or replace function public.admin_update_teacher(
  p_id bigint, p_teacher_id text, p_name text, p_phone text, p_subject text,
  p_date_of_birth text, p_joining_date text, p_address text, p_status text,
  p_attendance_rules jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_rules jsonb; v_t public.teachers;
begin
  if not private.is_admin() then perform private.fail(403, 'You don’t have permission to do that.'); end if;
  v := private.validate_teacher_input(p_teacher_id, p_name, p_phone, p_subject, p_date_of_birth, p_joining_date, p_address, p_status);
  v_rules := private.normalize_teacher_attendance_rules(p_attendance_rules);
  begin
    update public.teachers set
      teacher_id = v ->> 'teacher_id', name = v ->> 'name', phone = v ->> 'phone', subject = v ->> 'subject',
      date_of_birth = nullif(v ->> 'date_of_birth', '')::date, joining_date = (v ->> 'joining_date')::date,
      address = v ->> 'address', status = v ->> 'status',
      attendance_start_time = nullif(v_rules ->> 'attendanceStartTime', '')::time,
      attendance_grace_minutes = nullif(v_rules ->> 'attendanceGraceMinutes', '')::integer,
      auto_absent_mode = v_rules ->> 'autoAbsentMode',
      auto_absent_time = nullif(v_rules ->> 'autoAbsentTime', '')::time
    where id = p_id returning * into v_t;
  exception when unique_violation then perform private.fail(409, 'This Teacher ID is already in use.', 'teacher_id');
  end;
  if v_t.id is null then perform private.fail(404, 'We could not find that teacher.'); end if;
  return jsonb_build_object('message', 'Teacher updated successfully.', 'data', private.teacher_json(v_t));
end
$$;

create or replace function public.admin_complete_new_teacher(
  p_auth_user_id uuid, p_teacher_id text, p_name text, p_phone text, p_subject text,
  p_date_of_birth text, p_joining_date text, p_address text, p_status text,
  p_attendance_rules jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_rules jsonb; v_t public.teachers; v_id bigint;
begin
  if not private.is_admin() then perform private.fail(403, 'You don’t have permission to do that.'); end if;
  v := private.validate_teacher_input(p_teacher_id, p_name, p_phone, p_subject, p_date_of_birth, p_joining_date, p_address, coalesce(nullif(p_status, ''), 'active'));
  if v ->> 'status' not in ('active', 'inactive') then perform private.fail(400, 'Choose a status.', 'status'); end if;
  v_rules := private.normalize_teacher_attendance_rules(p_attendance_rules);
  select id into v_id from public.teachers where auth_user_id = p_auth_user_id and status = 'pending' for update;
  if v_id is null then perform private.fail(409, 'We could not finish creating this teacher. Please check the Teachers page.'); end if;
  begin
    update public.teachers set
      teacher_id = v ->> 'teacher_id', name = v ->> 'name', phone = v ->> 'phone', subject = v ->> 'subject',
      date_of_birth = nullif(v ->> 'date_of_birth', '')::date, joining_date = (v ->> 'joining_date')::date,
      address = v ->> 'address', status = v ->> 'status',
      attendance_start_time = nullif(v_rules ->> 'attendanceStartTime', '')::time,
      attendance_grace_minutes = nullif(v_rules ->> 'attendanceGraceMinutes', '')::integer,
      auto_absent_mode = v_rules ->> 'autoAbsentMode',
      auto_absent_time = nullif(v_rules ->> 'autoAbsentTime', '')::time
    where id = v_id returning * into v_t;
  exception when unique_violation then perform private.fail(409, 'This Teacher ID is already in use.', 'teacher_id');
  end;
  return jsonb_build_object('message', 'Teacher added successfully.', 'data', private.teacher_json(v_t));
end
$$;

create or replace function public.admin_update_attendance_rules(
  p_start_time text, p_grace_minutes integer, p_self_checkin boolean,
  p_auto_absent_time text, p_weekly_off_days integer[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_cutoff text := coalesce(p_auto_absent_time, '');
  v_days integer[];
  v_cutoff_minutes integer;
begin
  if not private.is_admin() then perform private.fail(403, 'You don’t have permission to do that.'); end if;
  if coalesce(p_start_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform private.fail(400, 'Choose the time school starts.', 'startTime'); end if;
  if p_grace_minutes is null or p_grace_minutes not between 0 and 120 then perform private.fail(400, 'Enter a whole number of minutes (0-120).', 'graceMinutes'); end if;
  if v_cutoff <> '' and v_cutoff !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform private.fail(400, 'Choose a valid automatic absent time.', 'autoAbsentTime'); end if;
  if p_weekly_off_days is null or exists (select 1 from unnest(p_weekly_off_days) d where d < 0 or d > 6) then perform private.fail(400, 'Choose valid weekly off days.'); end if;
  select coalesce(array_agg(day order by day), array[]::integer[]) into v_days
    from (select distinct d as day from unnest(p_weekly_off_days) d) choices;

  if v_cutoff <> '' then
    v_cutoff_minutes := private.minutes_of(v_cutoff::time);
    if v_cutoff_minutes <= least(private.minutes_of(p_start_time::time) + p_grace_minutes, 23 * 60 + 59) then
      perform private.fail(400, 'Choose a time later than the school late threshold.', 'autoAbsentTime');
    end if;
  end if;
  if exists (
    select 1 from public.teachers t
    where t.status = 'active' and t.auto_absent_mode = 'custom'
      and private.minutes_of(t.auto_absent_time) <= least(
        private.minutes_of(coalesce(t.attendance_start_time, p_start_time::time))
          + coalesce(t.attendance_grace_minutes, p_grace_minutes), 23 * 60 + 59)
  ) then
    perform private.fail(400, 'The new school hours would make a custom teacher absent cutoff too early. Update that teacher’s schedule first.', 'autoAbsentTime');
  end if;
  if v_cutoff <> '' and exists (
    select 1 from public.teachers t
    where t.status = 'active' and t.auto_absent_mode = 'school'
      and private.minutes_of(v_cutoff::time) <= least(
        private.minutes_of(coalesce(t.attendance_start_time, p_start_time::time))
          + coalesce(t.attendance_grace_minutes, p_grace_minutes), 23 * 60 + 59)
  ) then
    perform private.fail(400, 'This school absent cutoff is too early for one or more teachers. Set a later teacher cutoff or turn automatic absent off for them.', 'autoAbsentTime');
  end if;

  insert into public.settings (name, value, updated_by) values ('school_start', p_start_time, v_uid)
    on conflict (name) do update set value = excluded.value, updated_by = excluded.updated_by;
  insert into public.settings (name, value, updated_by) values ('grace_minutes', p_grace_minutes::text, v_uid)
    on conflict (name) do update set value = excluded.value, updated_by = excluded.updated_by;
  insert into public.settings (name, value, updated_by) values ('self_checkin', case when coalesce(p_self_checkin, false) then '1' else '0' end, v_uid)
    on conflict (name) do update set value = excluded.value, updated_by = excluded.updated_by;
  insert into public.settings (name, value, updated_by) values ('auto_absent_time', v_cutoff, v_uid)
    on conflict (name) do update set value = excluded.value, updated_by = excluded.updated_by;
  insert into public.settings (name, value, updated_by) values ('weekly_off_days', array_to_string(v_days, ','), v_uid)
    on conflict (name) do update set value = excluded.value, updated_by = excluded.updated_by;
  return jsonb_build_object('message', 'Settings saved successfully.', 'data', private.rules_json());
end
$$;

create or replace function public.dashboard_teacher() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_tid bigint := private.current_teacher_id();
  v_today date := private.academy_today();
  v_month date := date_trunc('month', private.academy_today())::date;
  o record; v_today_rec jsonb; v_recent jsonb;
begin
  if v_tid is null then perform private.fail(403, 'Your account is not active.'); end if;
  select count(*) filter (where status = 'present') as p, count(*) filter (where status = 'absent') as a,
         count(*) filter (where status = 'late') as l, count(*) filter (where status = 'leave') as v,
         count(*) filter (where status = 'present' and attendance_date >= v_month) as mp,
         count(*) filter (where status = 'absent' and attendance_date >= v_month) as ma,
         count(*) filter (where status = 'late' and attendance_date >= v_month) as ml,
         count(*) filter (where status = 'leave' and attendance_date >= v_month) as mv
    into o from public.attendance where teacher_id = v_tid;
  select private.att_json(a, t) into v_today_rec from public.attendance a join public.teachers t on t.id = a.teacher_id
    where a.teacher_id = v_tid and a.attendance_date = v_today;
  select coalesce(jsonb_agg(private.att_json(q.a, q.t) order by q.d desc), '[]'::jsonb) into v_recent
    from (select a as a, t as t, a.attendance_date as d from public.attendance a join public.teachers t on t.id = a.teacher_id
      where a.teacher_id = v_tid order by a.attendance_date desc limit 7) q;
  return jsonb_build_object('date', to_char(v_today, 'YYYY-MM-DD'),
    'overall', private.stats_json(o.p::integer, o.a::integer, o.l::integer, o.v::integer),
    'thisMonth', private.stats_json(o.mp::integer, o.ma::integer, o.ml::integer, o.mv::integer),
    'today', v_today_rec, 'recent', v_recent, 'rules', private.teacher_rules_json(v_tid));
end
$$;

create or replace function public.self_check_in() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tid bigint := private.current_teacher_id();
  v_now timestamp := private.academy_now();
  v_today date := v_now::date;
  v_time time := date_trunc('minute', v_now)::time;
  v_start time;
  v_ex public.attendance; v_status text; v_row public.attendance; v_t public.teachers;
begin
  if auth.uid() is null then perform private.fail(401, 'Please sign in to continue.'); end if;
  if v_tid is null then perform private.fail(403, 'Your account is not active.'); end if;
  if private.setting('self_checkin', '1') <> '1' then perform private.fail(403, 'Self check-in is turned off. Please ask the administrator to mark your attendance.'); end if;
  if exists (select 1 from public.leave_requests l where l.teacher_id = v_tid and l.status = 'approved' and v_today between l.start_date and l.end_date) then
    perform private.fail(409, 'Your leave is approved for today. Contact the administrator if your plans have changed.');
  end if;
  v_start := private.teacher_start_time(v_tid);
  if private.minutes_of(v_time) < private.minutes_of(v_start) then
    perform private.fail(403, format('Check-in opens at %s. You cannot check in before your scheduled start time.', to_char(v_start, 'FMHH12:MI AM')));
  end if;
  select * into v_ex from public.attendance where teacher_id = v_tid and attendance_date = v_today;
  if found then
    perform private.fail(409, case when v_ex.check_in is not null then 'You have already checked in today.' else 'Your attendance for today has already been marked by the administrator.' end);
  end if;
  v_status := case when private.minutes_of(v_time) > private.on_time_limit(v_tid) then 'late' else 'present' end;
  begin
    insert into public.attendance (teacher_id, attendance_date, check_in, status, remarks)
    values (v_tid, v_today, v_time, v_status, 'Self check-in') returning * into v_row;
  exception when unique_violation then perform private.fail(409, 'You have already checked in today.');
  end;
  select * into v_t from public.teachers where id = v_tid;
  return jsonb_build_object(
    'message', case when v_status = 'late'
      then format('Checked in at %s. You are marked Late (%s minutes after %s).', to_char(v_time, 'FMHH12:MI AM'), v_row.late_minutes, to_char(v_start, 'FMHH12:MI AM'))
      else format('Checked in at %s. You are marked Present.', to_char(v_time, 'FMHH12:MI AM')) end,
    'data', private.att_json(v_row, v_t));
end
$$;

create or replace function private.auto_mark_absent() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.academy_today();
  v_now time := private.academy_now()::time;
  v_teacher record;
  v_attendance_id bigint;
  v_marked integer := 0;
begin
  if private.is_weekly_off(v_today) then return 0; end if;
  for v_teacher in
    select t.id, t.teacher_id, cutoff.cutoff
      from public.teachers t
      cross join lateral (select private.teacher_absent_cutoff(t.id) as cutoff) cutoff
     where t.status = 'active'
       and t.joining_date <= v_today
       and (t.leaving_date is null or t.leaving_date >= v_today)
       and cutoff.cutoff is not null
       and v_now >= cutoff.cutoff
       and not exists (select 1 from public.attendance a where a.teacher_id = t.id and a.attendance_date = v_today)
       and not exists (select 1 from public.leave_requests l where l.teacher_id = t.id and l.status = 'approved' and v_today between l.start_date and l.end_date)
     order by t.id
  loop
    insert into public.attendance (teacher_id, attendance_date, status, remarks)
      values (v_teacher.id, v_today, 'absent', 'Automatically marked absent after ' || to_char(v_teacher.cutoff, 'HH24:MI'))
      on conflict (teacher_id, attendance_date) do nothing returning id into v_attendance_id;
    if found then
      perform private.audit(null, 'attendance_auto_absent', 'attendance', v_attendance_id::text, null,
        jsonb_build_object('teacher_id', v_teacher.id, 'teacher_code', v_teacher.teacher_id,
          'date', v_today, 'status', 'absent', 'cutoff', to_char(v_teacher.cutoff, 'HH24:MI')));
      v_marked := v_marked + 1;
    end if;
  end loop;
  return v_marked;
end
$$;

revoke all on function public.admin_precheck_new_teacher(text, text, text, text, text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.admin_update_teacher(bigint, text, text, text, text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.admin_complete_new_teacher(uuid, text, text, text, text, text, text, text, text, jsonb) from public, anon;
revoke all on function private.teacher_start_time(bigint), private.teacher_grace_minutes(bigint), private.on_time_limit(bigint),
  private.teacher_absent_cutoff(bigint), private.normalize_teacher_attendance_rules(jsonb, text, integer, text),
  private.teacher_rules_json(bigint) from public, anon, authenticated;
grant execute on function public.admin_precheck_new_teacher(text, text, text, text, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.admin_update_teacher(bigint, text, text, text, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.admin_complete_new_teacher(uuid, text, text, text, text, text, text, text, text, jsonb) to authenticated;
grant execute on function private.teacher_rules_json(bigint) to authenticated;
revoke all on function private.auto_mark_absent() from public, anon, authenticated;
grant execute on function private.auto_mark_absent() to postgres;

notify pgrst, 'reload schema';
