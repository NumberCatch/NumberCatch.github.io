import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { Passkeys } from './passkeys';

describe('Passkeys', () => {
  const list = vi.fn();
  const registerPasskey = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();

  beforeEach(async () => {
    list.mockReset().mockResolvedValue({
      data: [{ id: 'key-1', friendly_name: 'Telefon', created_at: '2026-01-01' }],
      error: null,
    });
    registerPasskey.mockReset().mockResolvedValue({ error: null });
    update.mockReset().mockResolvedValue({ error: null });
    remove.mockReset().mockResolvedValue({ error: null });
    await TestBed.configureTestingModule({
      imports: [Passkeys],
      providers: [
        provideRouter([]),
        {
          provide: SupabaseService,
          useValue: {
            client: { auth: { passkey: { list, update, delete: remove }, registerPasskey } },
          },
        },
      ],
    }).compileComponents();
  });

  it('lists and registers passkeys on the management page', async () => {
    const fixture = TestBed.createComponent(Passkeys);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.passkeys()[0].name).toBe('Telefon');
    expect(fixture.nativeElement.querySelector('.passkey-entry')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('button.primary')?.textContent).toContain(
      'Passkey hinzufügen',
    );
    expect(fixture.nativeElement.querySelector('a[href="/profile"]')).toBeTruthy();

    await fixture.componentInstance.addPasskey();
    expect(registerPasskey).toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('renames and deletes a passkey', async () => {
    const fixture = TestBed.createComponent(Passkeys);
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
