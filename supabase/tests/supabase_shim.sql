-- =====================================================================================
-- TEST ONLY. Do NOT run this on Supabase (Supabase already has all of this).
-- It recreates, on a plain local PostgreSQL, the few Supabase pieces the schema depends on:
-- the API roles, the auth.users table and auth.uid(), so the security rules can be tested offline.
-- =====================================================================================
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then create role authenticator noinherit login password 'authpw'; end if;
end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  aud text default 'authenticated', role text default 'authenticated',
  email text unique, encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{"provider":"email","providers":["email"]}',
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz default now(), updated_at timestamptz default now(), last_sign_in_at timestamptz
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;

grant usage on schema auth, public to anon, authenticated, service_role;
-- Supabase gives anon/authenticated broad default privileges on new objects; copy that so the revokes in schema.sql are really tested.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
