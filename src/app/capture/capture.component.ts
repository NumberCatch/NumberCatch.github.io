import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { CaptureResult, GameService } from '../services/game.service';
import { SupabaseService } from '../services/supabase.service';

@Component({
  imports: [FormsModule],
  templateUrl: './capture.component.html',
  styleUrl: './capture.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CaptureComponent implements OnInit {
  private readonly game = inject(GameService);
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private readonly route = inject(ActivatedRoute);
  readonly result = signal<CaptureResult | null>(null);
  readonly saveMessage = signal('');
  readonly saveError = signal('');
  readonly saving = signal(false);
  readonly locationStatus = signal('Standort wird beim Speichern erfasst.');
  number: number | null = null;
  note = '';
  saveLocation = true;
  ngOnInit(): void {
    const routeNumber = Number(this.route.snapshot.queryParamMap.get('number'));
    if (Number.isSafeInteger(routeNumber) && routeNumber >= 1) {
      this.number = routeNumber;
    }
  }
  next(): number {
    return (this.auth.profile()?.current_number ?? 0) + 1;
  }
  async submit(): Promise<void> {
    if (this.number === null || !this.validNumber() || this.saving()) return;
    const number = this.number;
    const note = this.note.trim();
    const profile = this.auth.profile();
    if (!profile) return;
    this.saveMessage.set('');
    this.saveError.set('');
    this.result.set(null);
    if (note.length > 500) {
      this.saveError.set('Die Notiz darf höchstens 500 Zeichen enthalten.');
      return;
    }
    const result = this.game.classify(profile.current_number, number);
    if (result.kind === 'done') {
      this.result.set(result);
      return;
    }
    this.saving.set(true);
    try {
      this.locationStatus.set(
        this.saveLocation ? 'Standort wird erfasst …' : 'Fund wird ohne Standort gespeichert …',
      );
      const position = this.saveLocation ? await this.capturePosition() : null;
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
      this.result.set(null);
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
  message(result: CaptureResult): string {
    return result.kind === 'next'
      ? `${result.number} ist deine nächste Zahl!`
      : result.kind === 'hint'
        ? `${result.number} vormerken?`
        : `${result.number} ist schon erledigt.`;
  }
  description(result: CaptureResult): string {
    return result.kind === 'next'
      ? `Damit steigt dein Fortschritt auf ${result.number}.`
      : result.kind === 'hint'
        ? 'Der Fund wird als private Vormerkung gespeichert.'
        : 'Diese Zahl ist bereits abgeschlossen.';
  }
  buttonLabel(): string {
    if (!this.validNumber() || this.number === null) return 'Zahl eingeben';
    const kind = this.game.classify(this.auth.profile()?.current_number ?? 0, this.number).kind;
    return kind === 'next' ? 'Bestätigen' : kind === 'hint' ? 'Vormerken' : 'Bereits erledigt';
  }
  validNumber(): boolean {
    return this.number !== null && Number.isSafeInteger(this.number) && this.number >= 1;
  }
  locationPreferenceChanged(): void {
    if (!this.saveLocation) {
      this.locationStatus.set('Standort wird nicht gespeichert.');
    } else {
      this.locationStatus.set('Standort wird beim Speichern erfasst.');
    }
  }
  private capturePosition(): Promise<GeolocationPosition | null> {
    if (!navigator.geolocation) return Promise.resolve(null);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.locationStatus.set('Standort erfasst.');
          resolve(position);
        },
        () => {
          this.locationStatus.set(
            'Standort nicht verfügbar – Fund kann trotzdem gespeichert werden.',
          );
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    });
  }
}
