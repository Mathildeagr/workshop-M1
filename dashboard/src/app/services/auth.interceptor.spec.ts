import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { API_URL } from '../config';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

describe('authInterceptor', () => {
  const token = signal<string | null>('jwt-de-test');
  const logout = vi.fn();
  let client: HttpClient;
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    token.set('jwt-de-test');
    logout.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { token, logout } },
      ],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => http.verify());

  it('ajoute le jeton aux requêtes vers notre API', () => {
    client.get(`${API_URL}/alerts`).subscribe();
    const req = http.expectOne(`${API_URL}/alerts`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-de-test');
    req.flush([]);
  });

  it("n'envoie jamais le jeton vers un autre domaine", () => {
    client.get('http://autre-site.example/data').subscribe();
    const req = http.expectOne('http://autre-site.example/data');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('déconnecte et renvoie vers /login sur un 401', () => {
    client.get(`${API_URL}/alerts`).subscribe({ error: () => undefined });
    http.expectOne(`${API_URL}/alerts`).flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('ne déconnecte pas sur un 401 du login (simple mauvais mot de passe)', () => {
    token.set(null);
    client.post(`${API_URL}/auth/login`, {}).subscribe({ error: () => undefined });
    const req = http.expectOne(`${API_URL}/auth/login`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(logout).not.toHaveBeenCalled();
  });
});
