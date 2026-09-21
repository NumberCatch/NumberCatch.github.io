import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from './auth.service';
import { GroupMember, PlayerGroup } from './models';
import { SupabaseService } from './supabase.service';
import { LucideTrash, LucideUsers } from '@lucide/angular';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, LucideTrash, LucideUsers],
  template: `<section class="page">
    <p class="eyebrow">DEINE GRUPPE</p>
    <h1>Freunde</h1>
    <div class="group-actions">
      <div>
        <strong>Neue Gruppe erstellen</strong>
        <p class="muted">Starte eine neue Runde mit deinen Freunden.</p>
      </div>
      <input
        [(ngModel)]="groupName"
        placeholder="Neue Gruppe"
        aria-label="Name der neuen Gruppe"
      /><button class="primary" (click)="create()">Gruppe erstellen</button>
    </div>
    <div class="group-actions">
      <div>
        <strong>Gruppe beitreten</strong>
        <p class="muted">Nutze die Gruppen-ID oder den kopierten Link.</p>
      </div>
      <input
        [(ngModel)]="groupId"
        placeholder="Gruppen-ID zum Beitreten"
        aria-label="Gruppen-ID"
      /><button class="secondary" (click)="join()">Gruppe beitreten</button>
    </div>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (groups().length) {
      <div class="group-list">
        <button
          *ngFor="let group of groups()"
          class="group-tab"
          [class.selected]="selected()?.id === group.id"
          (click)="select(group)"
        >
          {{ group.name }}
        </button>
      </div>
    } @else {
      <div class="empty-state">
        <svg class="empty-icon" lucideUsers></svg>
        <h2>Noch keine Gruppe</h2>
        <p class="muted">Erstelle eine Gruppe oder tritt mit einer Gruppen-ID bei.</p>
      </div>
    }
    @if (selected()) {
      <div class="invite-actions">
        <button class="secondary" (click)="copyGroupLink()">Gruppenlink kopieren</button>
        @if (selected()?.created_by === auth.profile()?.id) {
          <button class="danger-button" type="button" (click)="deleteSelected()">
            <svg lucideTrash></svg>Gruppe löschen
          </button>
        }
      </div>
    }
    @if (inviteMessage()) {
      <p class="success">{{ inviteMessage() }}</p>
    }
    @if (selected()) {
      <div class="member-list">
        <p class="muted group-summary">
          {{ members().length }} {{ members().length === 1 ? 'Mitglied' : 'Mitglieder' }}
        </p>
        <div class="member-row" *ngFor="let member of members()">
          <div
            class="avatar"
            [style.background-image]="
              member.profile.avatar_url ? 'url(' + member.profile.avatar_url + ')' : null
            "
          >
            {{ member.profile.avatar_url ? '' : initials(member.profile.display_name) }}
          </div>
          <div>
            <strong>{{ member.profile.display_name }}</strong
            ><small class="muted">{{ member.profile.current_number }} abgeschlossen</small>
          </div>
        </div>
      </div>
    }
  </section>`,
})
export class FriendsComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  readonly groups = signal<PlayerGroup[]>([]);
  readonly members = signal<GroupMember[]>([]);
  readonly selected = signal<PlayerGroup | null>(null);
  readonly error = signal('');
  groupName = '';
  groupId = '';
  readonly inviteMessage = signal('');
  private stopRealtime?: () => void;
  async ngOnInit(): Promise<void> {
    await this.load();
  }
  async load(): Promise<void> {
    const userId = this.auth.profile()?.id;
    if (!userId) return;
    try {
      const groups = await this.supabase.groups(userId);
      this.groups.set(groups);
      if (groups.length) await this.select(groups[0]);
      else {
        this.selected.set(null);
        this.members.set([]);
      }
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Gruppen konnten nicht geladen werden.',
      );
    }
  }
  async create(): Promise<void> {
    const userId = this.auth.profile()?.id;
    if (!userId || !this.groupName.trim()) return;
    try {
      await this.supabase.createGroup(userId, this.groupName);
      this.groupName = '';
      await this.load();
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Gruppe konnte nicht erstellt werden.',
      );
    }
  }
  async join(): Promise<void> {
    const userId = this.auth.profile()?.id;
    if (!userId || !this.groupId.trim()) return;
    try {
      await this.supabase.joinGroup(this.groupId.trim(), userId);
      this.groupId = '';
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Beitritt fehlgeschlagen.');
    }
  }
  async select(group: PlayerGroup): Promise<void> {
    this.selected.set(group);
    this.inviteMessage.set('');
    this.stopRealtime?.();
    this.stopRealtime = undefined;
    try {
      this.members.set(await this.supabase.members(group.id));
      this.stopRealtime = this.supabase.watchGroupProfiles(
        group.id,
        () => void this.refreshMembers(group.id),
      );
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Mitglieder konnten nicht geladen werden.',
      );
    }
  }
  async copyGroupLink(): Promise<void> {
    const group = this.selected();
    if (!group) return;
    try {
      const url = `${window.location.origin}${window.location.pathname}#/join/${group.id}`;
      await navigator.clipboard?.writeText(url);
      this.inviteMessage.set('Einladungslink erstellt und kopiert.');
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Einladung konnte nicht erstellt werden.',
      );
    }
  }
  async deleteSelected(): Promise<void> {
    const group = this.selected();
    const userId = this.auth.profile()?.id;
    if (!group || !userId || group.created_by !== userId) return;
    if (!window.confirm(`Gruppe „${group.name}“ wirklich löschen?`)) return;
    try {
      await this.supabase.deleteGroup(group.id, userId);
      this.stopRealtime?.();
      this.stopRealtime = undefined;
      await this.load();
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Gruppe konnte nicht gelöscht werden.',
      );
    }
  }
  private async refreshMembers(groupId: string): Promise<void> {
    this.members.set(await this.supabase.members(groupId, true));
  }
  initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
  }
}
