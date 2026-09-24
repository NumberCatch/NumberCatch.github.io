import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';
import { ProfileComponent } from './profile.component';

describe('ProfileComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { profile: signal(null) } },
        { provide: SupabaseService, useValue: {} },
      ],
    }).compileComponents();
  });

  it('links to password and passkey settings from the security card', () => {
    const fixture = TestBed.createComponent(ProfileComponent);
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.profile-card');

    expect(cards).toHaveLength(2);
    expect(cards[1].querySelector('a[href="/change-password"]')).toBeTruthy();
    expect(cards[1].querySelector('a[href="/passkeys"]')).toBeTruthy();
    expect(cards[1].textContent).not.toContain('Passkey hinzufügen');
  });
});
