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
  /** Bilan des envois d'alertes au backend : un échec ici veut dire « détecté mais jamais signalé ». */
  alerts?: {
    enabled: boolean;
    sent: number;
    failed: number;
    last_error: string | null;
    last_error_at: number | null;
    last_sent_at: number | null;
  };
}

// --- Nœuds, commandes, predict-anomalie (intégration esp01 / predict-anomalie) ---

export type NodeStatus = 'online' | 'offline' | 'unknown';

/** GET /api/v1/nodes et Socket.io "node_status". */
export interface NodeState {
  id: string;
  status: NodeStatus;
  statusAt: string | null;
  lastTelemetryAt: string | null;
}

/** Socket.io "telemetry" : trame du nœud relayée par le backend (champs absents = capteur en panne). */
export interface Telemetry {
  source: string;
  receivedAt: string;
  uptime_s?: number;
  temperature_c?: number;
  humidity_pct?: number;
  dew_point_c?: number;
  gas_raw?: number;
  gas_ratio?: number;
  gas_warming?: boolean;
  presence?: boolean;
  presence_count?: number;
  tilt?: 'repos' | 'secousse' | 'sabotage';
  optic?: 'repos' | 'secousse' | 'sabotage';
}

export type CommandStatus = 'pending' | 'sent' | 'retrying' | 'acked' | 'failed';

/** Commande envoyée à un nœud : Socket.io "command_status", POST et GET /api/v1/commands. */
export interface CommandView {
  id: string;
  node: string;
  event: string;
  trigger: 'rule' | 'manual' | 'replay';
  status: CommandStatus;
  attempts: number;
  maxAttempts?: number;
  reason?: string | null;
  failure?: 'node_offline' | 'no_ack' | 'broker_down' | null;
  latencyMs?: number | null;
  createdAt?: string;
  appliedAtNextBoot?: boolean;
}

/** Commande manuelle du superviseur (contrôle réactif). */
export type CommandRequest =
  | { node: string; event: string }
  | { node: string; event: 'activate' | 'deactivate'; target: SignalTarget; signal: SignalKind };
export type SignalTarget = 'intrusion' | 'sabotage' | 'environnement' | 'tout';
export type SignalKind = 'sonore' | 'lumineux' | 'tous';

/** Socket.io "seq_gap" : événements du nœud jamais reçus. */
export interface SeqGap {
  node: string;
  from: number;
  to: number;
  missing: number;
}

export type Sensitivity = 'low' | 'medium' | 'high';

/** Configuration effective de predict-anomalie (topic retenu, GET /predictive/config). */
export interface PredictiveConfig {
  sensitivity?: Sensitivity;
  window_days?: number;      // fenêtre demandée
  effective_days?: number;   // fenêtre réellement couverte par l'historique
  receivedAt?: string;
}

/** Socket.io "score" : score continu du détecteur, toutes les 5 s par nœud. */
export interface Score {
  source: string;
  ts?: string;
  stage?: 'normal' | 'drift' | 'anomaly' | 'critical' | string;
  score?: number;
  magnitude?: number;
  velocity?: number;
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

  /** Le superviseur signale qu'il a pris l'alerte en compte (admin, superviseur). */
  acknowledgeAlert(id: number): Observable<ActionResult> {
    return this.http
      .patch(`${API_URL}/alerts/${id}/ack`, {})
      .pipe(success, catchError((err) => failure(err, "Échec de l'acquittement")));
  }

  // --- Nœuds et commandes ---

  getNodes(): Observable<NodeState[]> {
    return this.http.get<{ nodes: NodeState[] }>(`${API_URL}/nodes`).pipe(
      map(({ nodes }) => nodes),
      catchError(() => of([])),
    );
  }

  getCommands(limit = 15): Observable<CommandView[]> {
    return this.http
      .get<CommandView[]>(`${API_URL}/commands`, { params: { limit } })
      .pipe(catchError(() => of([])));
  }

  /** Renvoie la commande créée (même en échec : 503 si le nœud est hors ligne), ou null si refusée. */
  sendCommand(request: CommandRequest): Observable<{ command: CommandView | null; error?: string }> {
    return this.http.post<CommandView>(`${API_URL}/commands`, request).pipe(
      map((command) => ({ command })),
      catchError((err: unknown) => {
        const body = err instanceof HttpErrorResponse ? err.error : null;
        if (body?.id) return of({ command: body as CommandView });   // 503 : commande tracée mais en échec
        return of({ command: null, error: typeof body?.error === 'string' ? body.error : 'Commande refusée' });
      }),
    );
  }

  // --- predict-anomalie ---

  getPredictiveConfig(): Observable<PredictiveConfig | null> {
    return this.http.get<PredictiveConfig>(`${API_URL}/predictive/config`).pipe(catchError(() => of(null)));
  }

  getScores(): Observable<Score[]> {
    return this.http.get<Score[]>(`${API_URL}/predictive/scores`).pipe(catchError(() => of([])));
  }

  setPredictiveConfig(config: { sensitivity?: Sensitivity; window_days?: number }): Observable<ActionResult> {
    return this.http
      .post(`${API_URL}/predictive/config`, config)
      .pipe(success, catchError((err) => failure(err, 'Réglage refusé')));
  }

  retrain(): Observable<ActionResult> {
    return this.http
      .post(`${API_URL}/predictive/retrain`, {})
      .pipe(success, catchError((err) => failure(err, 'Réapprentissage refusé')));
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
