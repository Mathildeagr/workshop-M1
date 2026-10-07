import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService, type VisionStatus } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { VisionFeed } from './vision-feed';

const base: VisionStatus = {
  enabled: true,
  running: true,
  enrolling: false,
  error: null,
  persons: 1,
  detections: [{ name: 'alice', status: 'autorise', kind: 'face', score: 0.8 }],
  ms: 40,
  at: 1,
};

describe('VisionFeed', () => {
  let api: {
    getVisionStatus: ReturnType<typeof vi.fn>;
    getStreamUrl: ReturnType<typeof vi.fn>;
    setVision: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(status: VisionStatus | null, role = 'admin') {
    api = {
      getVisionStatus: vi.fn(() => of(status)),
      getStreamUrl: vi.fn(() => of('/api/v1/vision/stream?ticket=t')),
      setVision: vi.fn(() => of({ ok: true })),
    };
    TestBed.configureTestingModule({
      imports: [VisionFeed],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { user: () => ({ id: 1, username: 'u', role }) } },
      ],
    });
    const fixture = TestBed.createComponent(VisionFeed);
    fixture.detectChanges();
    vi.advanceTimersByTime(0);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('affiche le flux avec un ticket quand la vision tourne', () => {
    const { el } = setup(base);
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/api/v1/vision/stream?ticket=t');
    expect(el.textContent).toContain('Détection active');
    expect(el.textContent).toContain('alice');
  });

  it("garde le flux pendant un enrôlement (aperçu de la capture)", () => {
    const { el } = setup({ ...base, running: false, enrolling: true });
    expect(el.querySelector('img')).not.toBeNull();
    expect(el.textContent).toContain('Enrôlement en cours');
  });

  it('indique un service vision injoignable', () => {
    const { el } = setup(null);
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('Service vision injoignable');
    expect(el.querySelector('button')).toBeNull();
  });

  it('redemande un ticket après une coupure du flux', () => {
    const { fixture, el } = setup(base);
    el.querySelector('img')?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(el.querySelector('img')).toBeNull();
    vi.advanceTimersByTime(3000);
    fixture.detectChanges();
    expect(api.getStreamUrl).toHaveBeenCalledTimes(2);
    expect(el.querySelector('img')).not.toBeNull();
  });

  it('arrête la vision (admin, superviseur)', () => {
    const { el } = setup(base, 'superviseur');
    el.querySelector('button')?.click();
    expect(api.setVision).toHaveBeenCalledWith(false);
  });

  it('pas de bouton pour le rôle lecteur', () => {
    const { el } = setup(base, 'lecteur');
    expect(el.querySelector('button')).toBeNull();
  });

  it("signale les alertes détectées mais non transmises au backend, avec la cause", () => {
    const { el } = setup({ ...base, alerts: { enabled: true, sent: 0, failed: 4, last_error: 'certificat CA introuvable', last_error_at: 1, last_sent_at: null } });
    expect(el.querySelector('.msg.error')?.textContent).toContain('Alertes non transmises : certificat CA introuvable (4 perdue(s))');
  });

  it("confirme les alertes transmises, et prévient si l'envoi est désactivé", () => {
    const ok = setup({ ...base, alerts: { enabled: true, sent: 3, failed: 0, last_error: null, last_error_at: null, last_sent_at: 1 } });
    expect(ok.el.textContent).toContain('3 alerte(s) transmise(s) au backend');
    TestBed.resetTestingModule();
    const off = setup({ ...base, alerts: { enabled: false, sent: 0, failed: 0, last_error: null, last_error_at: null, last_sent_at: null } });
    expect(off.el.querySelector('.msg.warn')?.textContent).toContain('Envoi des alertes désactivé');
  });
});
