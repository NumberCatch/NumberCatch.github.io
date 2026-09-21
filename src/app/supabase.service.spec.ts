import { NewSighting, Profile, Sighting } from './models';
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
  let single: jasmine.Spy;
  let from: jasmine.Spy;
  let rpc: jasmine.Spy;
  let upload: jasmine.Spy;

  beforeEach(() => {
    single = jasmine.createSpy('single').and.resolveTo({ data: profile, error: null });
    const builder = {
      update: jasmine.createSpy('update').and.callFake(() => builder),
      eq: jasmine.createSpy('eq').and.callFake(() => builder),
      select: jasmine.createSpy('select').and.callFake(() => builder),
      single,
    };
    from = jasmine.createSpy('from').and.returnValue(builder);
    rpc = jasmine.createSpy('rpc').and.returnValue({ single });
    upload = jasmine.createSpy('upload').and.resolveTo({ error: null });
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
    expect(rpc).toHaveBeenCalledOnceWith('capture_sighting', {
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
    single.and.resolveTo({ data: null, error });
    await expectAsync(service.saveSighting(sighting)).toBeRejectedWith(error);
  });

  it('does not report avatar success if its profile update fails', async () => {
    const error = { code: '42501', message: 'Permission denied' };
    single.and.resolveTo({ data: null, error });
    await expectAsync(
      service.uploadAvatar('player', new File(['image'], 'avatar.png', { type: 'image/png' })),
    ).toBeRejectedWith(error);
    expect(upload).toHaveBeenCalled();
  });

  it('rejects avatar updates that affect no profile', async () => {
    single.and.resolveTo({ data: null, error: null });
    await expectAsync(
      service.uploadAvatar('player', new File(['image'], 'avatar.png')),
    ).toBeRejectedWithError('Avatar konnte nicht gespeichert werden.');
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
    const query = jasmine.createSpyObj('query', ['select', 'eq', 'order']);
    query.select.and.returnValue(query);
    query.eq.and.returnValue(query);
    query.order.and.resolveTo({ data: sightings, error: null });
    const cachedService = Object.create(SupabaseService.prototype) as SupabaseService;
    Object.defineProperty(cachedService, 'sightingsCache', { value: new Map() });
    Object.defineProperty(cachedService, 'groupsCache', { value: new Map() });
    Object.defineProperty(cachedService, 'membersCache', { value: new Map() });
    const fromSpy = jasmine.createSpy('from').and.returnValue(query);
    Object.defineProperty(cachedService, 'client', { value: { from: fromSpy } });

    await cachedService.ownSightings('player');
    const result = await cachedService.ownSightings('player');

    expect(result).toEqual(sightings);
    expect(fromSpy).toHaveBeenCalledOnceWith('sightings');
  });
});
