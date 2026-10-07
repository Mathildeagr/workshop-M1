import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiService, type CommandView, type Telemetry } from './api.service';
import { LiveStateService } from './live-state.service';

describe('LiveStateService', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;

  function setup() {
    api = {
      getNodes: vi.fn(() => of([{ id: 'esp01', status: 'online', statusAt: null, lastTelemetryAt: null }])),
      getCommands: vi.fn(() => of([])),
      getPredictiveConfig: vi.fn(() => of({ sensitivity: 'high', window_days: 30, effective_days: 0.25 })),
      getScores: vi.fn(() => of([{ source: 'esp01', score: 0.4, stage: 'normal' }])),
    };
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    return TestBed.inject(LiveStateService);
  }

  const cmd = (extra: Partial<CommandView>): CommandView =>
    ({ id: 'cmd-1', node: 'esp01', event: 'tamper_opened', trigger: 'rule', status: 'sent', attempts: 1, ...extra });

  it("charge l'état initial : nœuds, configuration et scores", () => {
    const live = setup();
    live.load();
    expect(live.nodeStatus('esp01')).toBe('online');
    expect(live.nodeStatus('esp02')).toBe('unknown');
    expect(live.predictiveConfig()?.effective_days).toBe(0.25);
    expect(live.scores('esp01').length).toBe(1);
  });

  it('suit le statut des nœuds en direct', () => {
    const live = setup();
    live.onNodeStatus({ node: 'esp01', status: 'offline', at: '' });
    expect(live.nodeStatus('esp01')).toBe('offline');
  });

  it('garde un historique borné de télémétrie par nœud', () => {
    const live = setup();
    for (let i = 0; i < 120; i++) live.onTelemetry({ source: 'esp01', receivedAt: '', temperature_c: i } as Telemetry);
    expect(live.telemetry('esp01').length).toBe(90);
    expect(live.lastTelemetry('esp01')?.temperature_c).toBe(119);
    expect(live.telemetry('esp02')).toEqual([]);
  });

  it("suit une commande de l'envoi à l'abandon, sans la dupliquer", () => {
    const live = setup();
    live.onCommandStatus(cmd({}));
    live.onCommandStatus(cmd({ status: 'retrying', attempts: 2 }));
    live.onCommandStatus(cmd({ id: 'cmd-2', event: 'env_critical' }));
    live.onCommandStatus(cmd({ status: 'failed', attempts: 3, reason: 'aucun accusé après 3 tentatives' }));
    expect(live.commands().map((c) => [c.id, c.status])).toEqual([['cmd-2', 'sent'], ['cmd-1', 'failed']]);
    expect(live.commands()[1].reason).toContain('aucun accusé');
  });

  it('compte les événements perdus signalés', () => {
    const live = setup();
    live.onSeqGap({ node: 'esp01', from: 147, to: 148, missing: 2 });
    live.onSeqGap({ node: 'esp01', from: 200, to: 200, missing: 1 });
    expect(live.missingEvents()).toBe(3);
    expect(live.seqGaps()[0].from).toBe(200);
  });
});
