import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { eventLabel } from '../../services/alert-format';
import {
  ApiService,
  type CommandRequest,
  type CommandView,
  type SignalKind,
  type SignalTarget,
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { LiveStateService } from '../../services/live-state.service';

/** Séquences que le nœud sait jouer (briefing §4.1), regroupées comme les familles d'alertes. */
const SEQUENCES: { group: string; events: string[] }[] = [
  { group: 'Intrusion', events: ['intrusion_unknown', 'intrusion_unidentified', 'intrusion_prohibited', 'intrusion_cleared'] },
  { group: 'Sabotage', events: ['tamper_suspected', 'tamper_opened', 'tamper_removed', 'tamper_cleared'] },
  { group: 'Environnement', events: ['env_drift', 'env_anomaly', 'env_critical', 'env_cleared'] },
];

const STATUS_LABELS: Record<CommandView['status'], string> = {
  pending: 'en attente',
  sent: 'envoyée',
  retrying: 'nouvelle tentative',
  acked: 'exécutée',
  failed: 'échec',
};

const TRIGGER_LABELS: Record<CommandView['trigger'], string> = {
  rule: 'auto',
  manual: 'manuel',
  replay: 'rejeu',
};

/**
 * Contrôle réactif (cahier des charges) : déclencher une alarme sur le boîtier, couper ou rétablir
 * le son et la lumière, et suivre chaque ordre jusqu'à son accusé d'exécution (briefing §10.2).
 */
@Component({
  selector: 'app-control-panel',
  imports: [FormsModule],
  templateUrl: './control-panel.html',
  styleUrl: './control-panel.css',
})
export class ControlPanel {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private live = inject(LiveStateService);

  node = input('esp01');
  readonly sequences = SEQUENCES;
  readonly label = eventLabel;

  canControl = computed(() => ['admin', 'superviseur'].includes(this.auth.user()?.role ?? ''));
  nodeOffline = computed(() => this.live.nodeStatus(this.node()) === 'offline');
  commands = computed(() => this.live.commands().filter((c) => c.node === this.node()));

  sequence = 'intrusion_prohibited';
  target: SignalTarget = 'tout';
  sending = signal(false);
  message = signal<{ ok: boolean; text: string } | null>(null);

  play() {
    this.send({ node: this.node(), event: this.sequence }, `${eventLabel(this.sequence)} envoyé`);
  }

  setSignal(event: 'activate' | 'deactivate', signal: SignalKind) {
    const what = signal === 'sonore' ? 'Son' : signal === 'lumineux' ? 'Lumière' : 'Son et lumière';
    const done = event === 'deactivate' ? `${what} coupé(e)` : `${what} rétabli(e)`;
    this.send({ node: this.node(), event, target: this.target, signal }, `${done} (${this.target})`);
  }

  private send(request: CommandRequest, successText: string) {
    this.sending.set(true);
    this.message.set(null);
    this.api.sendCommand(request).subscribe(({ command, error }) => {
      this.sending.set(false);
      if (command) this.live.onCommandStatus(command);   // visible tout de suite, les mises à jour suivent en direct
      if (!command) return this.message.set({ ok: false, text: error ?? 'Commande refusée' });
      if (command.appliedAtNextBoot) {
        return this.message.set({ ok: true, text: 'Nœud hors ligne : réglage mémorisé, appliqué à son redémarrage' });
      }
      if (command.status === 'failed') return this.message.set({ ok: false, text: command.reason ?? 'Échec' });
      this.message.set({ ok: true, text: successText });
    });
  }

  statusText(cmd: CommandView): string {
    if (cmd.status === 'retrying' || (cmd.status === 'sent' && cmd.attempts > 1)) {
      return `${STATUS_LABELS.retrying} ${cmd.attempts}/${cmd.maxAttempts ?? 3}`;
    }
    if (cmd.status === 'acked' && cmd.latencyMs != null) return `${STATUS_LABELS.acked} · ${cmd.latencyMs} ms`;
    if (cmd.status === 'failed' && cmd.reason) return `${STATUS_LABELS.failed} · ${cmd.reason}`;
    return STATUS_LABELS[cmd.status] ?? cmd.status;
  }

  triggerText(cmd: CommandView): string {
    return TRIGGER_LABELS[cmd.trigger] ?? cmd.trigger;
  }

  commandText(cmd: CommandView): string {
    return cmd.event === 'activate' || cmd.event === 'deactivate'
      ? cmd.event === 'activate' ? 'Rétablir les signaux' : 'Couper les signaux'
      : eventLabel(cmd.event);
  }
}
