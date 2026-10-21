-- Explicit Data API privileges for existing projects and future schema resets.
-- Keep client privileges aligned with the RLS policies and RPC-only sighting writes.
grant usage on schema public to anon, authenticated, service_role;
grant usage on type public.sighting_type to anon, authenticated, service_role;
grant select on public.profiles, public.groups, public.group_members, public.sightings to anon;
grant select on public.profiles, public.groups, public.group_members, public.sightings to authenticated;
grant insert, update on public.profiles to authenticated;
grant insert on public.groups, public.group_members to authenticated;
grant delete on public.sightings to authenticated;
grant all privileges on public.profiles, public.groups, public.group_members, public.sightings to service_role;
