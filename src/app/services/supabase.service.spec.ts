import type { Mock } from 'vitest';
import { NewSighting, Profile, Sighting } from '../models/models';
import { SupabaseService } from './supabase.service';

describe('SupabaseService persistence', () => {
  const profile: Profile = {
    id: 'player',
    display_name: 'Spieler',
    avatar_url: null,
    current_number: 1,
  };
  const sighting: NewSighting = {
    number: 1,
    type: 'confirmed',
    latitude: null,
    longitude: null,
    accuracy: null,
    note: null,
  };
  let service: SupabaseService;
  let single: Mock;
  let from: Mock;
  let rpc: Mock;
  let upload: Mock;

  beforeEach(() => {
    single = vi.fn().mockName('single').mockResolvedValue({ data: profile, error: null });
    const builder = {
      update: vi
        .fn()
        .mockName('update')
        .mockImplementation(() => builder),
      eq: vi
        .fn()
        .mockName('eq')
        .mockImplementation(() => builder),
      select: vi
        .fn()
        .mockName('select')
        .mockImplementation(() => builder),
      single,
    };
    from = vi.fn().mockName('from').mockReturnValue(builder);
    rpc = vi.fn().mockName('rpc').mockReturnValue({ single });
    upload = vi.fn().mockName('upload').mockResolvedValue({ error: null });
    // Supply a local client stub without starting a real Supabase auth session.
    service = Object.create(SupabaseService.prototype) as SupabaseService;
    Object.defineProperty(service, 'sightingsCache', { value: new Map() });
    Object.defineProperty(service, 'groupsCache', { value: new Map() });
    Object.defineProperty(service, 'membersCache', { value: new Map() });
    Object.defineProperty(service, 'client', {
      value: {
        from,
        rpc,
        storage: {
          from: () => ({
            upload,
            getPublicUrl: () => ({ data: { publicUrl: 'https://example.test/avatar.png' } }),
          }),
        },
      },
    });
  });

  it('uses one RPC and returns the database profile without direct table writes', async () => {
    expect(await service.saveSighting(sighting)).toEqual(profile);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('capture_sighting', {
      p_number: 1,
      p_type: 'confirmed',
      p_latitude: null,
      p_longitude: null,
      p_accuracy: null,
      p_note: null,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('propagates an RPC conflict to the capture UI', async () => {
    const error = { code: 'NC001', message: 'Already completed' };
    single.mockResolvedValue({ data: null, error });
    await expect(service.saveSighting(sighting)).rejects.toEqual(error);
  });

  it('does not report avatar success if its profile update fails', async () => {
    const error = { code: '42501', message: 'Permission denied' };
    single.mockResolvedValue({ data: null, error });
    await expect(
      service.uploadAvatar('player', new File(['image'], 'avatar.png', { type: 'image/png' })),
    ).rejects.toEqual(error);
    expect(upload).toHaveBeenCalled();
  });

  it('rejects avatar updates that affect no profile', async () => {
    single.mockResolvedValue({ data: null, error: null });
    await expect(
      service.uploadAvatar('player', new File(['image'], 'avatar.png')),
    ).rejects.toThrowError('Avatar konnte nicht gespeichert werden.');
  });

  it('returns the avatar URL only after storage and profile updates succeed', async () => {
    const url = await service.uploadAvatar('player', new File(['image'], 'avatar.png'));
    expect(url).toMatch(/^https:\/\/example\.test\/avatar\.png\?v=\d+$/);
    expect(single).toHaveBeenCalledTimes(1);
  });

  it('caches own sightings during the current session', async () => {
    const sightings: Sighting[] = [
      {
        id: 'sighting',
        user_id: 'player',
        number: 1,
        type: 'confirmed',
        latitude: null,
        longitude: null,
        accuracy: null,
        note: null,
        created_at: '2026-09-21T08:00:00.000Z',
      },
    ];
    const query = {
      select: vi.fn().mockName('query.select'),
      eq: vi.fn().mockName('query.eq'),
      order: vi.fn().mockName('query.order'),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockResolvedValue({ data: sightings, error: null });
    const cachedService = Object.create(SupabaseService.prototype) as SupabaseService;
    Object.defineProperty(cachedService, 'sightingsCache', { value: new Map() });
    Object.defineProperty(cachedService, 'groupsCache', { value: new Map() });
    Object.defineProperty(cachedService, 'membersCache', { value: new Map() });
    const fromSpy = vi.fn().mockName('from').mockReturnValue(query);
    Object.defineProperty(cachedService, 'client', { value: { from: fromSpy } });

    await cachedService.ownSightings('player');
    const result = await cachedService.ownSightings('player');

    expect(result).toEqual(sightings);
    expect(fromSpy).toHaveBeenCalledTimes(1);
    expect(fromSpy).toHaveBeenCalledWith('sightings');
  });
});
