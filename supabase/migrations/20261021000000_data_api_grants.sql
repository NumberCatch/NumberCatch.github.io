-- Explicit Data API privileges for existing projects and future schema resets.
-- Keep client privileges aligned with the RLS policies and RPC-only sighting writes.

grant usage on schema public to authenticated, service_role;
grant usage on type public.sighting_type to authenticated, service_role;

-- Clients use authenticated access only; RLS policies scope rows to the current user/groups.
revoke all on public.profiles, public.groups, public.group_members, public.sightings
  from public, anon, authenticated;

grant select on public.profiles, public.groups, public.group_members, public.sightings
  to authenticated;

-- Preserve the column-level restrictions established by atomic_sightings.
grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name, avatar_url, updated_at) on public.profiles to authenticated;

grant insert on public.groups, public.group_members to authenticated;
grant delete on public.groups, public.sightings to authenticated;

-- Fund capture is performed only through capture_sighting(), not direct table writes.
revoke insert, update on public.sightings from public, anon, authenticated;

grant all privileges on public.profiles, public.groups, public.group_members, public.sightings
  to service_role;
