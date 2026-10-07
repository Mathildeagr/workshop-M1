import { HttpClient, HttpErrorResponse } from '@angular/common/http';
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

/** Format renvoyé par GET /api/v1/alerts et poussé par Socket.io (les plus récentes en premier). */
export interface Alert {
  id: number;
  source: string; // nœud concerné
  emitter?: string | null; // qui a émis (esp01, predictive, vision) ; null sur les anciennes alertes
  type: string;
  level: 'info' | 'warning' | 'critical';
  value?: unknown;
  detail?: string | null; // capteur à l'origine, ou explication courte
  origin?: 'sensor' | 'command' | 'model' | null;
  meta?: Record<string, unknown> | null; // seq, uptime_s, score, contributions...
  occurredAt?: string | null; // heure de l'émetteur ; createdAt = réception
  acknowledged: boolean;
  acknowledgedBy?: number | null;
  acknowledgedAt?: string | null;
  createdAt: string;
}

export type FaceStatus = 'autorise' | 'interdit';

/** Personne enregistrée dans la base de visages du service vision. */
export interface Face {
  name: string;
  status: FaceStatus;
  samples: number;
}

/** Format renvoyé par GET /api/v1/vision/status. */
export interface VisionStatus {
  enabled: boolean; // la vision doit tourner (sinon arrêtée via /stop)
  running: boolean;
  enrolling: boolean; // enrôlement webcam en cours : vision en pause
  error: string | null;
  persons: number;
  detections: { name: string | null; status: string; kind: 'face' | 'person'; score: number }[];
  ms: number;
  at: number | null;
}

/** Résultat d'une action : en cas d'échec, message d'erreur renvoyé par l'API. */
export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Même règle que le backend et le service vision. */
export const FACE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;

function failure(err: unknown, fallback: string): Observable<ActionResult> {
  const message = err instanceof HttpErrorResponse ? err.error?.error : undefined;
  return of({ ok: false, error: typeof message === 'string' ? message : fallback });
}

const success = map((): ActionResult => ({ ok: true }));

/** Centralise tous les appels HTTP vers l'API. En cas d'erreur, renvoie une valeur vide. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  getMetrics(limit = 50): Observable<Metric[]> {
    return this.http
      .get<Metric[]>(`${API_URL}/metrics`, { params: { limit } })
      .pipe(catchError(() => of([])));
  }

  getAlerts(): Observable<Alert[]> {
    return this.http.get<Alert[]>(`${API_URL}/alerts`).pipe(catchError(() => of([])));
  }

  // --- Vision (service ai-vision via le backend) ---

  getVisionStatus(): Observable<VisionStatus | null> {
    return this.http.get<VisionStatus>(`${API_URL}/vision/status`).pipe(catchError(() => of(null)));
  }

  /** Active ou coupe la vision permanente (admin, superviseur). */
  setVision(enabled: boolean): Observable<ActionResult> {
    return this.http
      .post(`${API_URL}/vision/${enabled ? 'start' : 'stop'}`, {})
      .pipe(success, catchError((err) => failure(err, 'Service vision indisponible')));
  }

  /** URL du flux MJPEG : <img> ne peut pas envoyer le JWT, on demande un ticket de 60 s au backend. */
  getStreamUrl(): Observable<string | null> {
    return this.http.post<{ url: string }>(`${API_URL}/vision/stream-ticket`, {}).pipe(
      map(({ url }) => url),
      catchError(() => of(null)),
    );
  }

  // --- Visages (équivalent de enroll.py) ---

  getFaces(): Observable<Face[]> {
    return this.http.get<Face[]>(`${API_URL}/faces`).pipe(catchError(() => of([])));
  }

  /** Enrôlement par la caméra Sentinel : la vision est en pause pendant la capture (30 s max). */
  captureFace(name: string, status: FaceStatus, samples: number): Observable<ActionResult> {
    return this.http
      .post(`${API_URL}/faces/capture`, { name, status, samples })
      .pipe(success, catchError((err) => failure(err, 'Échec de la capture')));
  }

  setFaceStatus(name: string, status: FaceStatus): Observable<ActionResult> {
    return this.http
      .patch(`${API_URL}/faces/${encodeURIComponent(name)}`, { status })
      .pipe(success, catchError((err) => failure(err, 'Échec de la modification')));
  }

  deleteFace(name: string): Observable<ActionResult> {
    return this.http
      .delete(`${API_URL}/faces/${encodeURIComponent(name)}`)
      .pipe(success, catchError((err) => failure(err, 'Échec de la suppression')));
  }
}
