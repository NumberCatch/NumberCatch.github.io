import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangePassword } from './change-password';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { AuthService } from '../services/auth.service';

describe('ChangePassword', () => {
  let component: ChangePassword;
  let fixture: ComponentFixture<ChangePassword>;
  const passwordRecovery = signal(false);
  const changePassword = vi.fn().mockResolvedValue(null);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChangePassword],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { passwordRecovery, changePassword } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChangePassword);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('requires matching passwords and the current password in profile mode', async () => {
    component.currentPassword = 'old-password';
    component.password = 'new-password';
    component.confirmation = 'different';
    await component.submit();
    expect(changePassword).not.toHaveBeenCalled();

    component.confirmation = 'new-password';
    await component.submit();
    expect(changePassword).toHaveBeenCalledWith('new-password', 'old-password');
  });

  it('does not request the old password during recovery', async () => {
    passwordRecovery.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="currentPassword"]')).toBeNull();
    component.password = 'new-password';
    component.confirmation = 'new-password';
    await component.submit();
    expect(changePassword).toHaveBeenCalledWith('new-password', undefined);
    passwordRecovery.set(false);
  });
});
