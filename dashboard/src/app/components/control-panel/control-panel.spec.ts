import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService, type CommandView } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { LiveStateService } from '../../services/live-state.service';
import { ControlPanel } from './control-panel';

describe('ControlPanel', () => {
  let sendCommand: ReturnType<typeof vi.fn>;

  function setup(role = 'superviseur', response: { command: CommandView | null; error?: string } = {
    command: { id: 'cmd-1', node: 'esp01', event: 'intrusion_prohibited', trigger: 'manual', status: 'sent', attempts: 1 },
  }) {
    sendCommand = vi.fn(() => of(response));
    TestBed.configureTestingModule({
      imports: [ControlPanel],
      providers: [
        { provide: ApiService, useValue: { sendCommand } },
        { provide: AuthService, useValue: { user: () => ({ id: 1, username: 'u', role }) } },
      ],
    });
    const fixture = TestBed.createComponent(ControlPanel);
    fixture.detectChanges();
    return { fixture, app: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, live: TestBed.inject(LiveStateService) };
  }

  const button = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

  it("déclenche l'alarme choisie sur le boîtier et l'affiche aussitôt dans les ordres", () => {
    const { fixture, el } = setup();
    button(el, 'Déclencher')?.click();
    fixture.detectChanges();
    expect(sendCommand).toHaveBeenCalledWith({ node: 'esp01', event: 'intrusion_prohibited' });
    expect(el.querySelector('.commands li.sent')?.textContent).toContain('Personne interdite');
    expect(el.querySelector('.msg.ok')).not.toBeNull();
  });

  it('coupe le son de la cible choisie', () => {
    const { app, el } = setup();
    app.target = 'sabotage';
    button(el, 'Couper le son')?.click();
    expect(sendCommand).toHaveBeenCalledWith({ node: 'esp01', event: 'deactivate', target: 'sabotage', signal: 'sonore' });
  });

  it("montre que le système insiste, puis le résultat (§10.2)", () => {
    const { fixture, el, live } = setup();
    live.onCommandStatus({ id: 'cmd-9', node: 'esp01', event: 'tamper_opened', trigger: 'rule', status: 'retrying', attempts: 2, maxAttempts: 3 });
    fixture.detectChanges();
    expect(el.querySelector('.commands li.retrying')?.textContent).toContain('nouvelle tentative 2/3');
    live.onCommandStatus({ id: 'cmd-9', node: 'esp01', event: 'tamper_opened', trigger: 'rule', status: 'failed', attempts: 3, reason: 'aucun accusé après 3 tentatives' });
    fixture.detectChanges();
    expect(el.querySelector('.commands li.failed')?.textContent).toContain('aucun accusé après 3 tentatives');
    live.onCommandStatus({ id: 'cmd-10', node: 'esp01', event: 'tamper_removed', trigger: 'rule', status: 'acked', attempts: 1, latencyMs: 42 });
    fixture.detectChanges();
    expect(el.querySelector('.commands li.acked')?.textContent).toContain('42 ms');
  });

  it('nœud hors ligne : coupure mémorisée pour son redémarrage', () => {
    const { fixture, el } = setup('superviseur', {
      command: { id: 'cmd-2', node: 'esp01', event: 'deactivate', trigger: 'manual', status: 'failed', attempts: 0, appliedAtNextBoot: true },
    });
    button(el, 'Couper la lumière')?.click();
    fixture.detectChanges();
    expect(el.querySelector('.msg')?.textContent).toContain('appliqué à son redémarrage');
  });

  it("affiche l'erreur de l'API si la commande est refusée", () => {
    const { fixture, el } = setup('superviseur', { command: null, error: 'Nœud inconnu : esp01' });
    button(el, 'Déclencher')?.click();
    fixture.detectChanges();
    expect(el.querySelector('.msg.error')?.textContent).toContain('Nœud inconnu');
  });

  it('un lecteur voit les ordres mais ne peut rien déclencher', () => {
    const { el } = setup('lecteur');
    expect(button(el, 'Déclencher')).toBeUndefined();
    expect(el.querySelector('.commands')).not.toBeNull();
  });
});
