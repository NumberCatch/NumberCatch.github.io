create type public.sighting_type as enum ('confirmed', 'hint');
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, display_name text not null check (char_length(display_name) between 1 and 80), avatar_url text, current_number integer not null default 0 check (current_number between 0 and 999), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.groups (id uuid primary key default gen_random_uuid(), name text not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now());
create table public.group_members (group_id uuid references public.groups(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade, joined_at timestamptz not null default now(), primary key (group_id, user_id));
create table public.sightings (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, number integer not null check (number between 1 and 999), type public.sighting_type not null, latitude double precision check (latitude between -90 and 90), longitude double precision check (longitude between -180 and 180), accuracy double precision check (accuracy is null or accuracy >= 0), note text check (note is null or char_length(note) <= 500), created_at timestamptz not null default now(), shared_group_id uuid references public.groups(id) on delete set null);
alter table public.profiles enable row level security; alter table public.groups enable row level security; alter table public.group_members enable row level security; alter table public.sightings enable row level security;
create policy "own profile read" on public.profiles for select using (id = auth.uid() or exists (select 1 from public.group_members mine join public.group_members theirs on mine.group_id = theirs.group_id where mine.user_id = auth.uid() and theirs.user_id = profiles.id));
create policy "own profile update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid()); create policy "own profile insert" on public.profiles for insert with check (id = auth.uid());
create policy "group members read groups" on public.groups for select using (exists (select 1 from public.group_members where group_id = groups.id and user_id = auth.uid())); create policy "creator creates group" on public.groups for insert with check (created_by = auth.uid());
create policy "members read membership" on public.group_members for select using (exists (select 1 from public.group_members own where own.group_id = group_members.group_id and own.user_id = auth.uid())); create policy "users join groups" on public.group_members for insert with check (user_id = auth.uid());
create policy "own sightings read" on public.sightings for select using (user_id = auth.uid() or (shared_group_id is not null and exists (select 1 from public.group_members where group_id = sightings.shared_group_id and user_id = auth.uid()))); create policy "own sightings insert" on public.sightings for insert with check (user_id = auth.uid()); create policy "own sightings update" on public.sightings for update using (user_id = auth.uid()) with check (user_id = auth.uid()); create policy "own sightings delete" on public.sightings for delete using (user_id = auth.uid());
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Spieler')); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
alter publication supabase_realtime add table public.profiles, public.sightings, public.group_members;

-- Explicit Data API privileges for fresh projects and local resets.
grant usage on schema public to authenticated, service_role;
grant usage on type public.sighting_type to authenticated, service_role;
grant select on public.profiles, public.groups, public.group_members, public.sightings to authenticated;
grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name, avatar_url, updated_at) on public.profiles to authenticated;
grant insert on public.groups, public.group_members to authenticated;
grant delete on public.groups, public.sightings to authenticated;
grant all privileges on public.profiles, public.groups, public.group_members, public.sightings to service_role;
