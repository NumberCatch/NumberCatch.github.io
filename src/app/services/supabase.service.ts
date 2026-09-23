import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { GroupMember, NewSighting, PlayerGroup, Profile, Sighting } from '../models/models';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient = createClient(
    environment.supabaseUrl || 'https://placeholder.supabase.co',
    environment.supabasePublishableKey || 'placeholder',
  );
  private readonly sightingsCache = new Map<string, Sighting[]>();
  private readonly groupsCache = new Map<string, PlayerGroup[]>();
  private readonly membersCache = new Map<string, GroupMember[]>();

  clearCache(): void {
    this.sightingsCache.clear();
    this.groupsCache.clear();
    this.membersCache.clear();
  }

  async profile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return data as Profile | null;
  }

  async ensureProfile(userId: string, displayName: string): Promise<Profile> {
    const existing = await this.profile(userId);
    if (existing) return existing;
    const { data, error } = await this.client
      .from('profiles')
      .insert({ id: userId, display_name: displayName.trim() || 'Spieler' })
      .select('*')
      .single();
    if (error) throw error;
    return data as Profile;
  }

  async ownSightings(userId: string): Promise<Sighting[]> {
    const cached = this.sightingsCache.get(userId);
    if (cached) return cached;
    const { data, error } = await this.client
      .from('sightings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const sightings = (data ?? []) as Sighting[];
    this.sightingsCache.set(userId, sightings);
    return sightings;
  }

  async saveSighting(sighting: NewSighting): Promise<Profile> {
    const { data, error } = await this.client
      .rpc('capture_sighting', {
        p_number: sighting.number,
        p_type: sighting.type,
        p_latitude: sighting.latitude,
        p_longitude: sighting.longitude,
        p_accuracy: sighting.accuracy,
        p_note: sighting.note,
      })
      .single<Profile>();
    if (error) throw error;
    if (!data) throw new Error('Fund konnte nicht gespeichert werden.');
    this.sightingsCache.clear();
    return data;
  }

  async groups(userId: string): Promise<PlayerGroup[]> {
    const cached = this.groupsCache.get(userId);
    if (cached) return cached;
    const { data, error } = await this.client
      .from('groups')
      .select('id,name,created_by,created_at,group_members!inner(user_id)')
      .eq('group_members.user_id', userId);
    if (error) throw error;
    const groups = (data ?? []).map(
      ({ group_members: _members, ...group }) => group as PlayerGroup,
    );
    this.groupsCache.set(userId, groups);
    return groups;
  }

  async createGroup(userId: string, name: string): Promise<PlayerGroup> {
    const { data, error } = await this.client
      .from('groups')
      .insert({ name, created_by: userId })
      .select('id,name,created_by,created_at')
      .single();
    if (error) throw error;
    await this.joinGroup(data.id, userId);
    this.groupsCache.delete(userId);
    return data as PlayerGroup;
  }

  async joinGroup(groupId: string, userId: string): Promise<void> {
    const { error } = await this.client
      .from('group_members')
      .insert({ group_id: groupId, user_id: userId });
    if (error && error.code !== '23505') throw error;
    this.groupsCache.delete(userId);
    this.membersCache.delete(groupId);
  }

  async deleteGroup(groupId: string, userId: string): Promise<void> {
    const { data, error } = await this.client
      .from('groups')
      .delete()
      .eq('id', groupId)
      .eq('created_by', userId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Fehler beim Löschen der Gruppe.');
    this.groupsCache.delete(userId);
    this.membersCache.delete(groupId);
  }

  async members(groupId: string, forceRefresh = false): Promise<GroupMember[]> {
    const cached = this.membersCache.get(groupId);
    if (cached && !forceRefresh) return cached;
    const { data, error } = await this.client
      .from('group_members')
      .select('group_id,user_id,joined_at')
      .eq('group_id', groupId);
    if (error) throw error;
    const memberships = data ?? [];
    const userIds = memberships.map((item) => item.user_id as string);
    if (!userIds.length) {
      this.membersCache.set(groupId, []);
      return [];
    }
    const { data: profiles, error: profileError } = await this.client
      .from('profiles')
      .select('id,display_name,avatar_url,current_number')
      .in('id', userIds);
    if (profileError) throw profileError;
    const profilesById = new Map(
      (profiles ?? []).map((profile) => [profile.id as string, profile as Profile]),
    );
    const members = memberships.flatMap((item) => {
      const profile = profilesById.get(item.user_id as string);
      return profile
        ? [
            {
              group_id: item.group_id as string,
              user_id: item.user_id as string,
              joined_at: item.joined_at as string,
              profile,
            },
          ]
        : [];
    });
    this.membersCache.set(groupId, members);
    return members;
  }

  async uploadAvatar(userId: string, file: File): Promise<string> {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `${userId}/avatar.${extension}`;
    const { error } = await this.client.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    const { data } = this.client.storage.from('avatars').getPublicUrl(path);
    const publicUrl = `${data.publicUrl}?v=${Date.now()}`;
    const { data: profile, error: profileError } = await this.client
      .from('profiles')
      .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id')
      .single();
    if (profileError) throw profileError;
    if (!profile) throw new Error('Avatar konnte nicht gespeichert werden.');
    return publicUrl;
  }

  async updateProfile(userId: string, displayName: string): Promise<void> {
    const { error } = await this.client
      .from('profiles')
      .update({ display_name: displayName.trim(), updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw error;
  }

  async deleteSighting(userId: string, sightingId: string): Promise<void> {
    const { error } = await this.client
      .from('sightings')
      .delete()
      .eq('id', sightingId)
      .eq('user_id', userId);
    if (error) throw error;
    const cached = this.sightingsCache.get(userId);
    if (cached) {
      this.sightingsCache.set(
        userId,
        cached.filter((sighting) => sighting.id !== sightingId),
      );
    }
  }

  watchGroupProfiles(groupId: string, onChange: () => void): () => void {
    const topic = `group-profiles-${groupId}`;
    const existing = this.client
      .getChannels()
      .find((channel) => channel.topic === `realtime:${topic}`);
    if (existing) void this.client.removeChannel(existing);
    const channel = this.client
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onChange)
      .subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }
}
