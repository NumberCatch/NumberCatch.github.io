import type { MockedObject } from 'vitest';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { CaptureComponent } from './capture.component';
import { Profile, Sighting } from '../models/models';
import { GeolocationService } from '../services/geolocation';
import { SupabaseService } from '../services/supabase.service';
import { ConfirmDialogData } from '../shared/confirm-dialog/confirm-dialog';

interface ConfirmingCapture {
  confirm(data: ConfirmDialogData): Promise<boolean>;
}

describe('CaptureComponent', () => {
  let fixture: ComponentFixture<CaptureComponent>;
  let component: CaptureComponent;
  let supabase: MockedObject<Pick<SupabaseService, 'saveSighting' | 'ownSightings'>>;
  let geolocation: MockedObject<Pick<GeolocationService, 'activate'>>;
  let dialog: { open: ReturnType<typeof vi.fn> };
  const initialProfile: Profile = {
    id: 'player',
    display_name: 'Spieler',
    avatar_url: null,
    current_number: 37,
  };
  const profile = signal<Profile | null>(initialProfile);

  function position(latitude: number): GeolocationPosition {
    return {
      coords: {
        latitude,
        longitude: 8,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: 1,
      toJSON: () => ({}),
    };
  }

  beforeEach(async () => {
    localStorage.removeItem('number-catch-save-location');
    profile.set({ ...initialProfile });
    supabase = {
      saveSighting: vi.fn().mockName('SupabaseService.saveSighting'),
      ownSightings: vi.fn().mockResolvedValue([]),
    };
    geolocation = { activate: vi.fn().mockResolvedValue(null) };
    dialog = { open: vi.fn(() => ({ afterClosed: () => of(true) })) };
    supabase.saveSighting.mockResolvedValue({ ...initialProfile, current_number: 38 });
    await TestBed.configureTestingModule({
      imports: [CaptureComponent],
      providers: [
        { provide: AuthService, useValue: { profile } },
        { provide: SupabaseService, useValue: supabase },
        { provide: GeolocationService, useValue: geolocation },
        { provide: MatDialog, useValue: dialog },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ number: '38' }) } },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CaptureComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.saveLocation = false;
  });

  it('prefills the next number and applies progress returned by the database', async () => {
    expect(component.number).toBe(38);
    expect(component.buttonLabel()).toBe('Bestätigen');
    await component.submit();
    expect(supabase.saveSighting).toHaveBeenCalledTimes(1);
    expect(supabase.saveSighting).toHaveBeenCalledWith({
      number: 38,
      type: 'confirmed',
      latitude: null,
      longitude: null,
      accuracy: null,
      note: null,
    });
    expect(profile()?.current_number).toBe(38);
    expect(component.number).toBeNull();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.result-card.good')?.textContent).toContain(
      '38 gespeichert',
    );
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('submits instead of moving focus when Enter is pressed in the number input', async () => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[name="number"]');
    expect(input.getAttribute('enterkeyhint')).toBe('send');
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    input.dispatchEvent(event);
    await fixture.whenStable();

    expect(event.defaultPrevented).toBe(true);
    expect(supabase.saveSighting).toHaveBeenCalledTimes(1);
  });

  it('scrolls past the app header when the number input gets focus', () => {
    vi.useFakeTimers();
    const header = document.createElement('header');
    header.className = 'topbar';
    Object.defineProperty(header, 'offsetHeight', { value: 72 });
    document.body.append(header);
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[name="number"]');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    input.focus();
    vi.advanceTimersByTime(300);

    expect(scrollTo).toHaveBeenCalledWith({ top: 72, behavior: 'smooth' });
    header.remove();
    scrollTo.mockRestore();
    vi.useRealTimers();
  });

  it('does not scroll back up when the number input is focused further down the page', () => {
    vi.useFakeTimers();
    const scrollPosition = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(100);
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[name="number"]');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    input.focus();
    vi.advanceTimersByTime(300);

    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
    scrollPosition.mockRestore();
    vi.useRealTimers();
  });

  it('allows repeated future hints without increasing progress', async () => {
    supabase.saveSighting.mockResolvedValue(initialProfile);
    for (let attempt = 0; attempt < 2; attempt++) {
      component.number = 52;
      expect(component.buttonLabel()).toBe('Vormerken');
      await component.submit();
    }
    expect(supabase.saveSighting).toHaveBeenCalledTimes(2);
    expect(vi.mocked(supabase.saveSighting).mock.lastCall![0].type).toBe('hint');
    expect(profile()?.current_number).toBe(37);
  });

  it('does not save invalid input', async () => {
    for (const number of [null, 0, -1, 38.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      component.number = number;
      await component.submit();
    }
    expect(supabase.saveSighting).not.toHaveBeenCalled();
    expect(profile()?.current_number).toBe(37);
  });

  it('saves a past number as a hint after confirmation', async () => {
    supabase.saveSighting.mockResolvedValue(initialProfile);
    component.number = 20;
    const confirm = vi
      .spyOn(component as unknown as ConfirmingCapture, 'confirm')
      .mockResolvedValue(true);

    await component.submit();

    expect(confirm).toHaveBeenCalledOnce();
    expect(vi.mocked(supabase.saveSighting).mock.lastCall![0].type).toBe('hint');
    expect(vi.mocked(supabase.saveSighting).mock.lastCall![0].number).toBe(20);
    expect(profile()?.current_number).toBe(37);
  });

  it('shows failures and retains inputs without optimistic progress', async () => {
    supabase.saveSighting.mockRejectedValue(new Error('network failure'));
    component.note = 'Bahnhof';
    await component.submit();
    fixture.detectChanges();
    const alert: HTMLElement | null = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Speichern konnte nicht bestätigt werden');
    expect(component.number).toBe(38);
    expect(component.note).toBe('Bahnhof');
    expect(profile()?.current_number).toBe(37);
    expect(component.saving()).toBe(false);
    expect(component.saveMessage()).toBe('');
  });

  it('prefills and confirms the next number beyond 999', async () => {
    profile.set({ ...initialProfile, current_number: 999 });
    supabase.saveSighting.mockResolvedValue({ ...initialProfile, current_number: 1000 });
    vi.spyOn(TestBed.inject(ActivatedRoute).snapshot.queryParamMap, 'get').mockReturnValue('1000');
    component.ngOnInit();
    fixture.detectChanges();
    expect(component.number).toBe(1000);
    expect(component.buttonLabel()).toBe('Bestätigen');
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[name="number"]');
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(input.hasAttribute('max')).toBe(false);
    expect(button.disabled).toBe(false);
    await component.submit();
    expect(vi.mocked(supabase.saveSighting).mock.lastCall![0].number).toBe(1000);
    expect(vi.mocked(supabase.saveSighting).mock.lastCall![0].type).toBe('confirmed');
    expect(profile()?.current_number).toBe(1000);
  });

  it('saves numbers beyond 999 as future hints', async () => {
    supabase.saveSighting.mockResolvedValue(initialProfile);
    component.number = 10000;
    expect(component.validNumber()).toBe(true);
    expect(component.buttonLabel()).toBe('Vormerken');
    await component.submit();
    expect(vi.mocked(supabase.saveSighting).mock.lastCall![0].number).toBe(10000);
    expect(vi.mocked(supabase.saveSighting).mock.lastCall![0].type).toBe('hint');
    expect(profile()?.current_number).toBe(37);
  });

  it('explains a stale progress conflict without displaying success', async () => {
    supabase.saveSighting.mockRejectedValue({ code: 'NC001', message: 'Number already completed' });
    await component.submit();
    expect(component.saveError()).toContain('Fortschritt hat sich geändert');
    expect(component.saveMessage()).toBe('');
  });

  it('disables submission and blocks duplicate requests while waiting for GPS', async () => {
    component.saveLocation = true;
    let completeGps: (position: GeolocationPosition) => void = () =>
      expect.fail('GPS callback missing');
    geolocation.activate.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeGps = resolve;
        }),
    );
    const submission = component.submit();
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Standort wird erfasst');
    expect(fixture.nativeElement.querySelector('.loading-spinner')).not.toBeNull();
    await component.submit();
    completeGps(position(50));
    await submission;
    expect(supabase.saveSighting).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.loading-spinner')).toBeNull();
  });

  it('uses the shared GPS service for captures', async () => {
    component.saveLocation = true;
    geolocation.activate.mockResolvedValueOnce(position(50));
    await component.submit();
    component.number = 39;
    geolocation.activate.mockResolvedValueOnce(position(51));
    await component.submit();
    expect(vi.mocked(supabase.saveSighting).mock.calls[0]![0].latitude).toBe(50);
    expect(vi.mocked(supabase.saveSighting).mock.calls[1]![0].latitude).toBe(51);
    component.number = 52;
    geolocation.activate.mockResolvedValueOnce(null);
    await component.submit();
    expect(vi.mocked(supabase.saveSighting).mock.calls[2]![0].latitude).toBeNull();
    expect(component.saveMessage()).toContain('Standort konnte nicht erfasst werden.');
  });

  it('does not request GPS when location saving is disabled', async () => {
    await component.submit();
    expect(geolocation.activate).not.toHaveBeenCalled();
    expect(vi.mocked(supabase.saveSighting).mock.lastCall![0].longitude).toBeNull();
  });

  it('asks before saving the same number within 100 metres', async () => {
    component.saveLocation = true;
    geolocation.activate.mockResolvedValue(position(50));
    supabase.ownSightings.mockResolvedValue([sighting(52, 50.0005, 8)]);
    component.number = 52;
    const confirm = vi
      .spyOn(component as unknown as ConfirmingCapture, 'confirm')
      .mockResolvedValue(true);

    await component.submit();

    expect(confirm).toHaveBeenCalledOnce();
    expect(supabase.saveSighting).toHaveBeenCalledOnce();
  });

  it('does not save a nearby duplicate when confirmation is declined', async () => {
    component.saveLocation = true;
    geolocation.activate.mockResolvedValue(position(50));
    supabase.ownSightings.mockResolvedValue([sighting(52, 50.0005, 8)]);
    component.number = 52;
    vi.spyOn(component as unknown as ConfirmingCapture, 'confirm').mockResolvedValue(false);

    await component.submit();

    expect(supabase.saveSighting).not.toHaveBeenCalled();
    expect(component.number).toBe(52);
  });

  it('stores the location preference without starting GPS', () => {
    component.saveLocation = true;

    component.locationPreferenceChanged();

    expect(localStorage.getItem('number-catch-save-location')).toBe('true');
    expect(geolocation.activate).not.toHaveBeenCalled();
  });

  it('keeps the note count and location option usable in their shared row', () => {
    component.note = 'Bahnhof';
    fixture.detectChanges();
    const options: HTMLElement = fixture.nativeElement.querySelector('.note-options');
    const checkbox: HTMLInputElement = options.querySelector('input[name="saveLocation"]')!;
    const initiallyChecked = checkbox.checked;

    expect(options.textContent).toContain('7/500');
    expect(options.textContent).toContain('Standort speichern');
    expect(options.firstElementChild?.textContent).toContain('7/500');
    checkbox.click();

    expect(component.saveLocation).toBe(!initiallyChecked);
  });

  it('restores the saved location preference without starting GPS', () => {
    localStorage.setItem('number-catch-save-location', 'false');

    const restored = TestBed.createComponent(CaptureComponent).componentInstance;

    expect(restored.saveLocation).toBe(false);
    expect(geolocation.activate).not.toHaveBeenCalled();
  });
});

function sighting(number: number, latitude: number, longitude: number): Sighting {
  return {
    id: 'existing',
    user_id: 'player',
    number,
    type: 'hint',
    latitude,
    longitude,
    accuracy: 10,
    note: null,
    created_at: '2026-09-23T08:00:00.000Z',
  };
}
