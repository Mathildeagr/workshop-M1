import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Login } from './login';

describe('Login', () => {
  let fixture: ComponentFixture<Login>;
  let el: HTMLElement;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ imports: [Login], providers: [provideRouter([])] });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(Login);
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  const button = () => el.querySelector<HTMLButtonElement>('button[type=submit]');

  function fillAndSubmit(email: string, password: string) {
    fixture.componentInstance.form.setValue({ email, password });
    fixture.detectChanges();
    button()?.click();
    fixture.detectChanges();
  }

  it('désactive le bouton tant que le formulaire est vide', () => {
    expect(button()?.disabled).toBe(true);
  });

  it("désactive le bouton si l'email est invalide", () => {
    fixture.componentInstance.form.setValue({ email: 'pas-un-email', password: '123456' });
    fixture.detectChanges();
    expect(button()?.disabled).toBe(true);
  });

  it('connecte le compte de test puis redirige vers le dashboard', () => {
    fillAndSubmit('test@gmail.com', '123456');
    expect(TestBed.inject(AuthService).isLoggedIn()).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/']);
    expect(el.querySelector('.error')).toBeNull();
  });

  it('affiche une erreur si les identifiants sont faux', () => {
    fillAndSubmit('test@gmail.com', 'faux');
    expect(navigate).not.toHaveBeenCalled();
    expect(el.querySelector('.error')?.textContent).toContain('Email ou mot de passe incorrect');
  });
});
