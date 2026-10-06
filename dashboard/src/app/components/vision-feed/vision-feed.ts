import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap, timer } from 'rxjs';
import { REFRESH_MS } from '../../config';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

const RETRY_MS = 3000;

/** Flux vidéo annoté de la caméra Sentinel (service vision) et état de la détection. */
@Component({
  selector: 'app-vision-feed',
  templateUrl: './vision-feed.html',
  styleUrl: './vision-feed.css',
})
export class VisionFeed {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private retry?: ReturnType<typeof setTimeout>;

  status = toSignal(timer(0, REFRESH_MS).pipe(switchMap(() => this.api.getVisionStatus())), {
    initialValue: null,
  });
  // Flux visible quand la vision tourne, et pendant un enrôlement (aperçu de la capture)
  active = computed(() => !!this.status()?.enabled || !!this.status()?.enrolling);
  canControl = computed(() => ['admin', 'superviseur'].includes(this.auth.user()?.role ?? ''));

  streamUrl = signal<string | null>(null);
  busy = signal(false);
  error = signal<string | null>(null);

  constructor() {
    // Nouveau ticket à chaque (re)démarrage de la vision : il n'est valable que 60 s
    effect(() => {
      if (this.active()) this.loadStream();
      else this.streamUrl.set(null);
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.retry));
  }

  loadStream() {
    clearTimeout(this.retry);
    this.api.getStreamUrl().subscribe((url) => this.streamUrl.set(url));
  }

  /** Coupure du flux (service relancé, réseau) : on redemande un ticket un peu plus tard. */
  onStreamError() {
    this.streamUrl.set(null);
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.active() && this.loadStream(), RETRY_MS);
  }

  toggle() {
    const enable = !this.status()?.enabled;
    this.busy.set(true);
    this.error.set(null);
    this.api.setVision(enable).subscribe((result) => {
      this.busy.set(false);
      if (!result.ok) this.error.set(result.error ?? null);
    });
  }
}
