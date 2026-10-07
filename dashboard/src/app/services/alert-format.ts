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
  env_cleared: 'Environnement revenu à la normale',
  // Vision (format historique : le statut du visage est dans value)
  intrusion: 'Intrusion détectée',
  // Générées par le backend
  node_offline: 'Nœud hors ligne',
  node_online: 'Nœud reconnecté',
  seq_gap: 'Événements perdus',
  command_failed: 'Alarme non exécutée',
};

/** Variables d'entrée du modèle (briefing §9.3) : nom de base + suffixe. */
const VARIABLE_LABELS: Record<string, string> = {
  temperature: 'température',
  humidity: 'humidité',
  dew_point: 'point de rosée',
  gas_ratio: 'gaz',
  hour_sin: 'heure du jour',
  hour_cos: 'heure du jour',
};
const SUFFIX_LABELS: [string, string][] = [
  ['_slope_long', 'pente sur 1 h'],
  ['_slope', 'pente sur 15 min'],
  ['_resid', 'écart au profil horaire'],
  ['_spread', 'agitation'],
];

/** temperature_slope -> "température, pente sur 15 min" */
export function describeVariable(name: string): string {
  for (const [suffix, label] of SUFFIX_LABELS) {
    if (name.endsWith(suffix)) {
      const base = name.slice(0, -suffix.length);
      return `${VARIABLE_LABELS[base] ?? base}, ${label}`;
    }
  }
  return VARIABLE_LABELS[name] ?? name;
}

/** Les 3 variables qui pèsent le plus dans l'écart (meta.contributions, somme 1), ex : "humidité 48 %". */
export function describeContributions(meta: Alert['meta']): string {
  const contributions = meta?.['contributions'];
  if (!contributions || typeof contributions !== 'object') return '';
  return Object.entries(contributions as Record<string, number>)
    .filter(([, share]) => typeof share === 'number')
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([name, share]) => `${describeVariable(name)} ${Math.round(share * 100)} %`)
    .join(' · ');
}

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
  /** Pourquoi le modèle a alerté (predict-anomalie), vide sinon. */
  reason: string;
}

/** Libellé lisible d'un nom d'événement (alerte ou séquence jouée par le nœud). */
export function eventLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
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
    title: eventLabel(alert.type),
    source: alert.source,
    time: alert.occurredAt ?? alert.createdAt,
    details: [alert.detail, describeValue(alert.value), via].filter(Boolean).join(' · '),
    reason: describeContributions(alert.meta),
  };
}
