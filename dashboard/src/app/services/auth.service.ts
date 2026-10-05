import { Injectable, computed, signal } from '@angular/core';
import { type Observable, of } from 'rxjs';
import { MOCK_USERS } from './mock-db';

export interface User {
  id: number;
  email: string;
  role: string;
}

const SESSION_KEY = 'sentinel_user';

/** Gère la connexion. L'utilisateur reste connecté le temps de la session du navigateur. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<User | null>(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null'));
  readonly isLoggedIn = computed(() => !!this.user());

  /** Simulé avec MOCK_USERS. À remplacer par un POST /api/v1/auth/login quand le backend sera prêt. */
  login(email: string, password: string): Observable<boolean> {
    const found = MOCK_USERS.find((u) => u.email === email && u.password === password);
    if (found) this.setUser({ id: found.id, email: found.email, role: found.role });
    return of(!!found);
  }

  logout() {
    this.setUser(null);
  }

  private setUser(user: User | null) {
    if (user) sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(SESSION_KEY);
    this.user.set(user);
  }
}
