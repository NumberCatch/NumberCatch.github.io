import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';
import { ProfileComponent } from './profile.component';

describe('ProfileComponent passkeys', () => {
  const list = vi.fn();
  const registerPasskey = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();

  beforeEach(async () => {
    list.mockResolvedValue({
      data: [{ id: 'key-1', friendly_name: 'Telefon', created_at: '2026-01-01' }],
      error: null,
    });
    registerPasskey.mockResolvedValue({ error: null });
    update.mockResolvedValue({ error: null });
    remove.mockResolvedValue({ error: null });
    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { profile: signal(null) } },
        {
          provide: SupabaseService,
          useValue: {
            client: { auth: { passkey: { list, update, delete: remove }, registerPasskey } },
          },
        },
      ],
    }).compileComponents();
  });

  it('lists and registers passkeys', async () => {
    const fixture = TestBed.createComponent(ProfileComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.passkeys()[0].name).toBe('Telefon');

    await fixture.componentInstance.addPasskey();
    expect(registerPasskey).toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('keeps password settings and passkeys in separate cards', async () => {
    const fixture = TestBed.createComponent(ProfileComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const cards = fixture.nativeElement.querySelectorAll('.profile-card');

    expect(cards).toHaveLength(3);
    expect(cards[1].textContent).toContain('Passwort ändern');
    expect(cards[1].textContent).not.toContain('Passkeys');
    expect(cards[2].textContent).toContain('Passkeys');
    expect(cards[2].textContent).toContain('Passkey hinzufügen');
  });

  it('renames and deletes a passkey', async () => {
    const fixture = TestBed.createComponent(ProfileComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const passkey = fixture.componentInstance.passkeys()[0];
    passkey.name = 'Tablet';
    await fixture.componentInstance.renamePasskey(passkey);
    expect(update).toHaveBeenCalledWith({ passkeyId: 'key-1', friendlyName: 'Tablet' });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await fixture.componentInstance.deletePasskey(passkey);
    expect(remove).toHaveBeenCalledWith({ passkeyId: 'key-1' });
    expect(fixture.componentInstance.passkeys()).toEqual([]);
    vi.restoreAllMocks();
  });
});
