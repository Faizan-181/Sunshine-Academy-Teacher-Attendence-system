-- Sunshine Academy live attendance feature patch
-- Apply to the existing Sunshine Academy Supabase project after reviewing.
-- This preserves existing attendance rows and current security settings.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

alter table public.settings drop constraint if exists settings_name_check;
alter table public.settings add constraint settings_name_check check (name = any (array[
  'school_start', 'grace_minutes', 'self_checkin', 'timezone', 'max_pending', 'legacy_link',
  'academy_network_cidrs', 'attendance_security_start', 'attendance_security_grace',
  'auto_absent_time', 'weekly_off_days'
]::text[]));

insert into public.settings (name, value) values
  ('auto_absent_time', ''), ('weekly_off_days', '0')
on conflict (name) do nothing;

create or replace function private.stats_json(p integer, a integer, l integer, v integer)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'totalDays', p + a + l + v,
    'present', p + l,
    'absent', a,
    'late', l,
    'leave', v,
    'percentage', case when p + a + l + v = 0 then 0
      else round((p + l)::numeric / (p + a + l + v) * 100, 1) end
  )
$$;

create or replace function private.rules_json() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'startTime', private.setting('school_start', '08:00'),
    'graceMinutes', coalesce(nullif(private.setting('grace_minutes', '15'), '')::integer, 15),
    'selfCheckin', private.setting('self_checkin', '1') = '1',
    'lateAfter', lpad((private.on_time_limit() / 60)::text, 2, '0') || ':' || lpad((private.on_time_limit() % 60)::text, 2, '0'),
    'timezone', private.academy_tz(),
    'autoAbsentTime', private.setting('auto_absent_time', ''),
    'weeklyOffDays', coalesce((
      select jsonb_agg(day::integer order by ordinal)
      from unnest(string_to_array(private.setting('weekly_off_days', '0'), ',')) with ordinality as days(day, ordinal)
    ), '[]'::jsonb)
  )
$$;

create or replace function private.settings_validate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.name = 'school_start' and new.value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'School start time must look like 08:00.' using errcode = 'PT400', hint = 'startTime';
  elsif new.name = 'grace_minutes' and (new.value !~ '^[0-9]{1,3}$' or new.value::integer > 120) then
    raise exception 'Grace period must be a whole number of minutes (0-120).' using errcode = 'PT400', hint = 'graceMinutes';
  elsif new.name in ('self_checkin', 'legacy_link') and new.value not in ('0', '1') then
    raise exception 'That setting must be 0 or 1.' using errcode = 'PT400';
  elsif new.name = 'max_pending' and (new.value !~ '^[0-9]{1,3}$' or new.value::integer < 1) then
    raise exception 'max_pending must be a number from 1 to 999.' using errcode = 'PT400';
  elsif new.name = 'timezone' and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.value) then
    raise exception 'Unknown timezone.' using errcode = 'PT400';
  elsif new.name = 'auto_absent_time' and new.value <> '' and new.value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Automatic absent time must look like 16:30 or be blank.' using errcode = 'PT400', hint = 'autoAbsentTime';
  elsif new.name = 'weekly_off_days' and new.value <> '' and new.value !~ '^[0-6](,[0-6])*$' then
    raise exception 'Weekly off days must be comma-separated weekday numbers from 0 to 6.' using errcode = 'PT400';
  end if;
  return new;
end
$$;

create or replace function public.dashboard_admin() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_today date := private.academy_today();
  v_total integer;
  v_pending integer;
  v_not_marked integer;
  v_list jsonb;
  r record;
