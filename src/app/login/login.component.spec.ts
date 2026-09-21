import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { LoginComponent } from './login.component';

describe('LoginComponent template', () => {
  let fixture: ComponentFixture<LoginComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: {} },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  });

  it('shows the display name field only during registration', () => {
    expect(fixture.nativeElement.querySelector('input[name="name"]')).toBeNull();
    fixture.componentInstance.toggleMode();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="name"]')).not.toBeNull();
    fixture.componentInstance.toggleMode();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="name"]')).toBeNull();
  });

  it('shows messages conditionally and removes them when switching modes', () => {
    expect(fixture.nativeElement.querySelector('.success')).toBeNull();
    expect(fixture.nativeElement.querySelector('.error')).toBeNull();
    fixture.componentInstance.message.set('Bitte bestätige deine E-Mail-Adresse.');
    fixture.componentInstance.error.set('Einloggen fehlgeschlagen.');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.success')?.textContent).toContain('E-Mail');
    expect(fixture.nativeElement.querySelector('.error')?.textContent).toContain('fehlgeschlagen');
    fixture.componentInstance.toggleMode();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.success')).toBeNull();
    expect(fixture.nativeElement.querySelector('.error')).toBeNull();
  });
});
