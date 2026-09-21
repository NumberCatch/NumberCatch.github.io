import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import maplibregl, {
  GeolocateControl,
  Map as MapLibreMap,
  Marker,
  Popup,
} from 'maplibre-gl';
import { AuthService } from './auth.service';
import { Sighting } from './models';
import { SupabaseService } from './supabase.service';
import { environment } from '../environments/environment';
import {
  LucideArrowDownUp,
  LucideCheck,
  LucideChevronDown,
  LucideMapPin,
  LucideTrash,
} from '@lucide/angular';

type SightingStatus = 'confirmed' | 'fresh' | 'old' | 'stale';
type SightingSort = 'number' | 'newest' | 'distance';
type SightingView = 'all' | 'nextFive' | 'open' | 'completed';
type MapCenter = [number, number];

interface MapFilterPreferences {
  visibleStatuses: SightingStatus[];
  view: SightingView;
  gpsOnly: boolean;
  sortOrder: SightingSort;
}

interface MapViewport {
  center: MapCenter;
  zoom: number;
}

@Component({
  standalone: true,
  imports: [
    CommonModule,
    LucideArrowDownUp,
    LucideCheck,
    LucideChevronDown,
    LucideMapPin,
    LucideTrash,
  ],
  styleUrl: './map.component.css',
  templateUrl: './map.component.html',
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('map', { static: true }) mapElement!: ElementRef<HTMLDivElement>;
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly viewportStorageKey = 'number-catch-map-viewport';
  private map?: MapLibreMap;
  private geolocateControl?: GeolocateControl;
  private userLocation?: MapCenter;
  private distanceReference?: MapCenter;
  private activePopup?: Popup;
  private readonly markers = new Map<string, Marker>();
  private readonly filterStorageKey = 'number-catch-map-filters-v2';
  readonly sightings = signal<Sighting[]>([]);
  readonly selectedSightingId = signal<string | null>(null);
  readonly view = signal<SightingView>('all');
  readonly viewMenuOpen = signal(false);
  readonly gpsOnly = signal(false);
  readonly sortOrder = signal<SightingSort>('number');
  readonly loadError = signal('');
  readonly statusOptions: ReadonlyArray<{ status: SightingStatus; label: string }> = [
    { status: 'confirmed', label: 'bestätigt' },
    { status: 'fresh', label: 'aktuell' },
    { status: 'old', label: 'älter' },
    { status: 'stale', label: 'veraltet' },
  ];
  readonly viewOptions: ReadonlyArray<{ view: SightingView; label: string }> = [
    { view: 'all', label: 'Alle' },
    { view: 'nextFive', label: 'Nächste 5' },
    { view: 'open', label: 'Offen' },
    { view: 'completed', label: 'Abgeschlossen' },
  ];
  readonly visibleStatuses = signal<Set<SightingStatus>>(
    new Set(this.statusOptions.map((option) => option.status)),
  );
  constructor() {
    const preferences = this.loadFilterPreferences();
    this.visibleStatuses.set(new Set(preferences.visibleStatuses));
    this.view.set(preferences.view);
    this.gpsOnly.set(preferences.gpsOnly);
    this.sortOrder.set(preferences.sortOrder);
  }
  ngAfterViewInit(): void {
    const viewport = this.loadViewport();
    this.map = new maplibregl.Map({
      container: this.mapElement.nativeElement,
      style: environment.mapStyleUrl,
      center: viewport.center,
      zoom: viewport.zoom,
    });
    this.geolocateControl = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
    });
    this.geolocateControl.on('geolocate', (event) => {
      this.userLocation = [event.coords.longitude, event.coords.latitude];
      if (this.sortOrder() === 'distance') {
        this.distanceReference = this.userLocation;
        this.updateMarkerVisibility();
      }
    });
    this.map.addControl(this.geolocateControl, 'top-right');
    this.map.on('moveend', () => this.saveViewport());
    this.map.once('load', () => this.showAvailableLocation());
    void this.load();
  }
  ngOnDestroy(): void {
    this.map?.remove();
  }
  private async load(): Promise<void> {
    const userId = this.auth.profile()?.id;
    if (!userId) return;
    try {
      const sightings = await this.supabase.ownSightings(userId);
      this.sightings.set(sightings);
      for (const sighting of sightings) {
        if (sighting.latitude === null || sighting.longitude === null) continue;
        const markerElement = document.createElement('div');
        markerElement.className = 'number-marker';
        markerElement.textContent = String(sighting.number);
        markerElement.style.backgroundColor = this.color(sighting);
        const popup = new maplibregl.Popup({ anchor: 'bottom', offset: [0, -42] }).setDOMContent(
          this.popupContent(sighting),
        );
        markerElement.addEventListener('click', () => {
          if (this.activePopup && this.activePopup !== popup) this.activePopup.remove();
          this.selectedSightingId.set(sighting.id);
        });
        popup.on('open', () => (this.activePopup = popup));
        popup.on('close', () => {
          if (this.activePopup === popup) this.activePopup = undefined;
          if (this.selectedSightingId() === sighting.id) this.selectedSightingId.set(null);
        });
        const marker = new maplibregl.Marker({ element: markerElement, anchor: 'bottom' })
          .setLngLat([sighting.longitude, sighting.latitude])
          .setPopup(popup)
          .addTo(this.map!);
        this.markers.set(sighting.id, marker);
      }
      this.updateMarkerVisibility();
    } catch (error) {
      this.loadError.set(
        error instanceof Error ? error.message : 'Vormerkungen konnten nicht geladen werden.',
      );
    }
  }
  focus(sighting: Sighting): void {
    this.selectedSightingId.set(sighting.id);
    if (sighting.latitude === null || sighting.longitude === null || !this.map) return;
    this.mapElement.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.map.flyTo({ center: [sighting.longitude, sighting.latitude], zoom: 14 });
    const marker = this.markers.get(sighting.id);
    if (!marker) return;
    const popup = marker.getPopup();
    if (this.activePopup && this.activePopup !== popup) this.activePopup.remove();
    this.activePopup = popup;
    marker.togglePopup();
  }
  async remove(sighting: Sighting, event: Event): Promise<void> {
    event.stopPropagation();
    if (!window.confirm(`Vormerkung ${sighting.number} wirklich löschen?`)) return;
    const userId = this.auth.profile()?.id;
    if (!userId) return;
    try {
      await this.supabase.deleteSighting(userId, sighting.id);
      if (this.selectedSightingId() === sighting.id) this.selectedSightingId.set(null);
      this.markers.get(sighting.id)?.remove();
      this.markers.delete(sighting.id);
      this.sightings.update((items) => items.filter((item) => item.id !== sighting.id));
    } catch (error) {
      this.loadError.set(
        error instanceof Error ? error.message : 'Vormerkung konnte nicht gelöscht werden.',
      );
    }
  }
  ageLabel(date: string): string {
    const days = (Date.now() - Date.parse(date)) / 86400000;
    return days <= 7 ? 'Aktuell' : days <= 30 ? 'Älter' : 'Wahrscheinlich veraltet';
  }
  statusClass(sighting: Sighting): SightingStatus {
    if (sighting.type === 'confirmed') return 'confirmed';
    const days = (Date.now() - Date.parse(sighting.created_at)) / 86400000;
    return days <= 7 ? 'fresh' : days <= 30 ? 'old' : 'stale';
  }
  visibleSightings(): Sighting[] {
    const visibleStatuses = this.visibleStatuses();
    const currentNumber = this.auth.profile()?.current_number ?? 0;
    let sightings = this.sightings()
      .filter((sighting) => visibleStatuses.has(this.statusClass(sighting)))
      .filter(
        (sighting) =>
          !this.gpsOnly() || (sighting.latitude !== null && sighting.longitude !== null),
      );
    if (this.view() === 'nextFive') {
      sightings = sightings
        .filter((sighting) => sighting.number > currentNumber)
        .sort((left, right) => left.number - right.number)
        .slice(0, 5);
    } else if (this.view() === 'open') {
      sightings = sightings.filter((sighting) => sighting.number > currentNumber);
    } else if (this.view() === 'completed') {
      sightings = sightings.filter((sighting) => sighting.number <= currentNumber);
    }
    return sightings.sort((left, right) => this.compareSightings(left, right));
  }
  isStatusVisible(status: SightingStatus): boolean {
    return this.visibleStatuses().has(status);
  }
  isView(view: SightingView): boolean {
    return this.view() === view;
  }
  viewLabel(): string {
    return this.viewOptions.find((option) => option.view === this.view())?.label ?? 'Alle';
  }
  toggleStatus(status: SightingStatus): void {
    const statuses = new Set(this.visibleStatuses());
    if (statuses.has(status)) statuses.delete(status);
    else statuses.add(status);
    this.visibleStatuses.set(statuses);
    this.saveFilterPreferences();
    this.updateMarkerVisibility();
  }
  setView(view: SightingView): void {
    this.view.set(view);
    this.viewMenuOpen.set(false);
    this.saveFilterPreferences();
    this.updateMarkerVisibility();
  }
  toggleViewMenu(): void {
    this.viewMenuOpen.update((open) => !open);
  }
  toggleGpsOnly(): void {
    this.gpsOnly.update((value) => !value);
    this.saveFilterPreferences();
    this.updateMarkerVisibility();
  }
  toggleSort(): void {
    const sortOrders: SightingSort[] = ['number', 'newest', 'distance'];
    const currentIndex = sortOrders.indexOf(this.sortOrder());
    const nextSort = sortOrders[(currentIndex + 1) % sortOrders.length];
    if (nextSort === 'distance') this.distanceReference = this.userLocation ?? this.mapCenter();
    this.sortOrder.set(nextSort);
    this.saveFilterPreferences();
    this.updateMarkerVisibility();
  }
  sortLabel(): string {
    return this.sortOrder() === 'number'
      ? 'Nummer'
      : this.sortOrder() === 'newest'
        ? 'Neueste'
        : 'Entfernung';
  }
  private updateMarkerVisibility(): void {
    const visibleIds = new Set(this.visibleSightings().map((sighting) => sighting.id));
    const selectedId = this.selectedSightingId();
    if (selectedId && !visibleIds.has(selectedId)) {
      this.activePopup?.remove();
      this.selectedSightingId.set(null);
    }
    for (const sighting of this.sightings()) {
      const marker = this.markers.get(sighting.id);
      if (marker) {
        marker.getElement().style.display = visibleIds.has(sighting.id) ? '' : 'none';
      }
    }
  }
  private loadFilterPreferences(): MapFilterPreferences {
    const defaults = {
      visibleStatuses: this.statusOptions.map((option) => option.status),
      view: 'all' as SightingView,
      gpsOnly: false,
      sortOrder: 'number' as SightingSort,
    };
    try {
      const stored = window.localStorage.getItem(this.filterStorageKey);
      if (!stored) return defaults;
      const value: unknown = JSON.parse(stored);
      if (!value || typeof value !== 'object') return defaults;
      const preferences = value as Partial<MapFilterPreferences>;
      const visibleStatuses = Array.isArray(preferences.visibleStatuses)
        ? preferences.visibleStatuses.filter((status): status is SightingStatus =>
            this.statusOptions.some((option) => option.status === status),
          )
        : defaults.visibleStatuses;
      return {
        visibleStatuses,
        view:
          preferences.view === 'all' ||
          preferences.view === 'nextFive' ||
          preferences.view === 'open' ||
          preferences.view === 'completed'
            ? preferences.view
            : defaults.view,
        gpsOnly: typeof preferences.gpsOnly === 'boolean' ? preferences.gpsOnly : defaults.gpsOnly,
        sortOrder:
          preferences.sortOrder === 'number' ||
          preferences.sortOrder === 'newest' ||
          preferences.sortOrder === 'distance'
            ? preferences.sortOrder
            : defaults.sortOrder,
      };
    } catch {
      return defaults;
    }
  }
  private saveFilterPreferences(): void {
    try {
      window.localStorage.setItem(
        this.filterStorageKey,
        JSON.stringify({
          visibleStatuses: [...this.visibleStatuses()],
          view: this.view(),
          gpsOnly: this.gpsOnly(),
          sortOrder: this.sortOrder(),
        }),
      );
    } catch {
      // Local storage may be unavailable in private browsing mode.
    }
  }
  private compareSightings(left: Sighting, right: Sighting): number {
    if (this.sortOrder() === 'newest') {
      return Date.parse(right.created_at) - Date.parse(left.created_at);
    }
    if (this.sortOrder() === 'distance') {
      const reference = this.distanceReference ?? (this.distanceReference = this.mapCenter());
      if (reference) return this.distance(left, reference) - this.distance(right, reference);
    }
    return left.number - right.number;
  }
  private mapCenter(): MapCenter | undefined {
    if (!this.map) return undefined;
    const center = this.map.getCenter();
    return [center.lng, center.lat];
  }
  private distance(sighting: Sighting, reference: MapCenter): number {
    if (sighting.latitude === null || sighting.longitude === null) {
      return Number.POSITIVE_INFINITY;
    }
    const earthRadiusKm = 6371;
    const latitude = (sighting.latitude * Math.PI) / 180;
    const referenceLatitude = (reference[1] * Math.PI) / 180;
    const latitudeDelta = ((sighting.latitude - reference[1]) * Math.PI) / 180;
    const longitudeDelta = ((sighting.longitude - reference[0]) * Math.PI) / 180;
    const value =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(latitude) *
        Math.cos(referenceLatitude) *
        Math.sin(longitudeDelta / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }
  private loadViewport(): MapViewport {
    const defaultViewport: MapViewport = { center: [10.45, 51.16], zoom: 5 };
    try {
      const stored = window.localStorage.getItem(this.viewportStorageKey);
      if (!stored) return defaultViewport;
      const value: unknown = JSON.parse(stored);
      if (!this.isMapViewport(value)) return defaultViewport;
      return value;
    } catch {
      return defaultViewport;
    }
  }
  private saveViewport(): void {
    if (!this.map) return;
    const center = this.map.getCenter();
    const viewport: MapViewport = {
      center: [center.lng, center.lat],
      zoom: this.map.getZoom(),
    };
    try {
      window.localStorage.setItem(this.viewportStorageKey, JSON.stringify(viewport));
    } catch {
      // Local storage may be unavailable in private browsing mode.
    }
  }
  private isMapViewport(value: unknown): value is MapViewport {
    if (!value || typeof value !== 'object') return false;
    const viewport = value as Partial<MapViewport>;
    return (
      Array.isArray(viewport.center) &&
      viewport.center.length === 2 &&
      typeof viewport.center[0] === 'number' &&
      Number.isFinite(viewport.center[0]) &&
      viewport.center[0] >= -180 &&
      viewport.center[0] <= 180 &&
      typeof viewport.center[1] === 'number' &&
      Number.isFinite(viewport.center[1]) &&
      viewport.center[1] >= -90 &&
      viewport.center[1] <= 90 &&
      typeof viewport.zoom === 'number' &&
      Number.isFinite(viewport.zoom) &&
      viewport.zoom >= 0 &&
      viewport.zoom <= 24
    );
  }
  private showAvailableLocation(): void {
    if (!navigator.geolocation || !this.geolocateControl) return;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((permission) => {
        if (permission.state === 'granted') this.geolocateControl?.trigger();
      })
      .catch(() => undefined);
  }
  private color(sighting: Sighting): string {
    if (sighting.type === 'confirmed') return '#48a868';
    const days = (Date.now() - Date.parse(sighting.created_at)) / 86400000;
    return days <= 7 ? '#ef8354' : days <= 30 ? '#f2c14e' : '#829ab1';
  }
  private popupContent(sighting: Sighting): HTMLDivElement {
    const content = document.createElement('div');
    content.className = 'map-popup-content';

    const title = document.createElement('strong');
    title.textContent = `${sighting.number} · ${sighting.type === 'confirmed' ? 'Bestätigt' : this.ageLabel(sighting.created_at)}`;
    content.append(title);

    const time = document.createElement('small');
    time.textContent = new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(sighting.created_at));
    content.append(time);

    if (sighting.note) {
      const note = document.createElement('span');
      note.textContent = sighting.note;
      content.append(note);
    }

    const route = document.createElement('a');
    route.className = 'popup-route';
    route.href = `https://www.google.com/maps/dir/?api=1&destination=${sighting.latitude},${sighting.longitude}`;
    route.target = '_blank';
    route.rel = 'noopener noreferrer';
    route.textContent = 'Route planen';
    content.append(route);

    return content;
  }
}
