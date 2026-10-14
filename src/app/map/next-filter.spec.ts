import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../services/auth.service';
import { Sighting } from '../models/models';
import { SupabaseService } from '../services/supabase.service';
import { GeolocationService } from '../services/geolocation';
import { MapComponent } from './map.component';

describe('MapComponent next-number filter', () => {
  const profile = { id: 'player', display_name: 'Spieler', avatar_url: null, current_number: 10 };

  beforeEach(() => {
    localStorage.removeItem('number-catch-map-filters-v2');
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { profile: signal(profile) } },
        { provide: SupabaseService, useValue: { ownSightings: vi.fn().mockResolvedValue([]) } },
        {
          provide: GeolocationService,
          useValue: { position: signal(null), activate: vi.fn() },
        },
      ],
    });
  });

  it('shows only the next number when that view is selected', () => {
    const component = TestBed.runInInjectionContext(() => new MapComponent());
    component.sightings.set([10, 11, 12, 15].map(sighting));
    component.setView('next');

    expect(component.visibleSightings().map((item) => item.number)).toEqual([11]);
    expect(component.viewLabel()).toBe('Nächste Zahl');
  });

  it('offers the next-number view in the dropdown', () => {
    const component = TestBed.runInInjectionContext(() => new MapComponent());

    expect(component.viewOptions).toContainEqual({ view: 'next', label: 'Nächste Zahl' });
  });
});

function sighting(number: number): Sighting {
  return {
    id: `sighting-${number}`,
    user_id: 'player',
    number,
    type: 'hint',
    latitude: 50,
    longitude: 8,
    accuracy: 10,
    note: null,
    created_at: '2026-10-14T08:00:00.000Z',
  };
}
