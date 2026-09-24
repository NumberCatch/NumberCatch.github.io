import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { LoginComponent } from './login.component';

describe('LoginComponent template', () => {
  let fixture: ComponentFixture<LoginComponent>;
  const signInWithPasskey = vi.fn((_signal: AbortSignal) => new Promise<string | null>(() => {}));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { signInWithPasskey } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    signInWithPasskey.mockClear();
  });

  it('shows the display name field only during registration', () => {
    expect(fixture.nativeElement.querySelector('input[name="name"]')).toBeNull();
    fixture.componentInstance.toggleMode();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="name"]')).not.toBeNull();
    fixture.componentInstance.toggleMode();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="name"]')).toBeNull();
  });

  it('shows messages conditionally and removes them when switching modes', () => {
    expect(fixture.nativeElement.querySelector('.success')).toBeNull();
    expect(fixture.nativeElement.querySelector('.error')).toBeNull();
    fixture.componentInstance.message.set('Bitte bestätige deine E-Mail-Adresse.');
    fixture.componentInstance.error.set('Einloggen fehlgeschlagen.');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.success')?.textContent).toContain('E-Mail');
    expect(fixture.nativeElement.querySelector('.error')?.textContent).toContain('fehlgeschlagen');
    fixture.componentInstance.toggleMode();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.success')).toBeNull();
    expect(fixture.nativeElement.querySelector('.error')).toBeNull();
  });

  it('offers passkeys through email autofill without an extra button', () => {
    expect(fixture.nativeElement.querySelector('a[href="/forgot-password"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input[name="email"]').autocomplete).toBe(
      'username webauthn',
    );
    expect(fixture.nativeElement.querySelector('.passkey-button')).toBeNull();
    fixture.componentInstance.toggleMode();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/forgot-password"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[name="email"]').autocomplete).toBe('email');
  });

  it('places registration above password recovery', () => {
    const actions = fixture.nativeElement.querySelectorAll('.auth-page > .text-button');
    expect(actions[0].textContent).toContain('Registrieren');
    expect(actions[1].textContent).toContain('Passwort vergessen');
  });

  it('starts conditional passkey sign-in and aborts it in registration mode', async () => {
    vi.stubGlobal('PublicKeyCredential', {
      isConditionalMediationAvailable: vi.fn().mockResolvedValue(true),
    });
    fixture.componentInstance.toggleMode();
    fixture.componentInstance.toggleMode();
    await Promise.resolve();
    expect(signInWithPasskey).toHaveBeenCalledTimes(1);
    const signal = signInWithPasskey.mock.calls[0][0];
    fixture.componentInstance.toggleMode();
    expect(signal.aborted).toBe(true);
  });
});