begin
  if not private.is_admin() then perform private.fail(403, 'You don''t have permission to do that.'); end if;
  select count(*) into v_total from public.teachers where status = 'active';
  select count(*) into v_pending from public.teachers where status = 'pending';
  select count(*) filter (where a.status in ('present', 'late')) as p,
         count(*) filter (where a.status = 'absent') as a,
         count(*) filter (where a.status = 'late') as l,
         count(*) filter (where a.status = 'leave') as v
    into r from public.attendance a join public.teachers t on t.id = a.teacher_id
   where a.attendance_date = v_today;
  select coalesce(jsonb_agg(private.att_json(a, t) order by t.name), '[]'::jsonb) into v_list
    from public.attendance a join public.teachers t on t.id = a.teacher_id where a.attendance_date = v_today;
  if private.is_weekly_off(v_today) then
    v_not_marked := 0;
  else
    select count(*) into v_not_marked from public.teachers t
     where t.status = 'active' and t.joining_date <= v_today and (t.leaving_date is null or t.leaving_date >= v_today)
       and not exists (select 1 from public.attendance a where a.teacher_id = t.id and a.attendance_date = v_today)
       and not exists (select 1 from public.leave_requests l where l.teacher_id = t.id and l.status = 'approved'
         and v_today between l.start_date and l.end_date);
  end if;
  return jsonb_build_object(
    'date', to_char(v_today, 'YYYY-MM-DD'),
    'stats', jsonb_build_object('totalTeachers', v_total, 'present', r.p, 'absent', r.a, 'late', r.l, 'leave', r.v,
      'notMarked', v_not_marked, 'pending', v_pending),
    'todayAttendance', v_list
  );
end
$$;

