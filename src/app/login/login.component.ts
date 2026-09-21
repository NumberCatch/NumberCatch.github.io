import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly error = signal('');
  readonly message = signal('');
  readonly registerMode = signal(false);
  name = '';
  email = '';
  password = '';
  toggleMode(): void {
    this.registerMode.update((mode) => !mode);
    this.error.set('');
    this.message.set('');
  }
  async submit(): Promise<void> {
    this.error.set('');
    this.message.set('');
    const error = this.registerMode()
      ? await this.auth.signUp(this.email, this.password, this.name)
      : await this.auth.signIn(this.email, this.password);
    if (error) {
      this.error.set(error);
      return;
    }
    if (this.registerMode() && !this.auth.authenticated()) {
      this.message.set('Bitte bestätige zuerst deine E-Mail-Adresse.');
      return;
    }
    await this.router.navigateByUrl(
      this.route.snapshot.queryParamMap.get('returnUrl') ?? '/numbers',
    );
  }
}
