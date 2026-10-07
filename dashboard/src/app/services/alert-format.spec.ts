import { describeVariable, toAlertView } from './alert-format';
import type { Alert } from './api.service';

function alert(extra: Partial<Alert>): Alert {
  return { id: 1, source: 'esp01', type: 'gas_leak', level: 'info', acknowledged: false, createdAt: '2026-10-07T07:06:00.000Z', ...extra };
}

describe('toAlertView', () => {
  it('traduit les événements du contrat et garde le type brut sinon', () => {
    expect(toAlertView(alert({ type: 'tamper_opened' })).title).toBe('Objectif masqué');
    expect(toAlertView(alert({ type: 'mqtt_bruteforce' })).title).toBe('mqtt_bruteforce');
  });

  it('esp01 : détail et valeur, sans émetteur puisque le nœud parle pour lui-même', () => {
    const view = toAlertView(alert({ type: 'tamper_opened', emitter: 'esp01', detail: 'objectif', value: 3 }));
    expect(view.details).toBe('objectif · 3');
  });

  it("predictive : l'émetteur est indiqué et l'heure de l'émetteur prime", () => {
    const view = toAlertView(alert({
      emitter: 'predictive', detail: 'temperature +49.3/h', value: 0.999, occurredAt: '2026-10-07T07:05:21.000Z',
    }));
    expect(view.details).toBe('temperature +49.3/h · 0.999 · via predictive');
    expect(view.time).toBe('2026-10-07T07:05:21.000Z');
  });

  it("anciennes alertes : valeur objet, heure de réception", () => {
    const view = toAlertView(alert({ value: { ip: '::1', failures: 5 }, emitter: null, occurredAt: null }));
    expect(view.details).toBe('ip: ::1, failures: 5');
    expect(view.time).toBe('2026-10-07T07:06:00.000Z');
  });

  it("predict-anomalie : explique l'alerte par les 3 variables qui pèsent le plus (§10.5)", () => {
    const view = toAlertView(alert({
      type: 'env_anomaly', emitter: 'predictive',
      meta: { contributions: { humidity_resid: 0.48, temperature_slope: 0.3, dew_point: 0.12, hour_sin: 0.1 } },
    }));
    expect(view.reason).toBe('humidité, écart au profil horaire 48 % · température, pente sur 15 min 30 % · point de rosée 12 %');
  });

  it('sans contributions, pas de raison ; libellés des alertes du backend', () => {
    expect(toAlertView(alert({ meta: { seq: 3 } })).reason).toBe('');
    expect(toAlertView(alert({ type: 'node_offline' })).title).toBe('Nœud hors ligne');
    expect(toAlertView(alert({ type: 'seq_gap' })).title).toBe('Événements perdus');
  });

  it('nomme les variables du modèle', () => {
    expect(describeVariable('temperature_slope_long')).toBe('température, pente sur 1 h');
    expect(describeVariable('gas_ratio_spread')).toBe('gaz, agitation');
    expect(describeVariable('inconnue')).toBe('inconnue');
  });
});
