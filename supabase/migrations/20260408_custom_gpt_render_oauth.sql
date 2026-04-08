create table if not exists public.custom_gpt_oauth_requests (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  redirect_uri text not null,
  state text,
  scope text not null default '',
  code_challenge text,
  code_challenge_method text,
  user_id uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  denied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists custom_gpt_oauth_requests_expires_idx
  on public.custom_gpt_oauth_requests (expires_at desc);

create index if not exists custom_gpt_oauth_requests_user_idx
  on public.custom_gpt_oauth_requests (user_id, created_at desc);

create table if not exists public.custom_gpt_oauth_codes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_gpt_oauth_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  redirect_uri text not null,
  scope text not null default '',
  code_hash text not null unique,
  code_challenge text,
  code_challenge_method text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists custom_gpt_oauth_codes_expires_idx
  on public.custom_gpt_oauth_codes (expires_at desc);

create table if not exists public.custom_gpt_oauth_access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  scope text not null default '',
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz
);

create index if not exists custom_gpt_oauth_access_tokens_expires_idx
  on public.custom_gpt_oauth_access_tokens (expires_at desc);

create index if not exists custom_gpt_oauth_access_tokens_user_idx
  on public.custom_gpt_oauth_access_tokens (user_id, created_at desc);
