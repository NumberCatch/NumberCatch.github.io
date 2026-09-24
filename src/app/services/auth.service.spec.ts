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
      client: { auth: { getUser, onAuthStateChange: vi.fn() } },
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
      client: { auth: { getUser, onAuthStateChange: vi.fn() } },
    } as unknown as SupabaseService;
    const service = new AuthService(supabase);

    await expect(service.initialize()).rejects.toThrowError('temporary network failure');
    getUser.mockResolvedValue({ data: { user: null } });

    await service.initialize();

    expect(getUser).toHaveBeenCalledTimes(2);
    expect(service.authenticated()).toBe(false);
  });

  it('requests a reset link to the app entry URL', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      client: { auth: { resetPasswordForEmail, onAuthStateChange: vi.fn() } },
    } as unknown as SupabaseService;
    const service = new AuthService(supabase);

    expect(await service.requestPasswordReset('test@example.com')).toBeNull();
    expect(resetPasswordForEmail).toHaveBeenCalledWith('test@example.com', {
      redirectTo: `${window.location.origin}${window.location.pathname}`,
    });
  });

  it('checks the current password before updating it', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      client: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { email: 'test@example.com' } } }),
          signInWithPassword,
          updateUser,
          onAuthStateChange: vi.fn(),
        },
      },
    } as unknown as SupabaseService;
    const service = new AuthService(supabase);

    expect(await service.changePassword('new-password', 'old-password')).toBeNull();
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'old-password',
    });
    expect(updateUser).toHaveBeenCalledWith({ password: 'new-password' });
    signInWithPassword.mockResolvedValue({ error: new Error('invalid') });
    expect(await service.changePassword('another-password', 'wrong')).toBe(
      'Bisheriges Passwort ist falsch.',
    );
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it('lets a recovery session update the password without the old password', async () => {
    let onAuthChange: (event: string) => void = () => {};
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      client: {
        auth: {
          onAuthStateChange: vi.fn((callback) => {
            onAuthChange = callback;
          }),
          updateUser,
        },
      },
    } as unknown as SupabaseService;
    const service = new AuthService(supabase);
    onAuthChange('PASSWORD_RECOVERY');

    expect(service.passwordRecovery()).toBe(true);
    expect(await service.changePassword('new-password')).toBeNull();
    expect(updateUser).toHaveBeenCalledWith({ password: 'new-password' });
    expect(service.passwordRecovery()).toBe(false);
  });

  it('loads the profile after passkey sign-in', async () => {
    const profile: Profile = {
      id: 'player',
      display_name: 'Spieler',
      avatar_url: null,
      current_number: 1,
    };
    const signInWithPasskey = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: 'player' } }, error: null });
    const supabase = {
      client: {
        auth: {
          onAuthStateChange: vi.fn(),
          signInWithPasskey,
        },
      },
      ensureProfile: vi.fn().mockResolvedValue(profile),
    } as unknown as SupabaseService;
    const service = new AuthService(supabase);

    const signal = new AbortController().signal;
    expect(await service.signInWithPasskey(signal)).toBeNull();
    expect(signInWithPasskey).toHaveBeenCalledWith({
      options: { mediation: 'conditional', signal },
    });
    expect(service.authenticated()).toBe(true);
    expect(service.profile()).toEqual(profile);
  });
});
