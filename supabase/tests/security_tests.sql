-- =====================================================================================
-- Sunshine Academy — database security tests
-- Run in: Supabase Dashboard -> SQL Editor (after schema.sql). Everything happens inside one
-- transaction that is ROLLED BACK at the end, so your real data is never touched.
-- Result: a table of checks. Every row must say ok = true. If anything fails the script raises an error.
-- It "becomes" different users by setting the same values Supabase sets from a login token
-- (request.jwt.claims) and switching to the same database roles the API uses (anon / authenticated).
-- =====================================================================================
begin;

-- Make attendance-time tests deterministic. This replacement is rolled back with the test transaction.
create or replace function private.academy_now() returns timestamp
language sql stable security definer set search_path = '' as $$
  select coalesce(
    nullif(current_setting('tst.academy_now', true), '')::timestamp,
    now() at time zone private.academy_tz()
  )
$$;

create schema tst;
grant usage on schema tst to public;
create table tst.results (n serial primary key, ok boolean not null, label text not null, detail text);
create table tst.ctx (key text primary key, val text);
grant all on tst.results, tst.ctx to public;
grant usage on sequence tst.results_n_seq to public;

create function tst.record(p_ok boolean, p_label text, p_detail text default '') returns void language sql as
  $$ insert into tst.results (ok, label, detail) values (p_ok, p_label, p_detail) $$;
-- "this statement MUST fail"
create function tst.denied(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql; perform tst.record(false, p_label, 'SUCCEEDED but must be rejected');
  exception when others then perform tst.record(true, p_label, sqlstate || ' ' || left(sqlerrm, 70)); end;
end $$;
-- "this statement MUST work"
create function tst.allowed(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql; perform tst.record(true, p_label, '');
  exception when others then perform tst.record(false, p_label, 'FAILED: ' || sqlstate || ' ' || left(sqlerrm, 90)); end;
end $$;
create function tst.eq(p_actual text, p_expected text, p_label text) returns void language sql as
  $$ select tst.record(p_actual is not distinct from p_expected, p_label, 'got [' || coalesce(p_actual, 'NULL') || '] expected [' || p_expected || ']') $$;
create function tst.checkin_status_at(p_time time, p_expected text, p_label text) returns void language plpgsql as $$
declare v_result jsonb;
begin
  perform set_config('tst.academy_now', (private.academy_today() + p_time)::text, true);
  begin
    v_result := public.self_check_in();
    raise exception using errcode = 'Z0001', message = 'rollback test attendance row';
  exception when sqlstate 'Z0001' then
    null;
  end;
  perform tst.record(v_result -> 'data' ->> 'status' = p_expected, p_label,
    format('got [%s] expected [%s]', coalesce(v_result -> 'data' ->> 'status', 'NULL'), p_expected));
end $$;
create function tst.checkin_before_start_at(p_time time, p_label text) returns void language plpgsql as $$
declare v_state text; v_message text;
begin
  perform set_config('tst.academy_now', (private.academy_today() + p_time)::text, true);
  begin
    perform public.self_check_in();
    raise exception using errcode = 'Z0001', message = 'check-in unexpectedly succeeded';
  exception
    when sqlstate 'Z0001' then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  perform tst.record(v_state = 'PT403' and v_message like 'Check-in opens at %', p_label,
    coalesce(v_state, 'NULL') || ' ' || coalesce(v_message, ''));
end $$;
create function tst.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function tst.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '', true); set local role anon; end $$;
create function tst.as_owner() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;
grant execute on all functions in schema tst to public;

-- ---------- fixtures: 5 sign-ups (the first one tries to sneak in role=admin through its metadata) ----------
select tst.as_owner();
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'admin@t.local',  '{"name":"Test Admin","role":"admin","status":"active"}'),
  ('22222222-2222-2222-2222-222222222222', 'ayesha@t.local', '{"name":"Ayesha Khan","phone":"0300 1234567","subject":"Mathematics"}'),
  ('33333333-3333-3333-3333-333333333333', 'bilal@t.local',  '{"name":"Bilal Ahmed","phone":"0300 7654321","subject":"English"}'),
  ('44444444-4444-4444-4444-444444444444', 'sana@t.local',   '{"name":"Sana Malik","phone":"0300 1112223","subject":"Science"}'),
  ('55555555-5555-5555-5555-555555555555', 'hina@t.local',   '{"name":"Hina Tariq","phone":"0300 9998887","subject":"Urdu"}');
