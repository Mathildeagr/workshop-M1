import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { FaceScan } from './face-scan';

describe('FaceScan', () => {
  let fixture: ComponentFixture<FaceScan>;
  let component: FaceScan;
  let el: HTMLElement;
  let api: { sendFace: ReturnType<typeof vi.fn> };
  let track: { stop: ReturnType<typeof vi.fn> };
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    track = { stop: vi.fn() };
    getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });

    // jsdom n'implémente pas le canvas : on simule le dessin et l'export JPEG
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAA');
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['x'])));

    api = { sendFace: vi.fn(() => of(true)) };
    TestBed.configureTestingModule({
      imports: [FaceScan],
      providers: [{ provide: ApiService, useValue: api }],
    });
    fixture = TestBed.createComponent(FaceScan);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => vi.restoreAllMocks());

  const click = (label: string) => {
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
    button?.click();
    fixture.detectChanges();
  };

  async function startAndCapture() {
    await component.start();
    fixture.detectChanges();
    click('Capturer');
  }

  it('affiche la caméra éteinte par défaut', () => {
    expect(el.textContent).toContain('Caméra éteinte');
    expect(el.textContent).toContain('Activer la caméra');
  });

  it('active la caméra frontale en 640x480', async () => {
    await component.start();
    fixture.detectChanges();
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    expect(component.cameraOn()).toBe(true);
    expect(el.querySelector('.guide')).not.toBeNull();
    expect(el.textContent).toContain('Capturer');
  });

  it('affiche une erreur si la caméra est refusée', async () => {
    getUserMedia.mockRejectedValue(new Error('NotAllowedError'));
    await component.start();
    fixture.detectChanges();
    expect(component.status()).toBe('camera-error');
    expect(el.textContent).toContain('Caméra inaccessible');
  });

  it('capture une photo et coupe la caméra', async () => {
    await startAndCapture();
    expect(component.photo()).toBe('data:image/jpeg;base64,AAA');
    expect(track.stop).toHaveBeenCalled();
    expect(el.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,AAA');
    expect(el.textContent).toContain('Envoyer');
  });

  it('envoie la photo au backend', async () => {
    await startAndCapture();
    click('Envoyer');
    expect(api.sendFace).toHaveBeenCalledWith(expect.any(Blob));
    expect(component.status()).toBe('sent');
    expect(el.textContent).toContain('Visage envoyé');
    expect(el.querySelector('button')?.disabled).toBe(true);
  });

  it("affiche une erreur si l'envoi échoue", async () => {
    api.sendFace.mockReturnValue(of(false));
    await startAndCapture();
    click('Envoyer');
    expect(component.status()).toBe('send-error');
    expect(el.textContent).toContain("Échec de l'envoi");
  });

  it('coupe la caméra à la destruction du composant', async () => {
    await component.start();
    fixture.destroy();
    expect(track.stop).toHaveBeenCalled();
  });
});
