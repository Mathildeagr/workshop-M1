import type { Alert } from './api.service';

/** Libellés des événements du contrat commun (docs/contrat-evenements-esp01.md). */
const TYPE_LABELS: Record<string, string> = {
  // Nœud esp01 : sabotage
  tamper_suspected: 'Activité suspecte',
  tamper_removed: 'Boîtier déplacé',
  tamper_opened: 'Objectif masqué',
  tamper_cleared: 'Retour au repos',
  // Nœud esp01 : état
  node_boot: 'Démarrage du nœud',
  sensor_fault: 'Capteur en panne',
  sensor_recovered: 'Capteur rétabli',
  // Vision
  intrusion_unknown: 'Personne inconnue',
  intrusion_unidentified: 'Visage dissimulé',
  intrusion_prohibited: 'Personne interdite',
  intrusion_cleared: 'Zone dégagée',
  // Maintenance prédictive
  env_drift: 'Dérive environnementale',
  env_anomaly: 'Anomalie environnementale',
  env_critical: 'Environnement critique',
};

/** Alerte prête à afficher. */
export interface AlertView {
  id: number;
  level: Alert['level'];
  acknowledged: boolean;
  type: string;
  title: string;
  source: string;
  /** Heure de l'émetteur s'il a une horloge, sinon heure de réception. */
  time: string;
  details: string;
}

/** Valeur d'une alerte en texte : 812, ou "ip: ::1, failures: 5" pour un objet. */
function describeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    return Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(', ');
  }
  return String(value);
}

export function toAlertView(alert: Alert): AlertView {
  // L'émetteur n'est utile que s'il parle pour un autre nœud (predictive, vision)
  const via = alert.emitter && alert.emitter !== alert.source ? `via ${alert.emitter}` : '';
  return {
    id: alert.id,
    level: alert.level,
    acknowledged: alert.acknowledged,
    type: alert.type,
    title: TYPE_LABELS[alert.type] ?? alert.type,
    source: alert.source,
    time: alert.occurredAt ?? alert.createdAt,
    details: [alert.detail, describeValue(alert.value), via].filter(Boolean).join(' · '),
  };
}