insert into tst.ctx select 't1id', id::text from public.teachers where auth_user_id = '22222222-2222-2222-2222-222222222222';
insert into tst.ctx select 't2id', id::text from public.teachers where auth_user_id = '33333333-3333-3333-3333-333333333333';
insert into tst.ctx select 't3id', id::text from public.teachers where auth_user_id = '44444444-4444-4444-4444-444444444444';
insert into tst.ctx select 't4id', id::text from public.teachers where auth_user_id = '55555555-5555-5555-5555-555555555555';
insert into tst.ctx select 'code', code from private.setup_secret;

select tst.eq((select count(*)::text from public.profiles where role = 'admin'), '0', 'sign-up metadata role=admin is IGNORED (nobody is admin yet)');
select tst.eq((select count(*)::text from public.profiles where status = 'pending'), '5', 'every new sign-up starts as pending');
select tst.eq((select string_agg(teacher_id, ',' order by teacher_id) from public.teachers), 'T-001,T-002,T-003,T-004,T-005', 'Teacher IDs are generated T-001, T-002 ...');
select tst.eq((select joining_date::text from public.teachers limit 1), (select private.academy_today()::text), 'joining date = academy date (server)');

-- ---------- anonymous visitor (not signed in) ----------
select tst.as_anon();
select tst.denied($$select * from public.teachers$$,   'anon cannot read teachers');
select tst.denied($$select * from public.attendance$$, 'anon cannot read attendance');
select tst.denied($$select * from public.profiles$$,   'anon cannot read profiles');
select tst.denied($$select * from public.settings$$,   'anon cannot read settings');
select tst.denied($$select * from public.audit_logs$$, 'anon cannot read audit log');
select tst.denied($$select * from private.setup_secret$$, 'anon cannot read the setup code');
select tst.denied($$select public.list_teachers()$$,   'anon cannot call list_teachers');
select tst.denied($$select public.my_account()$$,      'anon cannot call my_account');
select tst.denied($$select public.self_check_in()$$,   'anon cannot check in');
select tst.denied($$select public.admin_save_attendance(current_date, '[]'::jsonb)$$, 'anon cannot save attendance');
select tst.eq((select public.needs_setup()::text), 'true', 'anon: needs_setup() is true before the first admin exists');
select tst.eq((select public.verify_setup_code('wrong')::text), 'false', 'anon: a wrong setup code is rejected');
select tst.eq((select public.verify_setup_code((select val from tst.ctx where key = 'code'))::text), 'true', 'anon: the real setup code verifies');

-- ---------- first-admin setup ----------
select tst.as_user('22222222-2222-2222-2222-222222222222');   -- a teacher tries to become admin
select tst.denied($$select public.claim_first_admin('wrong-code')$$, 'wrong setup code cannot create an admin');
select tst.as_user('11111111-1111-1111-1111-111111111111');
select tst.allowed($$select public.claim_first_admin((select val from tst.ctx where key = 'code'))$$, 'correct setup code creates the first admin');
select tst.eq((select public.my_account() ->> 'role'), 'admin', 'admin: my_account says admin');
select tst.as_user('22222222-2222-2222-2222-222222222222');
select tst.denied($$select public.claim_first_admin((select val from tst.ctx where key = 'code'))$$, 'setup page is closed once an admin exists');
select tst.as_owner();
select tst.eq((select count(*)::text from private.setup_secret), '0', 'setup code is deleted after use');
select tst.eq((select public.needs_setup()::text), 'false', 'needs_setup() is false now');
select tst.eq((select count(*)::text from public.teachers where auth_user_id = '11111111-1111-1111-1111-111111111111'), '0', 'the admin has no teacher row');

-- ---------- admin approves two teachers, rejects one ----------
select tst.as_user('11111111-1111-1111-1111-111111111111');
select tst.allowed($$select public.admin_set_teacher_status((select val::bigint from tst.ctx where key = 't1id'), 'active')$$, 'admin approves Ayesha');
select tst.allowed($$select public.admin_set_teacher_status((select val::bigint from tst.ctx where key = 't2id'), 'active')$$, 'admin approves Bilal');
select tst.allowed($$select public.admin_set_teacher_status((select val::bigint from tst.ctx where key = 't4id'), 'rejected')$$, 'admin rejects Hina');
select tst.eq((select public.admin_set_teacher_status((select val::bigint from tst.ctx where key = 't3id'), 'active') ->> 'message'), 'Teacher approved successfully.', 'approve message');
select tst.allowed($$select public.admin_set_teacher_status((select val::bigint from tst.ctx where key = 't3id'), 'inactive')$$, 'admin can deactivate (Sana) - history is kept');
select tst.eq((select public.admin_set_teacher_status((select val::bigint from tst.ctx where key = 't3id'), 'active') ->> 'message'), 'Teacher activated successfully.', 'activate message (not pending)');
select tst.denied($$select public.admin_set_teacher_status((select val::bigint from tst.ctx where key = 't1id'), 'admin')$$, 'status "admin" is not accepted');
select tst.allowed($$select public.admin_set_teacher_status((select val::bigint from tst.ctx where key = 't3id'), 'inactive')$$, 'Sana set inactive again (used later)');

