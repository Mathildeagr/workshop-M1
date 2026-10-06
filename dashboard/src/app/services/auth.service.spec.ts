import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    sessionStorage.clear();
    service = TestBed.inject(AuthService);
  });

  const login = (email: string, password: string) => {
    let result: boolean | undefined;
    service.login(email, password).subscribe((ok) => {
      result = ok;
    });
    return result;
  };

  it("n'est pas connecté par défaut", () => {
    expect(service.isLoggedIn()).toBe(false);
  });

  it('connecte le compte de test et le garde en session', () => {
    expect(login('test@gmail.com', '123456')).toBe(true);
    expect(service.user()).toEqual({ id: 1, email: 'test@gmail.com', role: 'admin' });
    expect(JSON.parse(sessionStorage.getItem('sentinel_user') ?? '{}').email).toBe('test@gmail.com');
  });

  it('ne stocke jamais le mot de passe en session', () => {
    login('test@gmail.com', '123456');
    expect(sessionStorage.getItem('sentinel_user')).not.toContain('123456');
  });

  it('refuse un mauvais mot de passe ou un email inconnu', () => {
    expect(login('test@gmail.com', 'faux')).toBe(false);
    expect(login('inconnu@gmail.com', '123456')).toBe(false);
    expect(service.isLoggedIn()).toBe(false);
  });

  it('efface la session à la déconnexion', () => {
    login('test@gmail.com', '123456');
    service.logout();
    expect(service.isLoggedIn()).toBe(false);
    expect(sessionStorage.getItem('sentinel_user')).toBeNull();
  });
});
