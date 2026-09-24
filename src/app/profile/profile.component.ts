import { Component, inject, signal, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';
import { LucideLogOut } from '@lucide/angular';
import packageJson from '../../../package.json';

interface PasskeyEntry {
  id: string;
  name: string;
  createdAt: string;
}

@Component({
  imports: [FormsModule, RouterLink, LucideLogOut],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly appVersion = packageJson.version;
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);
  readonly uploading = signal(false);
  readonly passkeyBusy = signal(false);
  readonly passkeys = signal<PasskeyEntry[]>([]);
  readonly passkeyMessage = signal('');
  name = '';
  message = '';
  constructor() {
    this.name = this.auth.profile()?.display_name ?? '';
  }

  ngOnInit(): void {
    void this.loadPasskeys();
  }

  async loadPasskeys(): Promise<void> {
    try {
      const { data, error } = await this.supabase.client.auth.passkey.list();
      if (error) throw error;
      this.passkeys.set(
        (data ?? []).map((passkey) => ({
          id: passkey.id,
          name: passkey.friendly_name ?? 'Passkey',
          createdAt: passkey.created_at,
        })),
      );
    } catch {
      this.passkeyMessage.set('Passkeys konnten nicht geladen werden.');
    }
  }

  async addPasskey(): Promise<void> {
    if (this.passkeyBusy()) return;
    this.passkeyBusy.set(true);
    this.passkeyMessage.set('');
    try {
      const { error } = await this.supabase.client.auth.registerPasskey();
      if (error) throw error;
      await this.loadPasskeys();
      this.passkeyMessage.set('Passkey hinzugefügt.');
    } catch {
      this.passkeyMessage.set('Passkey konnte nicht hinzugefügt werden.');
    } finally {
      this.passkeyBusy.set(false);
    }
  }

  async renamePasskey(passkey: PasskeyEntry): Promise<void> {
    if (this.passkeyBusy() || !passkey.name.trim()) return;
    this.passkeyBusy.set(true);
    this.passkeyMessage.set('');
    try {
      const { error } = await this.supabase.client.auth.passkey.update({
        passkeyId: passkey.id,
        friendlyName: passkey.name.trim(),
      });
      if (error) throw error;
      this.passkeyMessage.set('Passkey umbenannt.');
    } catch {
      this.passkeyMessage.set('Passkey konnte nicht umbenannt werden.');
    } finally {
      this.passkeyBusy.set(false);
    }
  }

  async deletePasskey(passkey: PasskeyEntry): Promise<void> {
    if (this.passkeyBusy() || !window.confirm(`Passkey „${passkey.name}“ löschen?`)) return;
    this.passkeyBusy.set(true);
    this.passkeyMessage.set('');
    try {
      const { error } = await this.supabase.client.auth.passkey.delete({ passkeyId: passkey.id });
      if (error) throw error;
      this.passkeys.update((entries) => entries.filter((entry) => entry.id !== passkey.id));
      this.passkeyMessage.set('Passkey gelöscht.');
    } catch {
      this.passkeyMessage.set('Passkey konnte nicht gelöscht werden.');
    } finally {
      this.passkeyBusy.set(false);
    }
  }

  initials(): string {
    return (this.auth.profile()?.display_name ?? 'Du').slice(0, 2).toUpperCase();
  }

  async save(): Promise<void> {
    const profile = this.auth.profile();
    if (!profile || !this.name.trim()) return;
    try {
      await this.supabase.updateProfile(profile.id, this.name);
      this.auth.profile.set({ ...profile, display_name: this.name.trim() });
      this.message = 'Profil gespeichert.';
    } catch {
      this.message = 'Profil konnte nicht gespeichert werden.';
    }
  }

  async upload(event: Event): Promise<void> {
    if (this.uploading()) return;
    const profile = this.auth.profile();
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!profile || !file) return;
    this.uploading.set(true);
    try {
      const resizedFile = await this.resizeAvatar(file);
      const url = await this.supabase.uploadAvatar(profile.id, resizedFile);
      this.auth.profile.set({ ...profile, avatar_url: url });
      this.message = 'Avatar gespeichert.';
    } catch {
      this.message = 'Avatar konnte nicht gespeichert werden.';
    } finally {
      this.uploading.set(false);
    }
  }

  private resizeAvatar(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const maxSize = 640;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        if (scale === 1) {
          URL.revokeObjectURL(objectUrl);
          resolve(file);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext('2d');
        if (!context) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Avatar konnte nicht verarbeitet werden.'));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(objectUrl);
            if (!blob) {
              reject(new Error('Avatar konnte nicht verarbeitet werden.'));
              return;
            }
            resolve(new File([blob], file.name, { type: blob.type, lastModified: Date.now() }));
          },
          file.type || 'image/jpeg',
          0.9,
        );
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Avatar konnte nicht gelesen werden.'));
      };
      image.src = objectUrl;
    });
  }

  async logout(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/numbers');
  }
}
