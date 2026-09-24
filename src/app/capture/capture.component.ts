import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { GameService } from '../services/game.service';
import { distanceInMeters, GeolocationService, LocationPosition } from '../services/geolocation';
import { SupabaseService } from '../services/supabase.service';
import { ConfirmDialog, ConfirmDialogData } from '../shared/confirm-dialog/confirm-dialog';

@Component({
  imports: [FormsModule, MatDialogModule],
  templateUrl: './capture.component.html',
  styleUrl: './capture.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CaptureComponent implements OnInit {
  private readonly game = inject(GameService);
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private readonly geolocation = inject(GeolocationService);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly locationPreferenceStorageKey = 'number-catch-save-location';
  number: number | null = null;
  note = '';
  saveLocation = this.loadLocationPreference();
  readonly saveMessage = signal('');
  readonly saveError = signal('');
  readonly saving = signal(false);
  readonly locationStatus = signal(
    this.saveLocation
      ? 'Standort wird beim Speichern erfasst.'
      : 'Standort wird nicht gespeichert.',
  );
  ngOnInit(): void {
    const routeNumber = Number(this.route.snapshot.queryParamMap.get('number'));
    if (Number.isSafeInteger(routeNumber) && routeNumber >= 1) {
      this.number = routeNumber;
    }
  }

  next(): number {
    return (this.auth.profile()?.current_number ?? 0) + 1;
  }

  submitFromNumberInput(event: Event): void {
    event.preventDefault();
    void this.submit();
  }

  scrollNextNumberIntoView(event: FocusEvent, nextNumber: HTMLElement): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || window.scrollY > 24) return;

    window.setTimeout(() => {
      if (document.activeElement !== input) return;
      nextNumber.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    }, 300);
  }

  async submit(): Promise<void> {
    if (this.number === null || !this.validNumber() || this.saving()) return;
    const number = this.number;
    const note = this.note.trim();
    const profile = this.auth.profile();
    if (!profile) return;
    this.saveMessage.set('');
    this.saveError.set('');
    if (note.length > 500) {
      this.saveError.set('Die Notiz darf höchstens 500 Zeichen enthalten.');
      return;
    }
    const result = this.game.classify(profile.current_number, number);
    this.saving.set(true);
    try {
      if (
        result.kind === 'past' &&
        !(await this.confirm({
          title: 'Vergangene Zahl eintragen?',
          message: `${number} ist bereits abgeschlossen. Möchtest du sie trotzdem als private Vormerkung speichern?`,
          confirmLabel: 'Eintragen',
        }))
      ) {
        this.locationStatus.set('Speichern abgebrochen.');
        return;
      }
      this.locationStatus.set(
        this.saveLocation ? 'Standort wird erfasst …' : 'Fund wird ohne Standort gespeichert …',
      );
      const position = this.saveLocation ? await this.geolocation.activate() : null;
      if (
        result.kind !== 'next' &&
        position &&
        (await this.hasNearbyDuplicate(profile.id, number, position))
      ) {
        const saveDuplicate = await this.confirm({
          title: 'Ähnliche Vormerkung gefunden',
          message: `Du hast die ${number} bereits in weniger als 100 m Entfernung eingetragen. Möchtest du sie erneut eintragen?`,
          confirmLabel: 'Trotzdem eintragen',
        });
        if (!saveDuplicate) {
          this.locationStatus.set('Speichern abgebrochen.');
          return;
        }
      }
      this.locationStatus.set('Fund wird gespeichert …');
      const updatedProfile = await this.supabase.saveSighting({
        number,
        type: result.kind === 'next' ? 'confirmed' : 'hint',
        latitude: position?.coords.latitude ?? null,
        longitude: position?.coords.longitude ?? null,
        accuracy: position?.coords.accuracy ?? null,
        note: note || null,
      });
      this.auth.profile.set(updatedProfile);
      this.saveMessage.set(
        result.kind === 'next'
          ? `${result.number} gespeichert – dein Fortschritt wurde erhöht.`
          : `${result.number} wurde als private Vormerkung gespeichert.`,
      );
      this.locationStatus.set(
        position ? 'Mit Standort gespeichert.' : 'Ohne Standort gespeichert.',
      );
      this.number = null;
      this.note = '';
    } catch (error: unknown) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      this.saveError.set(
        code === 'NC001' || code === 'NC002' || code === '23505'
          ? 'Dein Fortschritt hat sich geändert. Bitte lade die Seite neu und prüfe die Zahl.'
          : 'Speichern konnte nicht bestätigt werden. Bitte prüfe deine Verbindung und lade die Funde neu, bevor du es erneut versuchst.',
      );
      this.locationStatus.set('Speichern beendet.');
    } finally {
      this.saving.set(false);
    }
  }

  buttonLabel(): string {
    if (!this.validNumber() || this.number === null) return 'Zahl eingeben';
    const kind = this.game.classify(this.auth.profile()?.current_number ?? 0, this.number).kind;
    return kind === 'next' ? 'Bestätigen' : kind === 'hint' ? 'Vormerken' : 'Nachtragen';
  }

  validNumber(): boolean {
    return this.number !== null && Number.isSafeInteger(this.number) && this.number >= 1;
  }

  locationPreferenceChanged(): void {
    try {
      window.localStorage.setItem(this.locationPreferenceStorageKey, String(this.saveLocation));
    } catch {
      // The preference remains valid for this app session when local storage is unavailable.
    }
    if (!this.saveLocation) {
      this.locationStatus.set('Standort wird nicht gespeichert.');
    } else {
      this.locationStatus.set('Standort wird beim Speichern erfasst.');
    }
  }

  private loadLocationPreference(): boolean {
    try {
      const stored = window.localStorage.getItem(this.locationPreferenceStorageKey);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  }

  private async hasNearbyDuplicate(
    userId: string,
    number: number,
    position: LocationPosition,
  ): Promise<boolean> {
    try {
      const sightings = await this.supabase.ownSightings(userId);
      return sightings.some(
        (sighting) =>
          sighting.number === number &&
          sighting.latitude !== null &&
          sighting.longitude !== null &&
          distanceInMeters(
            { latitude: sighting.latitude, longitude: sighting.longitude },
            position.coords,
          ) <= 100,
      );
    } catch (error) {
      console.warn('Die lokale Doppelprüfung konnte nicht durchgeführt werden.', error);
      return false;
    }
  }

  private async confirm(data: ConfirmDialogData): Promise<boolean> {
    return (await firstValueFrom(this.dialog.open(ConfirmDialog, { data }).afterClosed())) === true;
  }
}
