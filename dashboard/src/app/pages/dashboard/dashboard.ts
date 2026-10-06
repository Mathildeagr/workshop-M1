import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap, timer } from 'rxjs';
import { Router } from '@angular/router';
import { FaceScan } from '../../components/face-scan/face-scan';
import { LineChart } from '../../components/line-chart/line-chart';
import { REFRESH_MS, WEBCAM_URL } from '../../config';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-dashboard',
  imports: [LineChart, FaceScan, DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private tick = timer(0, REFRESH_MS);

  apiUp = toSignal(this.tick.pipe(switchMap(() => this.api.isApiUp())), { initialValue: false });
  metrics = toSignal(this.tick.pipe(switchMap(() => this.api.getMetrics())), { initialValue: [] });
  alerts = toSignal(this.tick.pipe(switchMap(() => this.api.getAlerts())), { initialValue: [] });

  last = computed(() => this.metrics().at(-1));
  // Boîtier considéré en ligne s'il a envoyé une mesure dans les 10 dernières secondes
  online = computed(() => !!this.last() && Date.now() - this.last()!.ts < 10_000);
  recentAlerts = computed(() => this.alerts().slice(0, 5));   // l'API renvoie les plus récentes en premier

  temperature = computed(() => this.metrics().map((m) => m.temperature));
  humidity = computed(() => this.metrics().map((m) => m.humidity));
  gas = computed(() => this.metrics().map((m) => m.gas));

  webcamUrl = WEBCAM_URL;
  webcamError = signal(false);

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