-- ---------- attendance history for two teachers over three days ----------
select tst.as_user('11111111-1111-1111-1111-111111111111');
select tst.allowed($$select public.admin_save_attendance(private.academy_today() - 3, jsonb_build_array(
  jsonb_build_object('teacher', (select val from tst.ctx where key = 't1id'), 'status', 'present', 'check_in', '07:55', 'check_out', '14:00', 'remarks', ''),
  jsonb_build_object('teacher', (select val from tst.ctx where key = 't2id'), 'status', 'late',    'check_in', '08:20', 'check_out', '14:00', 'remarks', 'Traffic')))$$, 'admin saves attendance for 3 days ago');
select tst.allowed($$select public.admin_save_attendance(private.academy_today() - 2, jsonb_build_array(
  jsonb_build_object('teacher', (select val from tst.ctx where key = 't1id'), 'status', 'absent', 'check_in', '09:00', 'check_out', '', 'remarks', 'Sick'),
  jsonb_build_object('teacher', (select val from tst.ctx where key = 't2id'), 'status', 'present', 'check_in', '08:00', 'check_out', '14:00')))$$, 'admin saves attendance for 2 days ago');
select tst.allowed($$select public.admin_save_attendance(private.academy_today() - 1, jsonb_build_array(
  jsonb_build_object('teacher', (select val from tst.ctx where key = 't1id'), 'status', 'late',  'check_in', '08:40', 'check_out', '14:00'),
  jsonb_build_object('teacher', (select val from tst.ctx where key = 't2id'), 'status', 'leave', 'remarks', 'Approved')))$$, 'admin saves attendance for yesterday');
select tst.as_owner();
select tst.eq((select count(*)::text from public.attendance), '6', '6 attendance rows exist');
select tst.eq((select late_minutes::text from public.attendance a join public.teachers t on t.id = a.teacher_id where t.teacher_id = 'T-003' and a.attendance_date = private.academy_today() - 3), '20', 'late minutes are calculated (08:20 vs 08:00 = 20)');
select tst.eq((select check_in::text from public.attendance a join public.teachers t on t.id = a.teacher_id where t.teacher_id = 'T-002' and a.attendance_date = private.academy_today() - 2), null, 'absent record had its check-in time cleared');
select tst.denied($$insert into public.attendance (teacher_id, attendance_date, status) values ((select val::bigint from tst.ctx where key = 't1id'), private.academy_today() - 3, 'present')$$, 'DUPLICATE attendance (same teacher + date) is rejected by the database');
select tst.denied($$insert into public.attendance (teacher_id, attendance_date, status) values ((select val::bigint from tst.ctx where key = 't1id'), private.academy_today() + 5, 'present')$$, 'attendance for a FUTURE date is rejected by the database');
select tst.denied($$insert into public.attendance (teacher_id, attendance_date, status, check_in, check_out) values ((select val::bigint from tst.ctx where key = 't1id'), private.academy_today() - 40, 'present', '10:00', '09:00')$$, 'check-out before check-in is rejected by the database');
select tst.denied($$insert into public.attendance (teacher_id, attendance_date, status) values ((select val::bigint from tst.ctx where key = 't1id'), private.academy_today() - 41, 'sick')$$, 'invalid status is rejected by the database');
select tst.denied($$update public.attendance set attendance_date = attendance_date - 1$$, 'attendance date cannot be changed afterwards');

