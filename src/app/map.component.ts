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
import { LucideMapPin, LucideTrash } from '@lucide/angular';

type SightingStatus = 'confirmed' | 'fresh' | 'old' | 'stale';
type MapCenter = [number, number];

interface MapViewport {
  center: MapCenter;
  zoom: number;
}

@Component({
  standalone: true,
  imports: [CommonModule, LucideMapPin, LucideTrash],
  template: `<section class="page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">PRIVATE KARTE</p>
        <h1>Deine Funde</h1>
      </div>
    </div>
    <div #map class="map"></div>
    <div class="map-legend">
      <button
        *ngFor="let option of statusOptions"
        type="button"
        class="legend-filter"
        [class.inactive]="!isStatusVisible(option.status)"
        [attr.aria-pressed]="isStatusVisible(option.status)"
        (click)="toggleStatus(option.status)"
      >
        <i [ngClass]="option.status"></i>{{ option.label }}
      </button>
      <button type="button" class="reset-filter" (click)="showAllStatuses()">Alle</button>
    </div>
    <p class="muted map-note">Nur du siehst die GPS-Standorte deiner eigenen Funde.</p>
    @if (loadError()) {
      <p class="error">{{ loadError() }}</p>
    }
    @if (sightings().length) {
      <div class="sighting-list">
        <h2>Funde</h2>
        @if (!visibleSightings().length) {
          <p class="muted">Keine Funde für diese Filter.</p>
        }
        <div
          class="sighting-row"
          [class.selected]="selectedSightingId() === sighting.id"
          *ngFor="let sighting of visibleSightings()"
          (click)="focus(sighting)"
          role="button"
          tabindex="0"
          [attr.aria-pressed]="selectedSightingId() === sighting.id"
          (keydown.enter)="focus(sighting)"
        >
          <span class="sighting-number" [ngClass]="statusClass(sighting)">{{
            sighting.number
          }}</span>
          @if (sighting.latitude !== null && sighting.longitude !== null) {
            <svg class="sighting-location" lucideMapPin aria-label="Standort vorhanden"></svg>
          }
          <span class="sighting-details"
            ><strong>{{
              sighting.type === 'confirmed' ? 'Bestätigt' : ageLabel(sighting.created_at)
            }}</strong
            ><small
              >{{ sighting.created_at | date: 'dd.MM.yyyy, HH:mm' }} Uhr
              @if (sighting.note) {
                <span> · {{ sighting.note }}</span>
              }
            </small></span
          >
          @if (sighting.type === 'hint') {
            <button
              class="delete-button"
              type="button"
              (click)="remove(sighting, $event)"
              aria-label="Vormerkung löschen"
              title="Vormerkung löschen"
            >
              <svg lucideTrash></svg>
            </button>
          }
        </div>
      </div>
    } @else {
      <div class="empty-state compact">
        <h2>Noch keine Funde</h2>
        <p class="muted">Spätere Zahlen kannst du beim Erfassen vormerken.</p>
      </div>
    }
  </section>`,
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('map', { static: true }) mapElement!: ElementRef<HTMLDivElement>;
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly viewportStorageKey = 'number-catch-map-viewport';
  private map?: MapLibreMap;
  private geolocateControl?: GeolocateControl;
  private activePopup?: Popup;
  private readonly markers = new Map<string, Marker>();
  readonly sightings = signal<Sighting[]>([]);
  readonly selectedSightingId = signal<string | null>(null);
  readonly loadError = signal('');
  readonly statusOptions: ReadonlyArray<{ status: SightingStatus; label: string }> = [
    { status: 'confirmed', label: 'bestätigt' },
    { status: 'fresh', label: 'aktuell' },
    { status: 'old', label: 'älter' },
    { status: 'stale', label: 'veraltet' },
  ];
  readonly visibleStatuses = signal<Set<SightingStatus>>(
    new Set(this.statusOptions.map((option) => option.status)),
  );
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
        const popup = new maplibregl.Popup().setText(
          `${sighting.number} · ${sighting.type === 'confirmed' ? 'Bestätigt' : this.ageLabel(sighting.created_at)}${sighting.note ? ` · ${sighting.note}` : ''}`,
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
    return this.sightings().filter((sighting) => visibleStatuses.has(this.statusClass(sighting)));
  }
  isStatusVisible(status: SightingStatus): boolean {
    return this.visibleStatuses().has(status);
  }
  toggleStatus(status: SightingStatus): void {
    const statuses = new Set(this.visibleStatuses());
    if (statuses.has(status)) statuses.delete(status);
    else statuses.add(status);
    this.visibleStatuses.set(statuses);
    this.updateMarkerVisibility();
  }
  showAllStatuses(): void {
    this.visibleStatuses.set(new Set(this.statusOptions.map((option) => option.status)));
    this.updateMarkerVisibility();
  }
  private updateMarkerVisibility(): void {
    const visibleStatuses = this.visibleStatuses();
    for (const sighting of this.sightings()) {
      const marker = this.markers.get(sighting.id);
      if (marker) {
        marker.getElement().style.display = visibleStatuses.has(this.statusClass(sighting))
          ? ''
          : 'none';
      }
    }
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
}
