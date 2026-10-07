import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import {
  ApiService,
  type Alert,
  type CommandView,
  type PredictiveConfig,
  type Score,
  type SeqGap,
  type Telemetry,
} from './api.service';
import { AuthService } from './auth.service';
import { LiveStateService } from './live-state.service';

const MAX_ALERTS = 50;

/** Ouvre le WebSocket du backend (même origine : Traefik ou proxy.conf.json relaient /socket.io). */
export const SOCKET_FACTORY = new InjectionToken<(token: string) => Socket>('SOCKET_FACTORY', {
  providedIn: 'root',
  factory: () => (token: string) => io({ auth: { token } }),
});

/**
 * Alertes en temps réel : historique chargé une fois par l'API, puis complété par les événements
 * Socket.io "alert" (nouvelle alerte) et "alert_ack" (alerte acquittée) poussés par le backend.
 */
@Injectable({ providedIn: 'root' })
export class AlertsService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private createSocket = inject(SOCKET_FACTORY);
  private liveState = inject(LiveStateService);
  private socket: Socket | null = null;
  private list = signal<Alert[]>([]);

  /** Les plus récentes en premier. */
  readonly alerts = this.list.asReadonly();
  /** Vrai tant que le flux temps réel est connecté. */
  readonly live = signal(false);

  connect() {
    const token = this.auth.token();
    if (this.socket || !token) return;

    const socket = this.createSocket(token);
    socket.on('connect', () => this.live.set(true));
    socket.on('disconnect', () => this.live.set(false));
    socket.on('alert', (alert: Alert) => this.add(alert));
    socket.on('alert_ack', (alert: Alert) => this.replace(alert));
    // Même socket pour le reste de l'état temps réel (nœuds, télémétrie, commandes, predict-anomalie)
    socket.on('node_status', (e: Parameters<LiveStateService['onNodeStatus']>[0]) => this.liveState.onNodeStatus(e));
    socket.on('telemetry', (t: Telemetry) => this.liveState.onTelemetry(t));
    socket.on('command_status', (c: CommandView) => this.liveState.onCommandStatus(c));
    socket.on('seq_gap', (g: SeqGap) => this.liveState.onSeqGap(g));
    socket.on('score', (s: Score) => this.liveState.onScore(s));
    socket.on('predictive_config', (c: PredictiveConfig) => this.liveState.onPredictiveConfig(c));
    // Après une coupure, on recharge pour récupérer ce qui a été émis pendant l'absence
    socket.io.on('reconnect', () => this.reload());
    this.socket = socket;
    this.reload();
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
    this.live.set(false);
  }

  private reload() {
    this.api.getAlerts().subscribe((alerts) => this.list.set(alerts));
    this.liveState.load();
  }

  /** Mise à jour immédiate après un acquittement (le backend diffuse aussi "alert_ack"). */
  markAcknowledged(id: number) {
    this.list.update((list) => list.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
  }

  private add(alert: Alert) {
    this.list.update((list) =>
      [alert, ...list.filter((a) => a.id !== alert.id)].slice(0, MAX_ALERTS),
    );
  }

  private replace(alert: Alert) {
    this.list.update((list) => list.map((a) => (a.id === alert.id ? alert : a)));
  }
}
