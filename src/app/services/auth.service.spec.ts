import { AuthService } from './auth.service';
import { Profile } from '../models/models';
import { SupabaseService } from './supabase.service';

describe('AuthService', () => {
  it('loads the initial session only once for repeated initialization calls', async () => {
    const profile: Profile = {
      id: 'player',
      display_name: 'Spieler',
      avatar_url: null,
      current_number: 12,
    };
    const getUser = vi
      .fn()
      .mockName('getUser')
      .mockResolvedValue({
        data: { user: { id: profile.id } },
      });
    const ensureProfile = vi.fn().mockName('ensureProfile').mockResolvedValue(profile);
    const supabase = {
      client: { auth: { getUser } },
      ensureProfile,
    } as unknown as SupabaseService;
    const service = new AuthService(supabase);

    await Promise.all([service.initialize(), service.initialize(), service.initialize()]);

    expect(getUser).toHaveBeenCalledTimes(1);

    expect(getUser).toHaveBeenCalledWith();
    expect(ensureProfile).toHaveBeenCalledTimes(1);
    expect(ensureProfile).toHaveBeenCalledWith(profile.id, 'Spieler');
    expect(service.authenticated()).toBe(true);
    expect(service.profile()).toEqual(profile);
  });

  it('allows a retry when initial session loading fails', async () => {
    const getUser = vi
      .fn()
      .mockName('getUser')
      .mockRejectedValue(new Error('temporary network failure'));
    const supabase = {
      client: { auth: { getUser } },
    } as unknown as SupabaseService;
    const service = new AuthService(supabase);

    await expect(service.initialize()).rejects.toThrowError('temporary network failure');
    getUser.mockResolvedValue({ data: { user: null } });

    await service.initialize();

    expect(getUser).toHaveBeenCalledTimes(2);
    expect(service.authenticated()).toBe(false);
  });
});
