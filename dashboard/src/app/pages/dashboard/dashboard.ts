import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { switchMap, timer } from 'rxjs';
import { FacesManager } from '../../components/faces-manager/faces-manager';
import { LineChart } from '../../components/line-chart/line-chart';
import { VisionFeed } from '../../components/vision-feed/vision-feed';
import { REFRESH_MS } from '../../config';
import { toAlertView } from '../../services/alert-format';
import { AlertsService } from '../../services/alerts.service';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-dashboard',
  imports: [LineChart, VisionFeed, FacesManager, DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private alertsService = inject(AlertsService);

  metrics = toSignal(timer(0, REFRESH_MS).pipe(switchMap(() => this.api.getMetrics())), {
    initialValue: [],
  });
  last = computed(() => this.metrics().at(-1));
  // Boîtier considéré en ligne s'il a envoyé une mesure dans les 10 dernières secondes
  online = computed(() => {
    const last = this.last();
    return !!last && Date.now() - last.ts < 10_000;
  });

  temperature = computed(() => this.metrics().map((m) => m.temperature));
  humidity = computed(() => this.metrics().map((m) => m.humidity));
  gas = computed(() => this.metrics().map((m) => m.gas));

  // Les alertes arrivent en temps réel par Socket.io, les plus récentes en premier
  recentAlerts = computed(() => this.alertsService.alerts().slice(0, 5).map(toAlertView));
  alertsLive = this.alertsService.live;

  // Base de visages (données biométriques) : pas pour le rôle lecteur
  canSeeFaces = computed(() => ['admin', 'superviseur'].includes(this.auth.user()?.role ?? ''));

  constructor() {
    this.alertsService.connect();
    inject(DestroyRef).onDestroy(() => this.alertsService.disconnect());
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
