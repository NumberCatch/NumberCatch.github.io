import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';
import { LucideLogOut } from '@lucide/angular';
import packageJson from '../../../package.json';

@Component({
  imports: [FormsModule, RouterLink, LucideLogOut],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileComponent {
  readonly auth = inject(AuthService);
  readonly appVersion = packageJson.version;
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);
  readonly uploading = signal(false);
  name = '';
  message = '';
  constructor() {
    this.name = this.auth.profile()?.display_name ?? '';
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
