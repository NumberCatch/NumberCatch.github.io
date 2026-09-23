import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { GroupMember, PlayerGroup } from '../models/models';
import { SupabaseService } from '../services/supabase.service';
import { LucideTrash, LucideUsers } from '@lucide/angular';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialog, ConfirmDialogData } from '../shared/confirm-dialog/confirm-dialog';

@Component({
  imports: [FormsModule, LucideTrash, LucideUsers, MatDialogModule],
  templateUrl: './friends.component.html',
  styleUrl: './friends.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendsComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
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
    const confirmed = await this.confirm({
      title: 'Gruppe löschen?',
      message: `Gruppe „${group.name}“ wirklich löschen?`,
      confirmLabel: 'Löschen',
    });
    if (!confirmed) return;
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

  private async confirm(data: ConfirmDialogData): Promise<boolean> {
    return (await firstValueFrom(this.dialog.open(ConfirmDialog, { data }).afterClosed())) === true;
  }
}
