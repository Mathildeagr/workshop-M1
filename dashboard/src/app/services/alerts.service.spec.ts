import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AlertsService, SOCKET_FACTORY } from './alerts.service';
import { ApiService, type Alert } from './api.service';
import { AuthService } from './auth.service';

type Handler = (...args: unknown[]) => void;

/** Socket.io simulé : emit() déclenche les handlers enregistrés par le service. */
function fakeSocket() {
  const handlers = new Map<string, Handler>();
  const managerHandlers = new Map<string, Handler>();
  return {
    on: (event: string, h: Handler) => handlers.set(event, h),
    io: { on: (event: string, h: Handler) => managerHandlers.set(event, h) },
    disconnect: vi.fn(),
    emit: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args),
    emitManager: (event: string) => managerHandlers.get(event)?.(),
  };
}

function alert(id: number, extra: Partial<Alert> = {}): Alert {
  return { id, source: 'scan', type: 'mqtt_auth_failure', level: 'warning', acknowledged: false, createdAt: '', ...extra };
}

describe('AlertsService', () => {
  let socket: ReturnType<typeof fakeSocket>;
  let factory: ReturnType<typeof vi.fn>;
  let getAlerts: ReturnType<typeof vi.fn>;

  function setup(token: string | null = 'jwt') {
    socket = fakeSocket();
    factory = vi.fn(() => socket);
    getAlerts = vi.fn(() => of([alert(1)]));
    TestBed.configureTestingModule({
      providers: [
        { provide: SOCKET_FACTORY, useValue: factory },
        { provide: ApiService, useValue: { getAlerts } },
        { provide: AuthService, useValue: { token: () => token } },
      ],
    });
    return TestBed.inject(AlertsService);
  }

  it("charge l'historique et ouvre le socket avec le JWT", () => {
    const service = setup();
    service.connect();
    expect(factory).toHaveBeenCalledWith('jwt');
    expect(service.alerts().map((a) => a.id)).toEqual([1]);
  });

  it('ne se connecte pas sans session', () => {
    const service = setup(null);
    service.connect();
    expect(factory).not.toHaveBeenCalled();
  });

  it('ajoute les nouvelles alertes en tête, sans doublon', () => {
    const service = setup();
    service.connect();
    socket.emit('alert', alert(2));
    socket.emit('alert', alert(2));
    expect(service.alerts().map((a) => a.id)).toEqual([2, 1]);
  });

  it('met à jour une alerte acquittée sans la déplacer', () => {
    const service = setup();
    service.connect();
    socket.emit('alert', alert(2));
    socket.emit('alert_ack', alert(1, { acknowledged: true }));
    expect(service.alerts().map((a) => [a.id, a.acknowledged])).toEqual([[2, false], [1, true]]);
  });

  it("suit l'état de la connexion et recharge après une reconnexion", () => {
    const service = setup();
    service.connect();
    socket.emit('connect');
    expect(service.live()).toBe(true);
    socket.emit('disconnect');
    expect(service.live()).toBe(false);
    socket.emitManager('reconnect');
    expect(getAlerts).toHaveBeenCalledTimes(2);
  });

  it('ferme le socket à la déconnexion', () => {
    const service = setup();
    service.connect();
    service.disconnect();
    expect(socket.disconnect).toHaveBeenCalled();
  });
});
