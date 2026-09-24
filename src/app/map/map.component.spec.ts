import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../services/auth.service';
import { MapComponent } from './map.component';
import { Profile, Sighting } from '../models/models';
import { SupabaseService } from '../services/supabase.service';
import { GeolocationService, LocationPosition } from '../services/geolocation';
import { Map as MapLibreMap } from 'maplibre-gl';

describe('MapComponent filters', () => {
  let currentPosition: ReturnType<typeof signal<LocationPosition | null>>;
  let activate: ReturnType<typeof vi.fn>;
  const profile: Profile = {
    id: 'player',
    display_name: 'Spieler',
    avatar_url: null,
    current_number: 10,
  };

  beforeEach(() => {
    currentPosition = signal<LocationPosition | null>(null);
    activate = vi.fn();
    localStorage.removeItem('number-catch-map-filters-v2');
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { profile: signal<Profile | null>(profile) } },
        {
          provide: SupabaseService,
          useValue: { ownSightings: vi.fn().mockResolvedValue([]) },
        },
        {
          provide: GeolocationService,
          useValue: { position: currentPosition, activate },
        },
      ],
    });
  });

  it('keeps the same next five numbers when the sort order changes', () => {
    const component = TestBed.runInInjectionContext(() => new MapComponent());
    component.sightings.set(sightings());
    component.view.set('nextFive');

    component.toggleSort();

    expect(component.visibleSightings().map((sighting) => sighting.number)).toEqual([
      15, 14, 13, 12, 11,
    ]);
  });

  it('keeps the shared GPS position when the map component is recreated', () => {
    currentPosition.set({ coords: { latitude: 50, longitude: 8, accuracy: 10 } });

    const first = TestBed.runInInjectionContext(() => new MapComponent());
    const second = TestBed.runInInjectionContext(() => new MapComponent());

    expect(first.userCoordinates()).toEqual([8, 50]);
    expect(second.userCoordinates()).toEqual([8, 50]);
  });

  it('centers once using the shared GPS service', async () => {
    const position = { coords: { latitude: 50, longitude: 8, accuracy: 10 } };
    const map = {
      getZoom: vi.fn().mockReturnValue(5),
      flyTo: vi.fn(),
    };
    activate.mockResolvedValue(position);
    const component = TestBed.runInInjectionContext(() => new MapComponent());
    component.onMapLoad(map as unknown as MapLibreMap);

    await component.centerOnUser();

    expect(activate).toHaveBeenCalledTimes(1);
    expect(map.flyTo).toHaveBeenCalledWith({
      center: [8, 50],
      zoom: 14,
      duration: 1000,
      essential: true,
    });
  });

  it('labels the list without a duplicate visible heading', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const fixture = TestBed.createComponent(MapComponent);
    fixture.componentInstance.sightings.set(sightings());
    fixture.detectChanges();

    const list = fixture.nativeElement.querySelector('.sighting-list');
    expect(list?.getAttribute('aria-label')).toBe('Fundliste');
    expect(list?.querySelector('h2')).toBeNull();
    expect(list?.querySelector('.sighting-list-toolbar')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.map-note')).toBeNull();
    getContext.mockRestore();
  });
});

function sightings(): Sighting[] {
  return [11, 12, 13, 14, 15, 16].map((number, index) => ({
    id: `sighting-${number}`,
    user_id: 'player',
    number,
    type: 'hint',
    latitude: 50 + index,
    longitude: 8 + index,
    accuracy: 10,
    note: null,
    created_at: `2026-09-${String(16 + index).padStart(2, '0')}T08:00:00.000Z`,
  }));
}
