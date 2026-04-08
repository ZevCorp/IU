create extension if not exists pgcrypto;

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.custom_gpt_desktops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'IU Desktop',
  desktop_secret text not null unique,
  is_default boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  session_status text not null default 'idle' check (session_status in ('idle', 'active')),
  session_id uuid,
  session_opened_at timestamptz,
  session_last_seen_at timestamptz,
  session_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists custom_gpt_desktops_one_default_per_user_idx
  on public.custom_gpt_desktops (user_id)
  where is_default = true;

create index if not exists custom_gpt_desktops_user_session_idx
  on public.custom_gpt_desktops (user_id, session_status, session_expires_at desc);

create table if not exists public.custom_gpt_action_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  desktop_id uuid not null references public.custom_gpt_desktops(id) on delete cascade,
  operation_name text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'timed_out')),
  claimed_by_session_id uuid,
  error_text text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz
);

create index if not exists custom_gpt_action_requests_desktop_status_idx
  on public.custom_gpt_action_requests (desktop_id, status, created_at desc);

create index if not exists custom_gpt_action_requests_user_created_idx
  on public.custom_gpt_action_requests (user_id, created_at desc);

drop trigger if exists custom_gpt_desktops_set_updated_at on public.custom_gpt_desktops;
create trigger custom_gpt_desktops_set_updated_at
before update on public.custom_gpt_desktops
for each row
execute function public.set_current_timestamp_updated_at();

alter table public.custom_gpt_desktops enable row level security;
alter table public.custom_gpt_action_requests enable row level security;

drop policy if exists "custom_gpt_desktops_owner_select" on public.custom_gpt_desktops;
create policy "custom_gpt_desktops_owner_select"
on public.custom_gpt_desktops
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "custom_gpt_desktops_owner_insert" on public.custom_gpt_desktops;
create policy "custom_gpt_desktops_owner_insert"
on public.custom_gpt_desktops
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "custom_gpt_desktops_owner_update" on public.custom_gpt_desktops;
create policy "custom_gpt_desktops_owner_update"
on public.custom_gpt_desktops
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "custom_gpt_action_requests_owner_select" on public.custom_gpt_action_requests;
create policy "custom_gpt_action_requests_owner_select"
on public.custom_gpt_action_requests
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.custom_gpt_create_desktop(p_label text default 'IU Desktop')
returns table (
  desktop_id uuid,
  desktop_secret text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_secret text;
  v_desktop_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.custom_gpt_desktops
  set is_default = false
  where user_id = v_user_id
    and is_default = true;

  v_secret := encode(gen_random_bytes(24), 'hex');

  insert into public.custom_gpt_desktops (
    user_id,
    label,
    desktop_secret,
    is_default
  )
  values (
    v_user_id,
    coalesce(nullif(trim(p_label), ''), 'IU Desktop'),
    v_secret,
    true
  )
  returning id into v_desktop_id;

  return query
  select v_desktop_id, v_secret;
end;
$$;

grant execute on function public.custom_gpt_create_desktop(text) to authenticated;
