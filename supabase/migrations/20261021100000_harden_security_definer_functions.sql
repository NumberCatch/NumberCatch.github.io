-- Keep SECURITY DEFINER functions callable only where the application needs them.
-- Trigger execution does not require clients to have EXECUTE on handle_new_user().
revoke all on function public.handle_new_user()
  from public, anon, authenticated;

-- The RPC is the only client entry point for writing sightings/progress.
revoke all on function public.capture_sighting(
  integer, public.sighting_type, double precision, double precision, double precision, text
) from public, anon, authenticated;
grant execute on function public.capture_sighting(
  integer, public.sighting_type, double precision, double precision, double precision, text
) to authenticated;

-- SECURITY DEFINER avoids recursive RLS checks, but callers may only test their own membership.
create or replace function public.is_group_member(
  target_group uuid,
  target_user uuid default auth.uid()
) returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(target_user = auth.uid(), false)
    and exists (
      select 1
      from public.group_members as gm
      where gm.group_id = target_group
        and gm.user_id = target_user
    );
$$;

revoke all on function public.is_group_member(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.is_group_member(uuid, uuid)
  to authenticated;
