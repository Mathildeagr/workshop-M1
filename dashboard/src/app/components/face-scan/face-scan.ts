import { Component, ElementRef, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { ApiService } from '../../services/api.service';

type Status = 'idle' | 'sending' | 'sent' | 'send-error' | 'camera-error';

/** Capture le visage de l'utilisateur via la caméra du navigateur puis l'envoie au backend. */
@Component({
  selector: 'app-face-scan',
  templateUrl: './face-scan.html',
  styleUrl: './face-scan.css',
})
export class FaceScan implements OnDestroy {
  private api = inject(ApiService);
  private video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private canvas = document.createElement('canvas');
  private stream?: MediaStream;

  cameraOn = signal(false);
  photo = signal<string | null>(null);
  status = signal<Status>('idle');

  async start() {
    this.photo.set(null);
    this.status.set('idle');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      this.video().nativeElement.srcObject = this.stream;
      this.cameraOn.set(true);
    } catch {
      this.status.set('camera-error');
    }
  }

  capture() {
    const video = this.video().nativeElement;
    this.canvas.width = video.videoWidth;
    this.canvas.height = video.videoHeight;
    this.canvas.getContext('2d')?.drawImage(video, 0, 0);
    this.photo.set(this.canvas.toDataURL('image/jpeg', 0.9));
    this.stop();
  }

  send() {
    this.status.set('sending');
    this.canvas.toBlob(
      (blob) => {
        if (!blob) return this.status.set('send-error');
        this.api.sendFace(blob).subscribe((ok) => this.status.set(ok ? 'sent' : 'send-error'));
      },
      'image/jpeg',
      0.9,
    );
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.cameraOn.set(false);
  }

  ngOnDestroy() {
    this.stop();
  }
}