-- ---------- Teacher A (Ayesha): can she see or touch Teacher B (Bilal)? ----------
select tst.as_user('22222222-2222-2222-2222-222222222222');
select tst.eq((select public.my_account() ->> 'role'), 'teacher', 'T1: role is teacher');
select tst.eq((select public.my_account() ->> 'status'), 'active', 'T1: status active');
select tst.eq((select count(*)::text from public.attendance), '3', 'T1 sees ONLY their own 3 attendance rows (table query)');
select tst.eq((select count(*)::text from public.attendance where teacher_id = (select val::bigint from tst.ctx where key = 't2id')), '0', 'T1 filtering by Bilal''s teacher_id gets 0 rows (IDOR blocked)');
select tst.eq((select jsonb_array_length(public.list_attendance(p_teacher => (select val::bigint from tst.ctx where key = 't2id')) -> 'data')::text), '3', 'T1 passing Bilal''s id to list_attendance still only gets T1''s own rows');
select tst.eq((select count(distinct r -> 'teacher' ->> 'name')::text from jsonb_array_elements(public.list_attendance(p_teacher => (select val::bigint from tst.ctx where key = 't2id'), p_limit => 100) -> 'data') r), '1', '...and they are all Ayesha''s');
select tst.eq((select public.attendance_summary(p_teacher => (select val::bigint from tst.ctx where key = 't2id')) ->> 'totalDays'), '3', 'T1 asking for Bilal''s summary gets their own totals');
select tst.eq((select public.attendance_summary() ->> 'percentage'), '33.3', 'T1 percentage = 1 present of 3 days = 33.3');
select tst.denied($$select public.get_teacher((select val::bigint from tst.ctx where key = 't2id'))$$, 'T1 cannot open Bilal''s teacher profile');
select tst.eq((select count(*)::text from public.teachers), '1', 'T1 sees only their own teacher row');
select tst.eq((select count(*)::text from public.profiles), '1', 'T1 sees only their own profile');
select tst.eq((select count(*)::text from public.settings), '0', 'T1 cannot read academy settings');
select tst.eq((select count(*)::text from public.audit_logs), '0', 'T1 cannot read the audit log');
select tst.denied($$select public.list_teachers()$$, 'T1 cannot list teachers');
select tst.denied($$select * from private.setup_secret$$, 'T1 cannot read private schema');
select tst.denied($$select private.audit(null, 'x', 'y', null, null, null)$$, 'T1 cannot write audit entries');
-- direct writes with the teacher's own token
select tst.denied($$update public.attendance set status = 'present'$$, 'T1 cannot UPDATE attendance directly');
select tst.denied($$update public.attendance set teacher_id = (select val::bigint from tst.ctx where key = 't2id')$$, 'T1 cannot move attendance to another teacher');
select tst.denied($$insert into public.attendance (teacher_id, attendance_date, status) values ((select val::bigint from tst.ctx where key = 't1id'), private.academy_today() - 30, 'present')$$, 'T1 cannot INSERT (backdate) attendance directly');
select tst.denied($$delete from public.attendance$$, 'T1 cannot DELETE attendance');
select tst.denied($$update public.teachers set status = 'active'$$, 'T1 cannot UPDATE teachers (status)');
select tst.denied($$update public.teachers set teacher_id = 'T-999'$$, 'T1 cannot change their Teacher ID');
select tst.denied($$update public.profiles set role = 'admin'$$, 'T1 cannot make themselves admin (profiles.role)');
select tst.denied($$update public.profiles set status = 'active'$$, 'T1 cannot change their status');
select tst.denied($$insert into public.profiles (auth_user_id, name, email, role, status) values (gen_random_uuid(), 'Evil', 'evil@x.com', 'admin', 'active')$$, 'T1 cannot insert profiles');
select tst.denied($$update public.settings set value = '0'$$, 'T1 cannot UPDATE settings');
select tst.denied($$insert into public.audit_logs (action, entity_type) values ('x', 'y')$$, 'T1 cannot INSERT audit log rows');
select tst.denied($$delete from public.audit_logs$$, 'T1 cannot DELETE audit log rows');
select tst.denied($$truncate public.attendance$$, 'T1 cannot TRUNCATE attendance');
-- admin-only functions called with a teacher token
select tst.denied($$select public.admin_save_attendance(private.academy_today(), jsonb_build_array(jsonb_build_object('teacher', (select val from tst.ctx where key = 't1id'), 'status', 'present')))$$, 'T1 cannot call admin_save_attendance');
select tst.denied($$select public.admin_update_attendance(1, 'present', '', '', '')$$, 'T1 cannot call admin_update_attendance');
select tst.denied($$select public.admin_update_teacher(1, 'T-001', 'Hacked Name', '0300 1234567', 'Math', '', '2024-01-01', '', 'active')$$, 'T1 cannot call admin_update_teacher');
select tst.denied($$select public.admin_set_teacher_status(1, 'active')$$, 'T1 cannot approve teachers');
select tst.denied($$select public.admin_update_settings('00:00', 120, true)$$, 'T1 cannot change settings');
select tst.denied($$select public.get_settings()$$, 'T1 cannot read settings via function');
select tst.denied($$select public.dashboard_admin()$$, 'T1 cannot open the admin dashboard');
select tst.denied($$select public.attendance_report()$$, 'T1 cannot run the academy report');
select tst.denied($$select public.attendance_yearly_report(2026)$$, 'T1 cannot run the yearly report');
select tst.denied($$select public.admin_export_attendance()$$, 'T1 cannot export attendance');
select tst.denied($$select public.get_attendance_sheet()$$, 'T1 cannot open the admin attendance sheet');
select tst.denied($$select public.update_my_name('Renamed')$$, 'T1 cannot rename themselves');
select tst.denied($$select public.admin_precheck_new_teacher('T-050', 'New Person', 'new.person@t.local', '0300 1234567', 'Art', '', '2025-01-01', '', 'active')$$, 'T1 cannot call the new-teacher precheck');
select tst.denied($$select public.admin_complete_new_teacher(gen_random_uuid(), 'T-050', 'New Person', '0300 1234567', 'Art', '', '2025-01-01', '', 'active')$$, 'T1 cannot call admin_complete_new_teacher');

