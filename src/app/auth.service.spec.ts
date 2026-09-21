import { AuthService } from './auth.service';
import { Profile } from './models';
import { SupabaseService } from './supabase.service';

describe('AuthService', () => {
  it('loads the initial session only once for repeated initialization calls', async () => {
    const profile: Profile = {
      id: 'player',
      display_name: 'Spieler',
      avatar_url: null,
      current_number: 12,
    };
    const getUser = jasmine.createSpy('getUser').and.resolveTo({
      data: { user: { id: profile.id } },
    });
    const ensureProfile = jasmine.createSpy('ensureProfile').and.resolveTo(profile);
    const supabase = {
      client: { auth: { getUser } },
      ensureProfile,
    } as unknown as SupabaseService;
    const service = new AuthService(supabase);

    await Promise.all([service.initialize(), service.initialize(), service.initialize()]);

    expect(getUser).toHaveBeenCalledOnceWith();
    expect(ensureProfile).toHaveBeenCalledOnceWith(profile.id, 'Spieler');
    expect(service.authenticated()).toBeTrue();
    expect(service.profile()).toEqual(profile);
  });

  it('allows a retry when initial session loading fails', async () => {
    const getUser = jasmine
      .createSpy('getUser')
      .and.rejectWith(new Error('temporary network failure'));
    const supabase = {
      client: { auth: { getUser } },
    } as unknown as SupabaseService;
    const service = new AuthService(supabase);

    await expectAsync(service.initialize()).toBeRejectedWithError('temporary network failure');
    getUser.and.resolveTo({ data: { user: null } });

    await service.initialize();

    expect(getUser).toHaveBeenCalledTimes(2);
    expect(service.authenticated()).toBeFalse();
  });
});
