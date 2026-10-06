import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { API_URL } from '../config';

export interface Metric {
  ts: number;
  temperature: number;
  humidity: number;
  gas: number;
  motion: boolean;
}

/** Format renvoyé par GET /api/v1/alerts (les plus récentes en premier). */
export interface Alert {
  id: number;
  source: string;
  type: string;
  level: 'info' | 'warning' | 'critical';
  value?: unknown;
  acknowledged: boolean;
  createdAt: string;
}

/** Centralise tous les appels HTTP vers l'API. En cas d'erreur, renvoie une valeur vide. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  isApiUp(): Observable<boolean> {
    return this.http.get(`${API_URL}/health`).pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }

  getMetrics(limit = 50): Observable<Metric[]> {
    return this.http
      .get<Metric[]>(`${API_URL}/metrics`, { params: { limit } })
      .pipe(catchError(() => of([])));
  }

  getAlerts(): Observable<Alert[]> {
    return this.http.get<Alert[]>(`${API_URL}/alerts`).pipe(catchError(() => of([])));
  }

  /** Envoie une photo du visage (JPEG) en multipart, champ "image". */
  sendFace(image: Blob): Observable<boolean> {
    const form = new FormData();
    form.append('image', image, 'face.jpg');
    return this.http.post(`${API_URL}/faces`, form).pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }
}