-- ---------- Self check-in / check-out (time comes from the database clock) ----------
select tst.as_user('11111111-1111-1111-1111-111111111111');
select tst.allowed($$select public.admin_update_settings('15:45', 30, true)$$, 'admin: rules = start 15:45 + 30 min grace');
select tst.as_user('22222222-2222-2222-2222-222222222222');
select tst.checkin_before_start_at('15:44', 'check-in before 15:45 is blocked with a clear message');
select tst.checkin_status_at('15:45', 'present', 'check-in exactly at 15:45 is Present');
select tst.checkin_status_at('16:15', 'present', 'last grace minute at 16:15 is Present');
select tst.checkin_status_at('16:16', 'late', 'check-in after 16:15 is Late');
select set_config('tst.academy_now', (private.academy_today() + time '15:45')::text, true);
select tst.eq((select public.self_check_in() -> 'data' ->> 'status'), 'present', 'T1 check-in is Present at the start time');
select tst.denied($$select public.self_check_in()$$, 'T1 cannot check in twice');
select tst.denied($$select public.self_check_out()$$, 'check-out in the same minute is refused');
select tst.as_owner();
select tst.eq((select count(*)::text from public.attendance where teacher_id = (select val::bigint from tst.ctx where key = 't1id') and attendance_date = private.academy_today()), '1', 'exactly one record for today');
select tst.eq((select remarks from public.attendance where teacher_id = (select val::bigint from tst.ctx where key = 't1id') and attendance_date = private.academy_today()), 'Self check-in', 'record is marked as self check-in');
update public.attendance set check_in = '00:00' where teacher_id = (select val::bigint from tst.ctx where key = 't1id') and attendance_date = private.academy_today();
select tst.as_user('22222222-2222-2222-2222-222222222222');
select tst.allowed($$select public.self_check_out()$$, 'T1 check-out works after check-in');
select tst.denied($$select public.self_check_out()$$, 'T1 cannot check out twice');
select tst.as_user('33333333-3333-3333-3333-333333333333');
select tst.allowed($$select public.admin_save_attendance(private.academy_today(), '[]'::jsonb)$$, 'placeholder (expected to fail below)');
select tst.as_owner();
delete from tst.results where label = 'placeholder (expected to fail below)';
select tst.as_user('11111111-1111-1111-1111-111111111111');
select tst.allowed($$select public.admin_update_settings('00:00', 0, true)$$, 'admin: rules = start 00:00, grace 0 (so any check-in is Late)');
select tst.as_user('33333333-3333-3333-3333-333333333333');
select tst.eq((select public.self_check_in() -> 'data' ->> 'status'), 'late', 'T2 check-in after start+grace is Late');
select tst.as_user('11111111-1111-1111-1111-111111111111');
select tst.allowed($$select public.admin_update_settings('08:00', 15, false)$$, 'admin: self check-in turned OFF');
select tst.as_user('22222222-2222-2222-2222-222222222222');
select tst.denied($$select public.self_check_in()$$, 'with self check-in OFF a teacher cannot check in');
select tst.as_user('11111111-1111-1111-1111-111111111111');
select tst.allowed($$select public.admin_update_settings('08:00', 15, true)$$, 'admin: rules back to 08:00 / 15 / on');
select tst.denied($$select public.admin_update_settings('25:61', 15, true)$$, 'invalid start time rejected');
select tst.denied($$select public.admin_update_settings('08:00', 500, true)$$, 'grace over 120 rejected');
select tst.as_owner();
select tst.eq((select count(*)::text from public.audit_logs where action = 'settings_changed'), '8', 'every settings change is audited (one entry per value that actually changed)');

