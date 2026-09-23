import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { visibleNumberLimit } from '../services/game.service';
import { Profile } from '../models/models';
import { SupabaseService } from '../services/supabase.service';
import { LucideCheck } from '@lucide/angular';

@Component({
  imports: [RouterLink, LucideCheck],
  templateUrl: './numbers.component.html',
  styleUrl: './numbers.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NumbersComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  readonly profile = computed(() => this.auth.profile());
  readonly current = computed(() => this.auth.profile()?.current_number ?? 0);
  readonly friends = signal<Profile[]>([]);
  readonly numberLimit = computed(() =>
    visibleNumberLimit(
      this.current(),
      this.friends().map((friend) => friend.current_number),
    ),
  );
  readonly numbers = computed(() =>
    Array.from({ length: this.numberLimit() }, (_, index) => index + 1),
  );
  async ngOnInit(): Promise<void> {
    const userId = this.auth.profile()?.id;
    if (!userId) return;
    try {
      const groups = await this.supabase.groups(userId);
      const members = (
        await Promise.all(groups.map((group) => this.supabase.members(group.id)))
      ).flat();
      const profiles = members
        .filter((member) => member.user_id !== userId)
        .map((member) => member.profile);
      this.friends.set([...new Map(profiles.map((profile) => [profile.id, profile])).values()]);
    } catch {
      /* The personal overview remains usable when friends are offline. */
    }
  }

  next(): number {
    return this.current() + 1;
  }

  initials(name = this.auth.profile()?.display_name ?? 'Du'): string {
    return name.slice(0, 2).toUpperCase();
  }

  playersAt(number: number): Profile[] {
    const ownProfile = this.profile();
    const players = ownProfile ? [ownProfile, ...this.friends()] : this.friends();
    return players.filter((player) => player.current_number === number);
  }
}
