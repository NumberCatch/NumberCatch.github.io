import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../services/auth.service';
import { NumbersComponent } from './numbers.component';
import { Profile, PlayerGroup, GroupMember } from '../models/models';
import { SupabaseService } from '../services/supabase.service';

describe('NumbersComponent group members', () => {
  it('shows a friend shared across two groups only once', async () => {
    const own: Profile = { id: 'own', display_name: 'Ich', avatar_url: null, current_number: 3 };
    const friend: Profile = { ...own, id: 'friend', display_name: 'Freund' };
    const groups: PlayerGroup[] = ['a', 'b'].map((id) => ({
      id,
      name: id,
      created_by: own.id,
      created_at: '',
    }));
    const supabase = {
      groups: vi.fn().mockName('SupabaseService.groups'),
      members: vi.fn().mockName('SupabaseService.members'),
    };
    supabase.groups.mockResolvedValue(groups);
    supabase.members.mockImplementation(
      async (groupId): Promise<GroupMember[]> =>
        [own, friend].map((profile) => ({
          group_id: groupId,
          user_id: profile.id,
          joined_at: '',
          profile,
        })),
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { profile: signal(own) } },
        { provide: SupabaseService, useValue: supabase },
      ],
    });
    const component = TestBed.runInInjectionContext(() => new NumbersComponent());
    await component.ngOnInit();
    expect(component.friends()).toEqual([friend]);
    expect(component.playersAt(3)).toEqual([own, friend]);
  });
});