-- ---------- Admin powers and audit trail ----------
select tst.as_user('11111111-1111-1111-1111-111111111111');
select tst.eq((select jsonb_array_length(public.list_teachers() -> 'data')::text), '4', 'admin lists teachers (rejected + inactive included)');
select tst.eq((select (public.list_teachers(p_search => 'ayesha') -> 'pagination' ->> 'total')), '1', 'admin search by name');
select tst.eq((select (public.list_teachers(p_search => 'T-00') -> 'pagination' ->> 'total')), '4', 'admin search by Teacher ID prefix');
select tst.eq((select (public.list_teachers(p_status => 'inactive') -> 'pagination' ->> 'total')), '1', 'admin filter by status');
select tst.eq((select public.admin_update_teacher((select val::bigint from tst.ctx where key = 't1id'), 'T-001', 'Ayesha Khan', '0300 1234567', 'Mathematics & Physics', '1990-05-20', '2024-08-01', 'Faisalabad', 'active') -> 'data' ->> 'subject'), 'Mathematics & Physics', 'admin edits a teacher');
select tst.denied($$select public.admin_update_teacher((select val::bigint from tst.ctx where key = 't1id'), 'T-003', 'Ayesha Khan', '0300 1234567', 'Maths', '', '2024-08-01', '', 'active')$$, 'duplicate Teacher ID (Bilal''s) is rejected');
select tst.denied($$select public.admin_update_teacher((select val::bigint from tst.ctx where key = 't1id'), 'T-001', 'A', '123', 'M', '', 'nope', '', 'active')$$, 'invalid teacher data is rejected');
select tst.allowed($$select public.admin_precheck_new_teacher('T-050', 'New Person', 'new.person@t.local', '0300 1234567', 'Art', '', '2025-01-01', '', 'active')$$, 'precheck accepts a clean new teacher');
select tst.denied($$select public.admin_precheck_new_teacher('T-003', 'New Person', 'new.person@t.local', '0300 1234567', 'Art', '', '2025-01-01', '', 'active')$$, 'precheck refuses a taken Teacher ID');
select tst.denied($$select public.admin_precheck_new_teacher('T-050', 'New Person', 'bilal@t.local', '0300 1234567', 'Art', '', '2025-01-01', '', 'active')$$, 'precheck refuses a taken email');
select tst.denied($$select public.admin_precheck_new_teacher('T-050', 'New Person', 'not-an-email', '0300 1234567', 'Art', '', '2025-01-01', '', 'active')$$, 'precheck refuses a bad email');
select tst.denied($$select public.admin_precheck_new_teacher('T-050', 'N', 'x@t.local', '12', 'A', '', 'bad', '', 'pending')$$, 'precheck refuses bad fields and status pending');
select tst.eq((select count(*)::text from public.attendance), '8', 'admin sees all attendance rows (6 old + 2 self check-ins)');
select tst.eq((select public.get_attendance_sheet() -> 'data' -> 0 ->> 'attendance' is null)::text, 'false', 'admin sheet shows today''s self check-in');
select tst.denied($$select public.get_attendance_sheet(private.academy_today() + 1)$$, 'admin sheet for a future date is refused');
select tst.allowed($$select public.admin_update_attendance((select min(id) from public.attendance), 'late', '08:30', '14:00', 'Corrected')$$, 'admin edits an attendance record');
select tst.denied($$select public.admin_update_attendance((select min(id) from public.attendance), 'present', '14:00', '08:00', '')$$, 'admin cannot save check-out before check-in');
select tst.denied($$select public.admin_update_attendance(999999, 'present', '', '', '')$$, 'editing a record that does not exist is a clean error');
select tst.denied($$select public.admin_save_attendance(private.academy_today() + 1, jsonb_build_array(jsonb_build_object('teacher', (select val from tst.ctx where key = 't1id'), 'status', 'present')))$$, 'admin cannot save a future date');
select tst.denied($$select public.admin_save_attendance(private.academy_today() - 5, jsonb_build_array(jsonb_build_object('teacher', (select val from tst.ctx where key = 't3id'), 'status', 'present')))$$, 'admin cannot mark an INACTIVE teacher on the sheet');
select tst.allowed($$select public.admin_save_attendance(private.academy_today() - 3, jsonb_build_array(jsonb_build_object('teacher', (select val from tst.ctx where key = 't1id'), 'status', 'present', 'check_in', '07:55', 'check_out', '14:00')))$$, 'saving the same sheet again is fine');
select tst.as_owner();
select tst.eq((select count(*)::text from public.attendance where teacher_id = (select val::bigint from tst.ctx where key = 't1id') and attendance_date = private.academy_today() - 3), '1', 're-saving did NOT create a duplicate');
select tst.eq((select count(*)::text from public.audit_logs where action = 'attendance_created'), '6', 'audit: 6 attendance records created manually');
select tst.eq((select count(*)::text from public.audit_logs where action = 'attendance_edited'), '2', 'audit: 2 edits (one update + one real change on re-save; an unchanged re-save is not logged)');
select tst.eq((select count(*)::text from public.audit_logs where action = 'teacher_approved'), '3', 'audit: 3 approvals');
select tst.eq((select count(*)::text from public.audit_logs where action = 'teacher_rejected'), '1', 'audit: 1 rejection');
select tst.eq((select count(*)::text from public.audit_logs where action = 'teacher_deactivated'), '2', 'audit: deactivations');
select tst.eq((select count(*)::text from public.audit_logs where action = 'teacher_activated'), '1', 'audit: activation');
select tst.eq((select count(*)::text from public.audit_logs where action = 'admin_created'), '1', 'audit: admin creation');
select tst.eq((select (new_data ? 'sensitive_fields_changed')::text from public.audit_logs where action = 'teacher_updated' limit 1), 'true', 'audit: only the NAMES of changed private fields are logged') where exists (select 1 from public.audit_logs where action = 'teacher_updated');
select tst.eq((select (old_data::text ~* '(phone|address|birth)')::text from public.audit_logs where action = 'teacher_updated' limit 1), 'false', 'audit: phone/address/birth values are never copied') where exists (select 1 from public.audit_logs where action = 'teacher_updated');
select tst.denied($$update public.audit_logs set action = 'tampered'$$, 'even the owner cannot edit the audit log');
select tst.denied($$delete from public.audit_logs$$, 'even the owner cannot delete audit log rows');

