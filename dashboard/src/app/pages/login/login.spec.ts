import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService, type LoginResult } from '../../services/auth.service';
import { Login } from './login';

describe('Login', () => {
  let fixture: ComponentFixture<Login>;
  let el: HTMLElement;
  let navigate: ReturnType<typeof vi.spyOn>;
  let result: LoginResult;
  const login = vi.fn(() => of(result));

  beforeEach(() => {
    login.mockClear();
    TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([]), { provide: AuthService, useValue: { login } }],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(Login);
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  const button = () => el.querySelector<HTMLButtonElement>('button[type=submit]');

  function fillAndSubmit(username: string, password: string) {
    fixture.componentInstance.form.setValue({ username, password });
    fixture.detectChanges();
    button()?.click();
    fixture.detectChanges();
  }

  it('désactive le bouton tant que le formulaire est vide', () => {
    expect(button()?.disabled).toBe(true);
  });

  it('envoie les identifiants puis redirige vers le dashboard', () => {
    result = 'ok';
    fillAndSubmit('admin', 'secret-password');
    expect(login).toHaveBeenCalledWith('admin', 'secret-password');
    expect(navigate).toHaveBeenCalledWith(['/']);
    expect(el.querySelector('.error')).toBeNull();
  });

  it('affiche une erreur si les identifiants sont faux', () => {
    result = 'invalid';
    fillAndSubmit('admin', 'faux');
    expect(navigate).not.toHaveBeenCalled();
    expect(el.querySelector('.error')?.textContent).toContain('incorrect');
  });

  it('prévient en cas de trop nombreuses tentatives', () => {
    result = 'rate_limited';
    fillAndSubmit('admin', 'faux');
    expect(el.querySelector('.error')?.textContent).toContain('Trop de tentatives');
  });

  it("prévient si l'API est injoignable", () => {
    result = 'unavailable';
    fillAndSubmit('admin', 'secret-password');
    expect(el.querySelector('.error')?.textContent).toContain('indisponible');
  });
});
