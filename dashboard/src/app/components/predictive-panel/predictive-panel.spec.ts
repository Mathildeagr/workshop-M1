import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { LiveStateService } from '../../services/live-state.service';
import { PredictivePanel, formatDays } from './predictive-panel';

describe('PredictivePanel', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;

  function setup(role = 'superviseur') {
    api = {
      setPredictiveConfig: vi.fn(() => of({ ok: true })),
      retrain: vi.fn(() => of({ ok: true })),
    };
    TestBed.configureTestingModule({
      imports: [PredictivePanel],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { user: () => ({ id: 1, username: 'u', role }) } },
      ],
    });
    const fixture = TestBed.createComponent(PredictivePanel);
    fixture.detectChanges();
    return { fixture, app: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, live: TestBed.inject(LiveStateService) };
  }

  it('formate une durée en jours, heures ou minutes', () => {
    expect(formatDays(30)).toBe('30 j');
    expect(formatDays(0.25)).toBe('6 h');
    expect(formatDays(0.01)).toBe('14 min');
    expect(formatDays(undefined)).toBe('–');
    expect(formatDays(0)).toBe('–');   // pas « 1 min » : zero est une absence, pas une duree courte
  });

  it("dit qu'aucun modèle n'est entraîné plutôt que d'annoncer une minute d'historique", () => {
    const { fixture, el, live } = setup();
    live.onPredictiveConfig({ sensitivity: 'medium', window_days: 7, effective_days: 0 });
    fixture.detectChanges();
    const text = el.querySelector('.facts')?.textContent ?? '';
    expect(text).toContain('demandée : 7 j — historique disponible : aucun modèle entraîné');
    expect(text).not.toContain('1 min');
    expect(el.querySelector('.facts .warn')).not.toBeNull();
  });

  it('affiche la fenêtre demandée ET la fenêtre couverte, signalée si elle est courte (§10.4)', () => {
    const { fixture, el, live } = setup();
    live.onPredictiveConfig({ sensitivity: 'high', window_days: 30, effective_days: 0.25 });
    fixture.detectChanges();
    const text = el.querySelector('.facts')?.textContent ?? '';
    expect(text).toContain('demandée : 30 j — historique disponible : 6 h');
    expect(el.querySelector('.facts .warn')).not.toBeNull();
    expect(text).toContain('haute');
  });

  it("affiche l'état du détecteur et la courbe du score en direct", () => {
    const { fixture, el, live } = setup();
    live.onScore({ source: 'esp01', score: 0.42, stage: 'normal' });
    live.onScore({ source: 'esp01', score: 0.97, stage: 'anomaly' });
    fixture.detectChanges();
    expect(el.querySelector('.stage')?.textContent).toContain('Anomalie');
    expect(el.querySelector('app-line-chart')).not.toBeNull();
  });

  it('envoie les réglages et le réapprentissage', () => {
    const { app, el } = setup();
    app.sensitivity = 'low';
    app.windowDays = 14;
    app.apply();
    expect(api['setPredictiveConfig']).toHaveBeenCalledWith({ sensitivity: 'low', window_days: 14 });
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Réapprendre'))?.click();
    expect(api['retrain']).toHaveBeenCalled();
  });

  it('un lecteur ne voit pas les réglages', () => {
    const { el } = setup('lecteur');
    expect(el.querySelector('form.settings')).toBeNull();
  });
});
