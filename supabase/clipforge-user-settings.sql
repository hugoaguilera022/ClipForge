-- ClipForge: private per-user API credentials
-- Run once in Supabase SQL Editor for project zmqfjrstuhthtrshcfwa.
create table if not exists public.clipforge_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider_keys jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.clipforge_user_settings enable row level security;
revoke all on table public.clipforge_user_settings from anon;
grant select, insert, update, delete on table public.clipforge_user_settings to authenticated;
drop policy if exists "Users can read their own ClipForge settings" on public.clipforge_user_settings;
create policy "Users can read their own ClipForge settings"
  on public.clipforge_user_settings for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users can insert their own ClipForge settings" on public.clipforge_user_settings;
create policy "Users can insert their own ClipForge settings"
  on public.clipforge_user_settings for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "Users can update their own ClipForge settings" on public.clipforge_user_settings;
create policy "Users can update their own ClipForge settings"
  on public.clipforge_user_settings for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own ClipForge settings" on public.clipforge_user_settings;
create policy "Users can delete their own ClipForge settings"
  on public.clipforge_user_settings for delete to authenticated
  using (auth.uid() = user_id);
