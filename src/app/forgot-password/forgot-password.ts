import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  imports: [FormsModule, RouterLink],
  styleUrl: './forgot-password.css',
  templateUrl: './forgot-password.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPassword {
  private readonly auth = inject(AuthService);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly sent = signal(false);
  email = '';

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const error = await this.auth.requestPasswordReset(this.email);
      if (error) this.error.set(error);
      else this.sent.set(true);
    } catch {
      this.error.set('Reset-Mail konnte nicht verschickt werden. Bitte versuche es erneut.');
    } finally {
      this.busy.set(false);
    }
  }
}
