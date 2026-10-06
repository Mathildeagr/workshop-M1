import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_URL } from '../config';
import { ApiService, type Alert, type Metric } from './api.service';

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

  it('isApiUp renvoie true si /health répond', () => {
    let result: boolean | undefined;
    service.isApiUp().subscribe((r) => {
      result = r;
    });
    http.expectOne(`${API_URL}/health`).flush({ status: 'ok' });
    expect(result).toBe(true);
  });

  it('isApiUp renvoie false en cas d\'erreur', () => {
    let result: boolean | undefined;
    service.isApiUp().subscribe((r) => {
      result = r;
    });
    http.expectOne(`${API_URL}/health`).error(new ProgressEvent('error'));
    expect(result).toBe(false);
  });

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

  it('sendFace envoie la photo en multipart', () => {
    const image = new Blob(['x'], { type: 'image/jpeg' });
    let result: boolean | undefined;
    service.sendFace(image).subscribe((r) => {
      result = r;
    });
    const req = http.expectOne(`${API_URL}/faces`);
    expect(req.request.method).toBe('POST');
    expect((req.request.body as FormData).get('image')).toBeInstanceOf(Blob);
    req.flush({});
    expect(result).toBe(true);
  });

  it("sendFace renvoie false en cas d'erreur", () => {
    let result: boolean | undefined;
    service.sendFace(new Blob(['x'])).subscribe((r) => {
      result = r;
    });
    http.expectOne(`${API_URL}/faces`).flush(null, { status: 500, statusText: 'KO' });
    expect(result).toBe(false);
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
