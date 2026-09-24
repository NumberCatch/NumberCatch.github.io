import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly error = signal('');
  readonly message = signal('');
  readonly registerMode = signal(false);
  readonly busy = signal(false);
  private passkeyController?: AbortController;
  private destroyed = false;
  name = '';
  email = '';
  password = '';

  ngOnInit(): void {
    void this.startPasskeyAutofill();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.passkeyController?.abort();
  }

  toggleMode(): void {
    this.registerMode.update((mode) => !mode);
    if (this.registerMode()) this.passkeyController?.abort();
    else void this.startPasskeyAutofill();
    this.error.set('');
    this.message.set('');
  }

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    this.passkeyController?.abort();
    try {
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
      await this.navigateAfterLogin();
    } catch {
      this.error.set('Anmeldung fehlgeschlagen. Bitte versuche es erneut.');
    } finally {
      this.busy.set(false);
      if (!this.auth.authenticated() && !this.registerMode()) void this.startPasskeyAutofill();
    }
  }

  private async startPasskeyAutofill(): Promise<void> {
    if (this.destroyed || this.registerMode() || typeof PublicKeyCredential === 'undefined') return;
    let available = false;
    try {
      available = (await PublicKeyCredential.isConditionalMediationAvailable?.()) ?? false;
    } catch {
      return;
    }
    if (!available || this.destroyed || this.registerMode() || this.busy()) return;
    this.passkeyController?.abort();
    const controller = new AbortController();
    this.passkeyController = controller;
    try {
      const error = await this.auth.signInWithPasskey(controller.signal);
      if (this.passkeyController !== controller || controller.signal.aborted) return;
      if (error) this.error.set(error);
      else await this.navigateAfterLogin();
    } catch {
      if (!this.destroyed && !controller.signal.aborted) {
        this.error.set('Passkey-Anmeldung fehlgeschlagen.');
      }
    }
  }

  private async navigateAfterLogin(): Promise<void> {
    await this.router.navigateByUrl(
      this.route.snapshot.queryParamMap.get('returnUrl') ?? '/numbers',
    );
  }
}
