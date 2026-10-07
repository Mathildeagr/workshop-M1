import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ApiService,
  type CommandView,
  type NodeState,
  type NodeStatus,
  type PredictiveConfig,
  type Score,
  type SeqGap,
  type Telemetry,
} from './api.service';

const TELEMETRY_HISTORY = 90;   // ~3 min de courbe à une trame toutes les 2 s
const SCORE_HISTORY = 72;       // ~6 min à un score toutes les 5 s
const COMMANDS_KEPT = 15;
const GAPS_KEPT = 10;

/**
 * État temps réel du système, alimenté par les événements Socket.io du backend (voir AlertsService.connect) :
 * statut des nœuds, télémétrie, suivi des commandes, trous de séquence, score et configuration de predict-anomalie.
 * Aucune logique réseau ici : uniquement des signaux et leurs mises à jour, faciles à tester.
 */
@Injectable({ providedIn: 'root' })
export class LiveStateService {
  private api = inject(ApiService);

  private nodeMap = signal<Record<string, { status: NodeStatus; at: string | null }>>({});
  private telemetryMap = signal<Record<string, Telemetry[]>>({});
  private commandList = signal<CommandView[]>([]);
  private gapList = signal<(SeqGap & { at: string })[]>([]);
  private scoreMap = signal<Record<string, Score[]>>({});

  readonly predictiveConfig = signal<PredictiveConfig | null>(null);
  readonly commands = this.commandList.asReadonly();
  readonly seqGaps = this.gapList.asReadonly();

  // --- Lecture ---------------------------------------------------------------------------------

  nodeStatus(node: string): NodeStatus {
    return this.nodeMap()[node]?.status ?? 'unknown';
  }

  telemetry(node: string): Telemetry[] {
    return this.telemetryMap()[node] ?? [];
  }

  lastTelemetry(node: string): Telemetry | undefined {
    return this.telemetry(node).at(-1);
  }

  scores(source: string): Score[] {
    return this.scoreMap()[source] ?? [];
  }

  /** Nombre total d'événements perdus signalés depuis l'ouverture du dashboard. */
  readonly missingEvents = computed(() => this.gapList().reduce((n, g) => n + g.missing, 0));

  // --- Chargement initial (avant les premiers événements temps réel) ---------------------------

  load() {
    this.api.getNodes().subscribe((nodes) => nodes.forEach((n) => this.setNodeFromApi(n)));
    this.api.getCommands().subscribe((cmds) => this.commandList.set(cmds.slice(0, COMMANDS_KEPT)));
    this.api.getPredictiveConfig().subscribe((cfg) => cfg && this.predictiveConfig.set(cfg));
    this.api.getScores().subscribe((scores) => scores.forEach((s) => this.onScore(s)));
  }

  private setNodeFromApi(node: NodeState) {
    this.nodeMap.update((m) => ({ ...m, [node.id]: { status: node.status, at: node.statusAt } }));
  }

  // --- Événements Socket.io --------------------------------------------------------------------

  onNodeStatus(event: { node: string; status: NodeStatus; at: string }) {
    this.nodeMap.update((m) => ({ ...m, [event.node]: { status: event.status, at: event.at } }));
  }

  onTelemetry(t: Telemetry) {
    this.telemetryMap.update((m) => ({ ...m, [t.source]: [...(m[t.source] ?? []), t].slice(-TELEMETRY_HISTORY) }));
  }

  /** Nouvelle commande ou changement d'état (sent → retrying → acked / failed) : la plus récente en tête. */
  onCommandStatus(cmd: CommandView) {
    this.commandList.update((list) => {
      const previous = list.find((c) => c.id === cmd.id);
      const merged = { ...previous, ...cmd };
      return previous
        ? list.map((c) => (c.id === cmd.id ? merged : c))
        : [merged, ...list].slice(0, COMMANDS_KEPT);
    });
  }

  onSeqGap(gap: SeqGap) {
    this.gapList.update((list) => [{ ...gap, at: new Date().toISOString() }, ...list].slice(0, GAPS_KEPT));
  }

  onScore(score: Score) {
    this.scoreMap.update((m) => ({ ...m, [score.source]: [...(m[score.source] ?? []), score].slice(-SCORE_HISTORY) }));
  }

  onPredictiveConfig(config: PredictiveConfig) {
    this.predictiveConfig.set(config);
  }
}
