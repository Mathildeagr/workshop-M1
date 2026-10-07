import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, type Sensitivity } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { LiveStateService } from '../../services/live-state.service';
import { LineChart } from '../line-chart/line-chart';

const STAGE_LABELS: Record<string, string> = {
  normal: 'Normal',
  drift: 'Dérive',
  anomaly: 'Anomalie',
  critical: 'Critique',
};

const SENSITIVITY_LABELS: Record<Sensitivity, string> = { low: 'basse', medium: 'moyenne', high: 'haute' };

/** 30 -> "30 j", 0.25 -> "6 h", 0.01 -> "14 min" */
export function formatDays(days: number | undefined): string {
  if (days === undefined || !Number.isFinite(days)) return '–';
  if (days >= 1) return `${Math.round(days * 10) / 10} j`;
  if (days * 24 >= 1) return `${Math.round(days * 24)} h`;
  return `${Math.max(1, Math.round(days * 24 * 60))} min`;
}

/**
 * Maintenance prédictive : score du détecteur en direct, configuration effective et réglages de l'opérateur.
 * La fenêtre demandée et celle réellement couverte sont toujours affichées ensemble (briefing §10.4) :
 * un modèle entraîné sur 6 h ne sait rien du cycle de la semaine.
 */
@Component({
  selector: 'app-predictive-panel',
  imports: [FormsModule, LineChart],
  templateUrl: './predictive-panel.html',
  styleUrl: './predictive-panel.css',
})
export class PredictivePanel {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private live = inject(LiveStateService);

  node = input('esp01');
  readonly sensitivityLabels = SENSITIVITY_LABELS;

  canEdit = computed(() => ['admin', 'superviseur'].includes(this.auth.user()?.role ?? ''));
  config = this.live.predictiveConfig;
  scores = computed(() => this.live.scores(this.node()));
  lastScore = computed(() => this.scores().at(-1));
  /** Score en %, pour la courbe (0 = banal, 100 = inédit). */
  scoreValues = computed(() => this.scores().filter((s) => s.score !== undefined).map((s) => Math.round(s.score! * 100)));
  stage = computed(() => STAGE_LABELS[this.lastScore()?.stage ?? ''] ?? this.lastScore()?.stage ?? '–');

  requested = computed(() => formatDays(this.config()?.window_days));
  covered = computed(() => formatDays(this.config()?.effective_days));
  /** Historique nettement plus court que la fenêtre demandée : à signaler. */
  shortHistory = computed(() => {
    const c = this.config();
    return !!c?.window_days && c.effective_days !== undefined && c.effective_days < c.window_days * 0.9;
  });

  sensitivity: Sensitivity = 'medium';
  windowDays = 30;
  busy = signal(false);
  message = signal<{ ok: boolean; text: string } | null>(null);

  apply() {
    this.run(this.api.setPredictiveConfig({ sensitivity: this.sensitivity, window_days: this.windowDays }),
      'Réglage envoyé : la configuration affichée se mettra à jour quand la brique l\'aura appliqué');
  }

  retrain() {
    this.run(this.api.retrain(), 'Réapprentissage demandé');
  }

  private run(action: ReturnType<ApiService['retrain']>, successText: string) {
    this.busy.set(true);
    this.message.set(null);
    action.subscribe((result) => {
      this.busy.set(false);
      this.message.set(result.ok ? { ok: true, text: successText } : { ok: false, text: result.error ?? 'Échec' });
    });
  }
}
