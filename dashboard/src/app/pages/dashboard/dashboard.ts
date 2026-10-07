import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { map, switchMap, timer } from 'rxjs';
import { ControlPanel } from '../../components/control-panel/control-panel';
import { FacesManager } from '../../components/faces-manager/faces-manager';
import { LineChart } from '../../components/line-chart/line-chart';
import { PredictivePanel } from '../../components/predictive-panel/predictive-panel';
import { VisionFeed } from '../../components/vision-feed/vision-feed';
import { REFRESH_MS } from '../../config';
import { toAlertView, type AlertView } from '../../services/alert-format';
import { AlertsService } from '../../services/alerts.service';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { LiveStateService } from '../../services/live-state.service';

const NODE = 'esp01';
/** Mesures toutes les 2 s : « muet » après 3 intervalles manqués d'affilée (amorti, briefing §10.1). */
const SILENT_AFTER_S = 6;
const SENSOR_STATES: Record<string, string> = { repos: 'Repos', secousse: 'Secousse', sabotage: 'Sabotage' };

/** Garde les nombres d'une série (un capteur en panne laisse des trous, pas des zéros). */
const numbers = (values: (number | null | undefined)[]) => values.filter((v): v is number => typeof v === 'number');

@Component({
  selector: 'app-dashboard',
  imports: [LineChart, VisionFeed, FacesManager, ControlPanel, PredictivePanel, DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private alertsService = inject(AlertsService);
  private live = inject(LiveStateService);

  readonly node = NODE;

  /** Horloge à la seconde : fait vivre « il y a X s » sans nouvelle donnée. */
  private now = toSignal(timer(0, 1000).pipe(map(() => Date.now())), { initialValue: Date.now() });

  // Mesures enregistrées (predict-anomalie) : point de départ des courbes avant la télémétrie en direct
  metrics = toSignal(timer(0, REFRESH_MS).pipe(switchMap(() => this.api.getMetrics())), {
    initialValue: [],
  });
  last = computed(() => this.metrics().at(-1));
  telemetry = computed(() => this.live.telemetry(NODE));
  lastTelemetry = computed(() => this.telemetry().at(-1));

  /** Instant de la dernière mesure reçue, quelle que soit sa voie (bus en direct ou base). */
  private lastMeasureAt = computed(() => {
    const live = this.lastTelemetry()?.receivedAt;
    return live ? Date.parse(live) : (this.last()?.ts ?? null);
  });
  measureAge = computed(() => {
    const at = this.lastMeasureAt();
    return at === null ? null : Math.max(0, Math.round((this.now() - at) / 1000));
  });
  silent = computed(() => (this.measureAge() ?? Infinity) > SILENT_AFTER_S);

  /** Statut donné par le broker (testament MQTT) ; à défaut, déduit de la fraîcheur des mesures. */
  online = computed(() => {
    const status = this.live.nodeStatus(NODE);
    if (status !== 'unknown') return status === 'online';
    const at = this.lastMeasureAt();
    return at !== null && Date.now() - at < 10_000;
  });

  presence = computed(() => this.lastTelemetry()?.presence ?? this.last()?.motion ?? false);
  tilt = computed(() => SENSOR_STATES[this.lastTelemetry()?.tilt ?? ''] ?? '–');
  optic = computed(() => SENSOR_STATES[this.lastTelemetry()?.optic ?? ''] ?? '–');
  missingEvents = this.live.missingEvents;
  lastGap = computed(() => this.live.seqGaps().at(0));

  // Courbes : télémétrie en direct si elle arrive, sinon mesures enregistrées
  temperature = computed(() => this.telemetry().length
    ? numbers(this.telemetry().map((t) => t.temperature_c)) : numbers(this.metrics().map((m) => m.temperature)));
  humidity = computed(() => this.telemetry().length
    ? numbers(this.telemetry().map((t) => t.humidity_pct)) : numbers(this.metrics().map((m) => m.humidity)));
  gas = computed(() => this.telemetry().length
    ? numbers(this.telemetry().map((t) => t.gas_raw)) : numbers(this.metrics().map((m) => m.gas)));

  // Les alertes arrivent en temps réel par Socket.io, les plus récentes en premier
  recentAlerts = computed(() => this.alertsService.alerts().slice(0, 6).map(toAlertView));
  alertsLive = this.alertsService.live;

  // Base de visages (données biométriques) et acquittement : pas pour le rôle lecteur
  canSeeFaces = computed(() => ['admin', 'superviseur'].includes(this.auth.user()?.role ?? ''));
  canAcknowledge = this.canSeeFaces;

  constructor() {
    this.alertsService.connect();
    inject(DestroyRef).onDestroy(() => this.alertsService.disconnect());
  }

  acknowledge(alert: AlertView) {
    this.api.acknowledgeAlert(alert.id).subscribe((result) => {
      if (result.ok) this.alertsService.markAcknowledged(alert.id);
    });
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
