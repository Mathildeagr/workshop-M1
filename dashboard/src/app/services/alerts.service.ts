import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import { ApiService, type Alert } from './api.service';
import { AuthService } from './auth.service';

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
    // Après une coupure, on recharge pour récupérer les alertes émises pendant l'absence
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
