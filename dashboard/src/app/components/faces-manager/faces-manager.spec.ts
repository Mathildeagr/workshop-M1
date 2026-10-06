import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService, type Face } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { FacesManager } from './faces-manager';

describe('FacesManager', () => {
  const faces: Face[] = [{ name: 'alice', status: 'autorise', samples: 10 }];
  let api: Record<string, ReturnType<typeof vi.fn>>;

  function setup(role = 'admin') {
    api = {
      getFaces: vi.fn(() => of(faces)),
      captureFace: vi.fn(() => of({ ok: true })),
      setFaceStatus: vi.fn(() => of({ ok: true })),
      deleteFace: vi.fn(() => of({ ok: false, error: 'Personne inconnue' })),
    };
    TestBed.configureTestingModule({
      imports: [FacesManager],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { user: () => ({ id: 1, username: 'u', role }) } },
      ],
    });
    const fixture = TestBed.createComponent(FacesManager);
    fixture.detectChanges();
    return { fixture, app: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('liste les visages en lecture seule pour un superviseur', () => {
    const { el } = setup('superviseur');
    expect(el.textContent).toContain('alice');
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('select')).toBeNull();
  });

  it('capture via la caméra Sentinel avec les valeurs du formulaire', () => {
    const { fixture, app, el } = setup();
    app.form.setValue({ name: 'bob', status: 'interdit', samples: 5 });
    fixture.detectChanges();
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(api['captureFace']).toHaveBeenCalledWith('bob', 'interdit', 5);
    expect(el.textContent).toContain('bob enregistré(e)');
    expect(api['getFaces']).toHaveBeenCalledTimes(2);
  });

  it('refuse un nom invalide', () => {
    const { fixture, app, el } = setup();
    app.form.controls.name.setValue('../x');
    app.form.controls.name.markAsDirty();
    fixture.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('form button')?.disabled).toBe(true);
    app.capture();
    expect(api['captureFace']).not.toHaveBeenCalled();
  });

  it('change le statut et affiche les erreurs de suppression', () => {
    const { fixture, app, el } = setup();
    app.setStatus(faces[0], 'interdit');
    expect(api['setFaceStatus']).toHaveBeenCalledWith('alice', 'interdit');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    app.remove(faces[0]);
    fixture.detectChanges();
    expect(api['deleteFace']).toHaveBeenCalledWith('alice');
    expect(el.textContent).toContain('Personne inconnue');
  });
});
