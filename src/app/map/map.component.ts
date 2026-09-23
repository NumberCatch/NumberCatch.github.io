import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Map as MapLibreMap } from 'maplibre-gl';
import { NgxMapLibreGLModule } from '@maplibre/ngx-maplibre-gl';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialog, ConfirmDialogData } from '../shared/confirm-dialog/confirm-dialog';
import { AuthService } from '../services/auth.service';
import { Sighting } from '../models/models';
import { SupabaseService } from '../services/supabase.service';
import { distanceInMeters, GeolocationService } from '../services/geolocation';
import { environment } from '../../environments/environment';
import {
  LucideArrowDownUp,
  LucideChevronDown,
  LucideLocateFixed,
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
  imports: [
    CommonModule,
    NgxMapLibreGLModule,
    MatButtonToggleModule,
    MatMenuModule,
    MatTooltipModule,
    MatDialogModule,
    LucideArrowDownUp,
    LucideChevronDown,
    LucideLocateFixed,
    LucideMapPin,
    LucideTrash,
  ],
  styleUrl: './map.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './map.component.html',
})
export class MapComponent implements OnDestroy {
  @ViewChild('map', { read: ElementRef }) private mapElement?: ElementRef<HTMLElement>;
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  readonly geolocation = inject(GeolocationService);
  private readonly dialog = inject(MatDialog);
  private readonly viewportStorageKey = 'number-catch-map-viewport';
  private map?: MapLibreMap;
  private distanceReference?: MapCenter;
  private readonly filterStorageKey = 'number-catch-map-filters-v2';
  readonly sightings = signal<Sighting[]>([]);
  readonly selectedSightingId = signal<string | null>(null);
  readonly selectedSighting = computed(() =>
    this.sightings().find((sighting) => sighting.id === this.selectedSightingId()),
  );
  readonly view = signal<SightingView>('all');
  readonly gpsOnly = signal(false);
  readonly sortOrder = signal<SightingSort>('number');
  readonly loadError = signal('');
  readonly locationError = signal('');
  readonly locating = signal(false);
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
  readonly mapStyle = environment.mapStyleUrl;
  readonly center = signal<MapCenter>([10.45, 51.16]);
  readonly zoom = signal(5);

  constructor() {
    const viewport = this.loadViewport();
    this.center.set(viewport.center);
    this.zoom.set(viewport.zoom);
    const preferences = this.loadFilterPreferences();
    this.visibleStatuses.set(new Set(preferences.visibleStatuses));
    this.view.set(preferences.view);
    this.gpsOnly.set(preferences.gpsOnly);
    this.sortOrder.set(preferences.sortOrder);
  }

  onMapLoad(map: MapLibreMap): void {
    this.map = map;
    void this.load();
  }

  onMoveEnd(): void {
    this.saveViewport();
  }

  async centerOnUser(): Promise<void> {
    if (this.locating()) return;
    this.locating.set(true);
    this.locationError.set('');
    try {
      const position = await this.geolocation.activate();
      if (!position) {
        this.locationError.set('Standort konnte nicht ermittelt werden.');
        return;
      }
      const center: MapCenter = [position.coords.longitude, position.coords.latitude];
      if (this.sortOrder() === 'distance') this.distanceReference = center;
      this.map?.flyTo({
        center,
        zoom: Math.max(this.map.getZoom(), 14),
        duration: 1000,
        essential: true,
      });
    } catch {
      this.locationError.set('Standort konnte nicht ermittelt werden.');
    } finally {
      this.locating.set(false);
    }
  }

  ngOnDestroy(): void {
    this.map = undefined;
  }

  private async load(): Promise<void> {
    const userId = this.auth.profile()?.id;
    if (!userId) return;
    try {
      const sightings = await this.supabase.ownSightings(userId);
      this.sightings.set(sightings);
    } catch (error) {
      this.loadError.set(
        error instanceof Error ? error.message : 'Vormerkungen konnten nicht geladen werden.',
      );
    }
  }

  focus(sighting: Sighting): void {
    this.selectedSightingId.set(sighting.id);
    this.mapElement?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (sighting.latitude === null || sighting.longitude === null || !this.map) return;
    this.map.flyTo({
      center: [sighting.longitude, sighting.latitude],
      zoom: 14,
      duration: 1000,
      essential: true,
    });
  }

  selectFromMarker(sighting: Sighting): void {
    this.selectedSightingId.set(sighting.id);
  }

  closePopup(sighting: Sighting): void {
    if (this.selectedSightingId() === sighting.id) this.selectedSightingId.set(null);
  }

  async remove(sighting: Sighting, event: Event): Promise<void> {
    event.stopPropagation();
    const confirmed = await this.confirm({
      title: 'Vormerkung löschen?',
      message: `Vormerkung ${sighting.number} wirklich löschen?`,
      confirmLabel: 'Löschen',
    });
    if (!confirmed) return;
    const userId = this.auth.profile()?.id;
    if (!userId) return;
    try {
      await this.supabase.deleteSighting(userId, sighting.id);
      if (this.selectedSightingId() === sighting.id) this.selectedSightingId.set(null);
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
    this.saveFilterPreferences();
    this.updateMarkerVisibility();
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
    if (nextSort === 'distance') {
      this.distanceReference = this.userCoordinates() ?? this.mapCenter();
    }
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

  statusColor(sighting: Sighting): string {
    if (sighting.type === 'confirmed') return '#48a868';
    const days = (Date.now() - Date.parse(sighting.created_at)) / 86400000;
    return days <= 7 ? '#ef8354' : days <= 30 ? '#f2c14e' : '#829ab1';
  }

  private updateMarkerVisibility(): void {
    const visibleIds = new Set(this.visibleSightings().map((sighting) => sighting.id));
    const selectedId = this.selectedSightingId();
    if (selectedId && !visibleIds.has(selectedId)) {
      this.selectedSightingId.set(null);
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

  userCoordinates(): MapCenter | null {
    const position = this.geolocation.position();
    return position ? [position.coords.longitude, position.coords.latitude] : null;
  }

  private distance(sighting: Sighting, reference: MapCenter): number {
    if (sighting.latitude === null || sighting.longitude === null) {
      return Number.POSITIVE_INFINITY;
    }
    return distanceInMeters(
      { latitude: sighting.latitude, longitude: sighting.longitude },
      { latitude: reference[1], longitude: reference[0] },
    );
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

  routeUrl(sighting: Sighting): string {
    return `https://www.google.com/maps/dir/?api=1&destination=${sighting.latitude},${sighting.longitude}`;
  }

  private async confirm(data: ConfirmDialogData): Promise<boolean> {
    return (await firstValueFrom(this.dialog.open(ConfirmDialog, { data }).afterClosed())) === true;
  }
}