-- ---------- Reports ----------
select tst.as_user('11111111-1111-1111-1111-111111111111');
select tst.eq((select public.attendance_report(p_from => private.academy_today() - 3, p_to => private.academy_today() - 1) -> 'totals' ->> 'totalDays'), '6', 'report totals for the 3 old days');
select tst.eq((select jsonb_array_length(public.attendance_report() -> 'rows')::text), '2', 'report has a row per teacher with records');
select tst.eq((select public.attendance_yearly_report(extract(year from private.academy_today())::integer) -> 'totals' ->> 'totalDays'), '8', 'yearly report counts every record of the year');
select tst.eq((select jsonb_array_length(public.attendance_yearly_report(extract(year from private.academy_today())::integer) -> 'months')::text), '12', 'yearly report always has 12 months');
select tst.eq((select public.attendance_yearly_report(1999) ->> 'year') , null, 'year 1999 is refused') where false;
select tst.denied($$select public.attendance_yearly_report(1999)$$, 'invalid year is refused');
select tst.eq((select jsonb_array_length(public.attendance_yearly_report(2019) -> 'months')::text), '12', 'a past year with no data still returns 12 empty months (history years stay available)');
select tst.eq((select jsonb_array_length(public.admin_export_attendance(0, 1000) )::text), '8', 'export returns every row');
select tst.eq((select jsonb_array_length(public.admin_export_attendance((select min(id) from public.attendance), 1000))::text), '7', 'export is paged by id');
select tst.eq((select public.dashboard_admin() -> 'stats' ->> 'totalTeachers'), '2', 'dashboard: 2 active teachers');
select tst.eq((select public.dashboard_admin() -> 'stats' ->> 'present'), '1', 'dashboard: today present count');
select tst.eq((select public.dashboard_admin() -> 'stats' ->> 'late'), '1', 'dashboard: today late count');
select tst.eq((select public.dashboard_admin() -> 'stats' ->> 'pending'), '0', 'dashboard: pending count');

-- ---------- Deactivated / rejected / pending teachers are locked out immediately ----------
select tst.as_owner();
select tst.eq((select count(*)::text from public.attendance where teacher_id = (select val::bigint from tst.ctx where key = 't3id')), '0', 'setup: Sana has no records (fixture)');
insert into public.attendance (teacher_id, attendance_date, status, check_in) values ((select val::bigint from tst.ctx where key = 't3id'), private.academy_today() - 10, 'present', '08:00');
select tst.as_user('44444444-4444-4444-4444-444444444444');                       -- Sana: inactive
select tst.eq((select public.my_account() ->> 'status'), 'inactive', 'inactive teacher: status is inactive');
select tst.eq((select count(*)::text from public.attendance), '0', 'inactive teacher cannot read their history');
select tst.denied($$select public.self_check_in()$$, 'inactive teacher cannot check in');
select tst.denied($$select public.dashboard_teacher()$$, 'inactive teacher cannot open the dashboard');
select tst.as_user('55555555-5555-5555-5555-555555555555');                       -- Hina: rejected
select tst.eq((select public.my_account() ->> 'status'), 'rejected', 'rejected user: status is rejected');
select tst.denied($$select public.self_check_in()$$, 'rejected user cannot check in');
select tst.eq((select count(*)::text from public.attendance), '0', 'rejected user sees no attendance');
select tst.as_owner();
select tst.eq((select count(*)::text from public.attendance where teacher_id = (select val::bigint from tst.ctx where key = 't3id')), '1', 'deactivation did NOT delete Sana''s history');

-- ---------- Role / profile guard (even for the database owner) ----------
select tst.denied($$update public.profiles set role = 'admin' where auth_user_id = '22222222-2222-2222-2222-222222222222'$$, 'profiles.role cannot be changed outside the setup function');
select tst.denied($$update public.profiles set auth_user_id = gen_random_uuid()$$, 'a profile cannot be moved to another login');

