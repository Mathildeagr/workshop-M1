import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_URL } from '../config';
import { ApiService, type Alert, type Metric, type VisionStatus } from './api.service';

describe('ApiService', () => {
  let service: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('getMetrics envoie le paramètre limit', () => {
    const metrics: Metric[] = [{ ts: 1, temperature: 20, humidity: 40, gas: 100, motion: false }];
    let result: Metric[] | undefined;
    service.getMetrics(10).subscribe((r) => {
      result = r;
    });
    http.expectOne(`${API_URL}/metrics?limit=10`).flush(metrics);
    expect(result).toEqual(metrics);
  });

  it('getMetrics renvoie [] en cas d\'erreur', () => {
    let result: Metric[] | undefined;
    service.getMetrics().subscribe((r) => {
      result = r;
    });
    http.expectOne(`${API_URL}/metrics?limit=50`).flush(null, { status: 500, statusText: 'KO' });
    expect(result).toEqual([]);
  });

  it('getVisionStatus renvoie null si le service vision est absent', () => {
    let result: VisionStatus | null | undefined;
    service.getVisionStatus().subscribe((r) => {
      result = r;
    });
    http.expectOne(`${API_URL}/vision/status`).flush({ error: 'Service vision injoignable' }, { status: 503, statusText: 'KO' });
    expect(result).toBeNull();
  });

  it('setVision appelle start ou stop', () => {
    service.setVision(true).subscribe();
    http.expectOne({ method: 'POST', url: `${API_URL}/vision/start` }).flush({});
    service.setVision(false).subscribe();
    http.expectOne({ method: 'POST', url: `${API_URL}/vision/stop` }).flush({});
  });

  it("getStreamUrl renvoie l'URL avec ticket", () => {
    let result: string | null | undefined;
    service.getStreamUrl().subscribe((r) => {
      result = r;
    });
    http.expectOne(`${API_URL}/vision/stream-ticket`).flush({ ticket: 't', url: '/api/v1/vision/stream?ticket=t' });
    expect(result).toBe('/api/v1/vision/stream?ticket=t');
  });

  it('captureFace envoie nom, statut et nombre d’échantillons', () => {
    service.captureFace('alice', 'autorise', 5).subscribe();
    const req = http.expectOne(`${API_URL}/faces/capture`);
    expect(req.request.body).toEqual({ name: 'alice', status: 'autorise', samples: 5 });
    req.flush({});
  });

  it('setFaceStatus et deleteFace ciblent la personne', () => {
    service.setFaceStatus('alice', 'interdit').subscribe();
    const patch = http.expectOne({ method: 'PATCH', url: `${API_URL}/faces/alice` });
    expect(patch.request.body).toEqual({ status: 'interdit' });
    patch.flush({});
    service.deleteFace('alice').subscribe();
    http.expectOne({ method: 'DELETE', url: `${API_URL}/faces/alice` }).flush(null);
  });

  it('getAlerts renvoie les alertes', () => {
    const alerts: Alert[] = [
      { id: 1, source: 'esp01', type: 'gas', level: 'critical', acknowledged: false, createdAt: '2026-10-05T12:00:00.000Z' },
    ];
    let result: Alert[] | undefined;
    service.getAlerts().subscribe((r) => {
      result = r;
    });
    http.expectOne(`${API_URL}/alerts`).flush(alerts);
    expect(result).toEqual(alerts);
  });
});