create or replace function public.admin_update_attendance_rules(
  p_start_time text,
  p_grace_minutes integer,
  p_self_checkin boolean,
  p_auto_absent_time text,
  p_weekly_off_days integer[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_cutoff text := coalesce(p_auto_absent_time, '');
  v_days integer[];
  v_cutoff_minutes integer;
begin
  if not private.is_admin() then perform private.fail(403, 'You don''t have permission to do that.'); end if;
  if coalesce(p_start_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    perform private.fail(400, 'Choose the time school starts.', 'startTime');
  end if;
  if p_grace_minutes is null or p_grace_minutes not between 0 and 120 then
    perform private.fail(400, 'Enter a whole number of minutes (0-120).', 'graceMinutes');
  end if;
  if v_cutoff <> '' and v_cutoff !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    perform private.fail(400, 'Choose a valid automatic absent time.', 'autoAbsentTime');
  end if;
  if p_weekly_off_days is null or exists (select 1 from unnest(p_weekly_off_days) d where d < 0 or d > 6) then
    perform private.fail(400, 'Choose valid weekly off days.');
  end if;
  select coalesce(array_agg(day order by day), array[]::integer[]) into v_days
    from (select distinct d as day from unnest(p_weekly_off_days) d) choices;
  if v_cutoff <> '' then
    v_cutoff_minutes := split_part(v_cutoff, ':', 1)::integer * 60 + split_part(v_cutoff, ':', 2)::integer;
    if v_cutoff_minutes <= least(
      split_part(p_start_time, ':', 1)::integer * 60
        + split_part(p_start_time, ':', 2)::integer + p_grace_minutes,
      23 * 60 + 59
    ) then
      perform private.fail(400, 'Choose a time later than the late threshold.', 'autoAbsentTime');
    end if;
  end if;

  insert into public.settings (name, value, updated_by) values ('school_start', p_start_time, v_uid)
    on conflict (name) do update set value = excluded.value, updated_by = excluded.updated_by;
  insert into public.settings (name, value, updated_by) values ('grace_minutes', p_grace_minutes::text, v_uid)
    on conflict (name) do update set value = excluded.value, updated_by = excluded.updated_by;
  insert into public.settings (name, value, updated_by) values ('self_checkin', case when coalesce(p_self_checkin, false) then '1' else '0' end, v_uid)
    on conflict (name) do update set value = excluded.value, updated_by = excluded.updated_by;
  insert into public.settings (name, value, updated_by) values ('auto_absent_time', v_cutoff, v_uid)
    on conflict (name) do update set value = excluded.value, updated_by = excluded.updated_by;
  insert into public.settings (name, value, updated_by)
    values ('weekly_off_days', array_to_string(v_days, ','), v_uid)
    on conflict (name) do update set value = excluded.value, updated_by = excluded.updated_by;

  return jsonb_build_object('message', 'Settings saved successfully.', 'data', private.rules_json());
end
$$;

create or replace function private.is_weekly_off(p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select extract(dow from p_date)::integer = any(
    coalesce(string_to_array(private.setting('weekly_off_days', '0'), ',')::integer[], array[]::integer[])
  )
$$;

create or replace function public.teacher_daily_report(p_teacher bigint, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_to date;
  v_data jsonb;
begin
  if not private.is_admin() then perform private.fail(403, 'You don''t have permission to do that.'); end if;
  if p_teacher is null or p_from is null or p_to is null or p_to < p_from then
    perform private.fail(400, 'Choose a teacher and a valid date range.');
  end if;
  if not exists (select 1 from public.teachers where id = p_teacher) then
    perform private.fail(404, 'Teacher not found.');
  end if;
  v_to := least(p_to, private.academy_today());
  if p_from > v_to then return jsonb_build_object('data', '[]'::jsonb); end if;
  if v_to - p_from > 365 then perform private.fail(400, 'Daily reports are limited to 366 days.'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date', to_char(c.day, 'YYYY-MM-DD'),
    'status', case
      when a.id is not null then a.status
      when private.is_weekly_off(c.day) then 'weekly_off'
      when exists (select 1 from public.leave_requests l where l.teacher_id = p_teacher
        and l.status = 'approved' and c.day between l.start_date and l.end_date) then 'approved_leave'
      else 'not_marked'
    end,
    'check_in', coalesce(to_char(a.check_in, 'HH24:MI'), ''),
    'check_out', coalesce(to_char(a.check_out, 'HH24:MI'), ''),
    'remarks', coalesce(a.remarks, '')
  ) order by c.day), '[]'::jsonb)
    into v_data
    from (select p_from + dates.day_offset as day from generate_series(0, v_to - p_from) as dates(day_offset)) c
    left join public.attendance a on a.teacher_id = p_teacher and a.attendance_date = c.day;
  return jsonb_build_object('data', v_data);
end
$$;

create or replace function private.auto_mark_absent() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.academy_today();
  v_cutoff text := private.setting('auto_absent_time', '');
  v_now time := private.academy_now()::time;
  v_teacher record;
  v_attendance_id bigint;
  v_marked integer := 0;
begin
  if v_cutoff = '' then return 0; end if;
  if v_cutoff !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return 0; end if;
  if v_now < v_cutoff::time then return 0; end if;
  if private.is_weekly_off(v_today) then return 0; end if;

  for v_teacher in
    select t.id, t.teacher_id
      from public.teachers t
     where t.status = 'active'
       and t.joining_date <= v_today
       and (t.leaving_date is null or t.leaving_date >= v_today)
       and not exists (
         select 1 from public.attendance a where a.teacher_id = t.id and a.attendance_date = v_today
       )
       and not exists (
         select 1 from public.leave_requests l
          where l.teacher_id = t.id and l.status = 'approved'
            and v_today between l.start_date and l.end_date
       )
     order by t.id
  loop
    insert into public.attendance (teacher_id, attendance_date, status, remarks)
      values (v_teacher.id, v_today, 'absent', 'Automatically marked absent after ' || v_cutoff)
      on conflict (teacher_id, attendance_date) do nothing
      returning id into v_attendance_id;
    if found then
      perform private.audit(null, 'attendance_auto_absent', 'attendance', v_attendance_id::text, null,
        jsonb_build_object('teacher_id', v_teacher.id, 'teacher_code', v_teacher.teacher_id,
          'date', v_today, 'status', 'absent', 'cutoff', v_cutoff));
      v_marked := v_marked + 1;
    end if;
  end loop;
  return v_marked;
end
$$;

revoke all on function private.auto_mark_absent() from public, anon, authenticated;
revoke all on function private.is_weekly_off(date) from public, anon, authenticated;
revoke all on function public.admin_update_attendance_rules(text, integer, boolean, text, integer[]) from public, anon;
revoke all on function public.teacher_daily_report(bigint, date, date) from public, anon;
grant execute on function public.admin_update_attendance_rules(text, integer, boolean, text, integer[]) to authenticated;
grant execute on function public.teacher_daily_report(bigint, date, date) to authenticated;
grant execute on function private.is_weekly_off(date) to authenticated;
grant execute on function private.auto_mark_absent() to postgres;

select cron.schedule('sunshine-auto-mark-absent', '*/5 * * * *', 'select private.auto_mark_absent();');

notify pgrst, 'reload schema';
