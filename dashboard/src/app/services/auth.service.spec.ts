import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_URL } from '../config';
import { AuthService, type LoginResult } from './auth.service';

/** Fabrique un faux JWT (non signé) qui expire dans `seconds` secondes. */
function fakeToken(seconds = 3600): string {
  const payload = btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) + seconds }));
  return `header.${payload}.signature`;
}

const USER = { id: 1, username: 'admin', role: 'admin' };

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function login(status = 200, body: object | null = { token: fakeToken(), user: USER }) {
    let result: LoginResult | undefined;
    service.login('admin', 'secret-password').subscribe((r) => {
      result = r;
    });
    const req = http.expectOne(`${API_URL}/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'admin', password: 'secret-password' });
    req.flush(body, { status, statusText: String(status) });
    return result;
  }

  it("n'est pas connecté par défaut", () => {
    expect(service.isLoggedIn()).toBe(false);
  });

  it('connecte via le backend et garde le jeton en session', () => {
    expect(login()).toBe('ok');
    expect(service.isLoggedIn()).toBe(true);
    expect(service.user()).toEqual(USER);
    expect(service.token()).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem('sentinel_session') ?? '{}').user.username).toBe('admin');
  });

  it('ne stocke jamais le mot de passe en session', () => {
    login();
    expect(sessionStorage.getItem('sentinel_session')).not.toContain('secret-password');
  });

  it('distingue identifiants faux, trop de tentatives et serveur injoignable', () => {
    expect(login(401, { error: 'Identifiants invalides' })).toBe('invalid');
    expect(login(429, { error: 'Trop de tentatives' })).toBe('rate_limited');
    expect(login(503, { error: 'Base de données indisponible' })).toBe('unavailable');
    expect(service.isLoggedIn()).toBe(false);
  });

  it('considère un jeton expiré comme déconnecté', () => {
    login(200, { token: fakeToken(-10), user: USER });
    expect(service.isLoggedIn()).toBe(false);
    expect(sessionStorage.getItem('sentinel_session')).toBeNull();
  });

  it('restaure une session valide au rechargement, ignore une session expirée', () => {
    sessionStorage.setItem('sentinel_session', JSON.stringify({ token: fakeToken(), user: USER }));
    expect(TestBed.runInInjectionContext(() => new AuthService()).isLoggedIn()).toBe(true);

    sessionStorage.setItem('sentinel_session', JSON.stringify({ token: fakeToken(-10), user: USER }));
    expect(TestBed.runInInjectionContext(() => new AuthService()).isLoggedIn()).toBe(false);
  });

  it('efface la session à la déconnexion', () => {
    login();
    service.logout();
    expect(service.isLoggedIn()).toBe(false);
    expect(sessionStorage.getItem('sentinel_session')).toBeNull();
  });
});
