import { toAlertView } from './alert-format';
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
});
