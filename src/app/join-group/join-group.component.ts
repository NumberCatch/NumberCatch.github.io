import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';
import { MatButtonModule } from '@angular/material/button';

@Component({
  imports: [RouterLink, MatButtonModule],
  templateUrl: './join-group.component.html',
  styleUrl: './join-group.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinGroupComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  readonly joined = signal(false);
  readonly error = signal('');
  private token = '';
  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) this.error.set('Einladungslink ist ungültig.');
  }
  async join(): Promise<void> {
    const userId = this.auth.profile()?.id;
    if (!userId || !this.token) return;
    try {
      await this.supabase.joinGroup(this.token, userId);
      this.joined.set(true);
    } catch {
      this.error.set('Einladung ist ungültig oder konnte nicht verwendet werden.');
    }
  }
}
