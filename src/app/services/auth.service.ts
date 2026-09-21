import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Profile } from '../models/models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly profile = signal<Profile | null>(null);
  readonly authenticated = signal(false);
  private initialization?: Promise<void>;

  constructor(private readonly supabase: SupabaseService) {}
  async signIn(email: string, password: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.auth.signInWithPassword({ email, password });
    if (error || !data.user) return error?.message ?? 'Anmeldung fehlgeschlagen.';
    try {
      this.profile.set(await this.supabase.ensureProfile(data.user.id, email.split('@')[0]));
      this.authenticated.set(true);
      return null;
    } catch (profileError) {
      return profileError instanceof Error
        ? profileError.message
        : 'Profil konnte nicht geladen werden.';
    }
  }
  async signUp(email: string, password: string, name: string): Promise<string | null> {
    const { data, error } = await this.supabase.client.auth.signUp({
      email,
      password,
      options: { data: { display_name: name } },
    });
    if (!error && data.user && data.session) {
      this.authenticated.set(true);
      this.profile.set(await this.supabase.ensureProfile(data.user.id, name));
    }
    return error?.message ?? null;
  }
  async signOut(): Promise<void> {
    await this.supabase.client.auth.signOut();
    this.supabase.clearCache();
    this.authenticated.set(false);
    this.profile.set(null);
  }
  async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.loadInitialSession().catch((error: unknown) => {
        this.initialization = undefined;
        throw error;
      });
    }
    await this.initialization;
  }

  private async loadInitialSession(): Promise<void> {
    const { data } = await this.supabase.client.auth.getUser();
    this.authenticated.set(Boolean(data.user));
    if (data.user) this.profile.set(await this.supabase.ensureProfile(data.user.id, 'Spieler'));
  }
}
