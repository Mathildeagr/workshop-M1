import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AlertsService } from '../../services/alerts.service';
import { ApiService, type Alert, type Metric } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { Dashboard } from './dashboard';

describe('Dashboard', () => {
  let now: number;
  let metrics: Metric[];
  let alerts: Alert[];

  beforeEach(() => {
    vi.useFakeTimers();
    now = Date.now();
    metrics = [
      { ts: now - 4000, temperature: 21, humidity: 40, gas: 100, motion: false },
      { ts: now - 2000, temperature: 22, humidity: 41, gas: 110, motion: true },
    ];
    alerts = [
      { id: 1, source: 'esp01', type: 'gas', level: 'critical', acknowledged: false, createdAt: new Date(now).toISOString() },
    ];
  });

  afterEach(() => vi.useRealTimers());

  // Alertes temps réel simulées : la liste vient de "getAlerts" de l'API simulée
  function fakeAlertsService(api: Partial<ApiService>) {
    const list = signal<Alert[]>([]);
    api.getAlerts?.().subscribe((a) => list.set(a));
    return { alerts: list.asReadonly(), live: signal(true), connect: vi.fn(), disconnect: vi.fn() };
  }

  function setup(api: Partial<ApiService>, role = 'lecteur') {
    const vision: Partial<ApiService> = {
      getVisionStatus: () => of(null),
      getStreamUrl: () => of(null),
      getFaces: () => of([]),
    };
    TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { ...vision, ...api } },
        { provide: AuthService, useValue: { logout: vi.fn(), user: () => ({ id: 1, username: 'u', role }) } },
        { provide: AlertsService, useValue: fakeAlertsService(api) },
      ],
    });
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    vi.advanceTimersByTime(0); // déclenche le premier appel du polling
    fixture.detectChanges();
    return { app: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('affiche le titre', () => {
    const { el } = setup({ getMetrics: () => of([]), getAlerts: () => of([]) });
    expect(el.querySelector('h1')?.textContent).toContain('Sentinel-X');
  });

  it('affiche le boîtier en ligne avec les données reçues', () => {
    const { app, el } = setup({
      getMetrics: () => of(metrics),
      getAlerts: () => of(alerts),
    });
    expect(app.online()).toBe(true);
    expect(app.temperature()).toEqual([21, 22]);
    expect(el.querySelector('.status')?.textContent).toContain('En ligne');
    expect(el.querySelector('.status')?.textContent).toContain('Détectée');
    expect(el.querySelectorAll('.alert').length).toBe(1);
    expect(el.querySelectorAll('app-line-chart').length).toBe(3);
  });

  it('affiche le niveau et le détail des alertes temps réel', () => {
    const scan: Alert = {
      id: 2, source: 'scan', type: 'mqtt_bruteforce', level: 'critical', acknowledged: false,
      value: { ip: '::1', failures: 5 }, createdAt: new Date(now).toISOString(),
    };
    const { el } = setup({ getMetrics: () => of([]), getAlerts: () => of([scan]) });
    const alert = el.querySelector('.alert');
    expect(alert?.classList).toContain('critical');
    expect(alert?.textContent).toContain('mqtt_bruteforce (scan)');
    expect(alert?.querySelector('small')?.textContent).toContain('ip: ::1, failures: 5');
    expect(el.querySelector('.live')?.textContent).toContain('Temps réel');
    expect(TestBed.inject(AlertsService).connect).toHaveBeenCalled();
  });

  it("affiche les alertes au nouveau format : libellé, détail, émetteur et heure de l'émetteur", () => {
    const predictive: Alert = {
      id: 3, source: 'esp01', emitter: 'predictive', type: 'env_critical', level: 'critical',
      value: 0.999, detail: 'temperature +49.3/h', origin: 'model', meta: { score: 0.999 },
      occurredAt: '2026-10-07T07:05:21.000Z', acknowledged: false, createdAt: '2026-10-07T07:06:00.000Z',
    };
    const { el } = setup({ getMetrics: () => of([]), getAlerts: () => of([predictive]) });
    const alert = el.querySelector('.alert');
    expect(alert?.textContent).toContain('Environnement critique (esp01)');
    expect(alert?.getAttribute('title')).toBe('env_critical');
    expect(alert?.querySelector('small')?.textContent).toContain('temperature +49.3/h · 0.999 · via predictive');
    expect(alert?.textContent).toContain(new Date(predictive.occurredAt!).toTimeString().slice(0, 8));
  });

  it('affiche le boîtier hors ligne sans mesure récente', () => {
    const old = [{ ...metrics[0], ts: now - 60_000 }];
    const { app, el } = setup({
      getMetrics: () => of(old),
      getAlerts: () => of([]),
    });
    expect(app.online()).toBe(false);
    expect(el.querySelector('.status')?.textContent).toContain('Aucune alerte');
  });

  it('affiche la caméra Sentinel et cache les visages au rôle lecteur', () => {
    const { el } = setup({ getMetrics: () => of([]), getAlerts: () => of([]) });
    expect(el.querySelector('app-vision-feed')?.textContent).toContain('Service vision injoignable');
    expect(el.querySelector('app-faces-manager')).toBeNull();
  });

  it('affiche la gestion des visages aux superviseurs', () => {
    const empty = { getMetrics: () => of([]), getAlerts: () => of([]) };
    const { el } = setup(empty, 'superviseur');
    expect(el.querySelector('app-faces-manager')).not.toBeNull();
  });

  it('déconnecte et renvoie vers /login', () => {
    const { el } = setup({ getMetrics: () => of([]), getAlerts: () => of([]) });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Déconnexion'))?.click();
    expect(TestBed.inject(AuthService).logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });
});
