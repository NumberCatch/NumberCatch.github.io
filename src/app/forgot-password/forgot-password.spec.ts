import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ForgotPassword } from './forgot-password';
import { provideRouter } from '@angular/router';
import { AuthService } from '../services/auth.service';

describe('ForgotPassword', () => {
  let component: ForgotPassword;
  let fixture: ComponentFixture<ForgotPassword>;
  const requestPasswordReset = vi.fn().mockResolvedValue(null);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ForgotPassword],
      providers: [provideRouter([]), { provide: AuthService, useValue: { requestPasswordReset } }],
    }).compileComponents();

    fixture = TestBed.createComponent(ForgotPassword);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows a neutral confirmation after requesting a reset', async () => {
    component.email = 'test@example.com';
    await component.submit();
    fixture.detectChanges();

    expect(requestPasswordReset).toHaveBeenCalledWith('test@example.com');
    expect(fixture.nativeElement.querySelector('.success')?.textContent).toContain(
      'Falls ein Konto',
    );
  });
});
