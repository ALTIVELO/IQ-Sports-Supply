-- Minimal stand-in for the parts of Supabase the migrations depend on, so the
-- schema and domain logic can be exercised against a real Postgres.
create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- Supabase reads the subject from the request JWT; here it comes from a GUC.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.user_id', true), '')::uuid;
$$;
