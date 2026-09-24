import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  imports: [FormsModule, RouterLink],
  styleUrl: './change-password.css',
  templateUrl: './change-password.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangePassword {
  readonly auth = inject(AuthService);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly saved = signal(false);
  currentPassword = '';
  password = '';
  confirmation = '';

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.error.set('');
    if (this.password !== this.confirmation) {
      this.error.set('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    this.busy.set(true);
    try {
      const error = await this.auth.changePassword(
        this.password,
        this.auth.passwordRecovery() ? undefined : this.currentPassword,
      );
      if (error) this.error.set(error);
      else {
        this.saved.set(true);
        this.currentPassword = '';
        this.password = '';
        this.confirmation = '';
      }
    } catch {
      this.error.set('Passwort konnte nicht geändert werden. Bitte versuche es erneut.');
    } finally {
      this.busy.set(false);
    }
  }
}
