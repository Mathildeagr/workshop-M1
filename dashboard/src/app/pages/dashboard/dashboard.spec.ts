import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
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

  function setup(api: Partial<ApiService>) {
    TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { logout: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    vi.advanceTimersByTime(0); // déclenche le premier appel du polling
    fixture.detectChanges();
    return { app: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('affiche le titre', () => {
    const { el } = setup({ isApiUp: () => of(true), getMetrics: () => of([]), getAlerts: () => of([]) });
    expect(el.querySelector('h1')?.textContent).toContain('Sentinel-X');
  });

  it('affiche le boîtier en ligne avec les données reçues', () => {
    const { app, el } = setup({
      isApiUp: () => of(true),
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

  it('affiche le boîtier hors ligne sans mesure récente', () => {
    const old = [{ ...metrics[0], ts: now - 60_000 }];
    const { app, el } = setup({
      isApiUp: () => of(false),
      getMetrics: () => of(old),
      getAlerts: () => of([]),
    });
    expect(app.online()).toBe(false);
    expect(el.querySelector('.badge')?.textContent).toContain('injoignable');
    expect(el.querySelector('.status')?.textContent).toContain('Aucune alerte');
  });

  it('remplace la webcam par un message en cas d\'erreur', () => {
    const { el } = setup({ isApiUp: () => of(true), getMetrics: () => of([]), getAlerts: () => of([]) });
    el.querySelector('.webcam img')?.dispatchEvent(new Event('error'));
    TestBed.tick();
    expect(el.querySelector('.webcam img')).toBeNull();
    expect(el.querySelector('.webcam')?.textContent).toContain('indisponible');
  });

  it('déconnecte et renvoie vers /login', () => {
    const { el } = setup({ isApiUp: () => of(true), getMetrics: () => of([]), getAlerts: () => of([]) });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Déconnexion'))?.click();
    expect(TestBed.inject(AuthService).logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });
});
