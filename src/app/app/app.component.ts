import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../services/auth.service';
import {
  LucideGrid3x3,
  LucideMap,
  LucidePlus,
  LucideUserRound,
  LucideUsers,
} from '@lucide/angular';

@Component({
  selector: 'nc-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LucideGrid3x3,
    LucideMap,
    LucidePlus,
    LucideUserRound,
    LucideUsers,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit {
  readonly auth = inject(AuthService);
  ngOnInit(): void {
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.auth.initialize();
  }

  initials(): string {
    const name = this.auth.profile()?.display_name ?? '?';
    return name.slice(0, 2).toUpperCase();
  }
}