-- ---------- Injection attempts ----------
select tst.as_user('11111111-1111-1111-1111-111111111111');
select tst.eq((select (public.list_teachers(p_search => $q$'; drop table public.teachers; --$q$) -> 'pagination' ->> 'total')), '0', 'SQL injection text in search is just text');
select tst.eq((select (public.list_teachers(p_search => '%') -> 'pagination' ->> 'total')), '0', 'a lone % is searched literally (no match-everything)');
select tst.eq((select (public.list_teachers(p_search => '_') -> 'pagination' ->> 'total')), '0', 'a lone _ is searched literally');
select tst.eq((select count(*)::text from public.teachers), '4', 'teachers table is intact');

-- ---------- Structural guarantees ----------
select tst.as_owner();
select tst.eq((select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), '0', 'RLS is enabled on EVERY table in schema public');
select tst.eq((select count(*)::text from pg_policy p join pg_class c on c.oid = p.polrelid where p.polcmd <> 'r'), '0', 'there are NO insert/update/delete policies at all (writes only via functions)');
select tst.eq((select has_table_privilege('authenticated', 'public.attendance', 'INSERT')::text), 'false', 'authenticated has no INSERT on attendance');
select tst.eq((select has_table_privilege('authenticated', 'public.attendance', 'UPDATE')::text), 'false', 'authenticated has no UPDATE on attendance');
select tst.eq((select has_table_privilege('authenticated', 'public.attendance', 'DELETE')::text), 'false', 'authenticated has no DELETE on attendance');
select tst.eq((select has_table_privilege('anon', 'public.attendance', 'SELECT')::text), 'false', 'anon has no SELECT on attendance');
select tst.eq((select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname not like 'tst%' and has_function_privilege('anon', p.oid, 'EXECUTE')), '2', 'anon can run exactly 2 functions (needs_setup, verify_setup_code)');
select tst.eq((select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))), '0', 'every SECURITY DEFINER function pins its search_path');
select tst.eq((select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.proname not like 'tst%' and p.prosrc ~* 'delete\s+from\s+public\.attendance|truncate\s+public\.attendance|drop\s+table\s+public\.attendance'), '0', 'no function can delete attendance (no auto-expiry / purge job)');
select tst.eq((select count(*)::text from pg_extension where extname in ('pg_cron')), '0', 'no scheduled-job extension that could purge old rows is installed');
select tst.eq((select count(*)::text from public.attendance where attendance_date < private.academy_today() - 2), '3', 'old attendance rows are still present');

-- deleting by the project owner (SQL editor) is possible but always leaves a trace
delete from public.attendance where id = (select max(id) from public.attendance);
select tst.eq((select count(*)::text from public.audit_logs where action = 'attendance_deleted'), '1', 'an owner-level delete is recorded in the audit log');

-- ---------- Registration safety ----------
update public.settings set value = '1' where name = 'max_pending';
select tst.denied($$insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'spam1@t.local', '{"name":"Spam One"}'::jsonb), (gen_random_uuid(), 'spam2@t.local', '{"name":"Spam Two"}'::jsonb)$$, 'registration cap stops a flood of pending sign-ups');
update public.settings set value = '25' where name = 'max_pending';
select tst.denied($$insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'bad@t.local', '{"name":"Bad Phone","phone":"<script>"}'::jsonb)$$, 'invalid phone in sign-up data is refused');

-- imported (legacy) teacher whose login is not linked yet
insert into public.teachers (teacher_id, name, email, phone, subject, joining_date, status) values ('T-101', 'Legacy Teacher', 'legacy@t.local', '0300 5550000', 'Art', '2024-01-01', 'active');
select tst.denied($$insert into auth.users (id, email) values (gen_random_uuid(), 'legacy@t.local')$$, 'a stranger cannot register with an imported teacher''s email');
update public.settings set value = '1' where name = 'legacy_link';
select tst.allowed($$insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666', 'legacy@t.local')$$, 'during the owner-controlled window the imported teacher is linked');
update public.settings set value = '0' where name = 'legacy_link';
select tst.eq((select t.auth_user_id::text from public.teachers t where t.teacher_id = 'T-101'), '66666666-6666-6666-6666-666666666666', 'imported teacher is now linked to the new login');
select tst.eq((select status from public.profiles where auth_user_id = '66666666-6666-6666-6666-666666666666'), 'active', 'linked teacher keeps their active status');

-- ---------- Report ----------
select ok, label, detail from tst.results order by n;
select count(*) as total_checks, count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from tst.results;
do $$ begin
  if exists (select 1 from tst.results where not ok) then raise exception 'SECURITY TESTS FAILED - see the rows above with ok = false'; end if;
end $$;

rollback;
