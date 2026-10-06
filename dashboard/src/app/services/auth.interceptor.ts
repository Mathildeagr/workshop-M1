import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { API_URL } from '../config';
import { AuthService } from './auth.service';

/**
 * Ajoute le JWT aux requêtes vers notre API (jamais vers un autre domaine),
 * et renvoie vers /login si le backend répond 401 (jeton expiré ou révoqué).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(API_URL)) return next(req);

  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();
  const isLogin = req.url === `${API_URL}/auth/login`;

  const authReq = token && !isLogin ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authReq).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !isLogin && token) {
        auth.logout();
        router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};
