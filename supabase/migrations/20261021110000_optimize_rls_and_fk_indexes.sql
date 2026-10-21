-- Add indexes for foreign-key lookups flagged by the Supabase performance advisor.
-- These indexes improve joins/deletes and do not change row-level access.
create index if not exists group_members_user_id_idx
  on public.group_members (user_id);

create index if not exists groups_created_by_idx
  on public.groups (created_by);

create index if not exists sightings_shared_group_id_idx
  on public.sightings (shared_group_id);

-- Evaluate auth.uid() once per statement rather than once per candidate row.
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles
  for select
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.group_members mine
      join public.group_members theirs on mine.group_id = theirs.group_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = profiles.id
    )
  );

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles
  for insert
  with check (id = (select auth.uid()));

drop policy if exists "users join groups" on public.group_members;
create policy "users join groups" on public.group_members
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "own sightings read" on public.sightings;
create policy "own sightings read" on public.sightings
  for select
  using (
    user_id = (select auth.uid())
    or (
      shared_group_id is not null
      and exists (
        select 1
        from public.group_members
        where group_id = sightings.shared_group_id
          and user_id = (select auth.uid())
      )
    )
  );

-- Merge the two permissive SELECT policies into one equivalent policy.
drop policy if exists "creators read their groups" on public.groups;
drop policy if exists "group members read groups" on public.groups;
create policy "creators and members read groups" on public.groups
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or public.is_group_member(id)
  );
