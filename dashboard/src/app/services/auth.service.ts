import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { type Observable, catchError, map, of } from 'rxjs';
import { API_URL } from '../config';

export interface User {
  id: number;
  username: string;
  role: string;
}

interface Session {
  token: string;
  user: User;
}

export type LoginResult = 'ok' | 'invalid' | 'rate_limited' | 'unavailable';

const SESSION_KEY = 'sentinel_session';

/** Lit la date d'expiration (exp, en secondes) dans le payload du JWT. */
function tokenExpiry(token: string): number {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).exp * 1000;
  } catch {
    return 0;
  }
}

function loadSession(): Session | null {
  try {
    const session: Session | null = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    return session && tokenExpiry(session.token) > Date.now() ? session : null;
  } catch {
    return null;
  }
}

/** Gère la connexion via le backend (JWT). La session dure le temps de l'onglet du navigateur. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private session = signal<Session | null>(loadSession());

  readonly user = computed(() => this.session()?.user ?? null);
  readonly token = computed(() => this.session()?.token ?? null);

  /** Faux aussi dès que le jeton a expiré, même sans requête vers l'API. */
  isLoggedIn(): boolean {
    const token = this.token();
    if (token && tokenExpiry(token) <= Date.now()) this.logout();
    return !!this.token();
  }

  login(username: string, password: string): Observable<LoginResult> {
    return this.http.post<Session>(`${API_URL}/auth/login`, { username, password }).pipe(
      map(({ token, user }) => {
        this.setSession({ token, user });
        return 'ok' as const;
      }),
      catchError((err: HttpErrorResponse) => {
        if (err.status === 401 || err.status === 400) return of('invalid' as const);
        if (err.status === 429) return of('rate_limited' as const);
        return of('unavailable' as const);
      }),
    );
  }

  logout() {
    this.setSession(null);
  }

  private setSession(session: Session | null) {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
    this.session.set(session);
  }
}
