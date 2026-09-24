import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

interface PasskeyEntry {
  id: string;
  name: string;
}

@Component({
  imports: [FormsModule, RouterLink],
  styleUrl: './passkeys.css',
  templateUrl: './passkeys.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Passkeys implements OnInit {
  private readonly supabase = inject(SupabaseService);
  readonly passkeyBusy = signal(false);
  readonly passkeys = signal<PasskeyEntry[]>([]);
  readonly passkeyMessage = signal('');

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
}
