import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ApiService,
  FACE_NAME_PATTERN,
  type ActionResult,
  type Face,
  type FaceStatus,
} from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

/** Personnes connues du service vision : consultation (admin, superviseur), enrôlement et modifications (admin). */
@Component({
  selector: 'app-faces-manager',
  imports: [ReactiveFormsModule],
  templateUrl: './faces-manager.html',
  styleUrl: './faces-manager.css',
})
export class FacesManager {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  canEdit = computed(() => this.auth.user()?.role === 'admin');
  faces = signal<Face[]>([]);
  capturing = signal(false);
  message = signal<{ ok: boolean; text: string } | null>(null);

  form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.pattern(FACE_NAME_PATTERN)]],
    status: ['autorise' as FaceStatus],
    samples: [10, [Validators.required, Validators.min(1), Validators.max(30)]],
  });

  constructor() {
    this.reload();
  }

  reload() {
    this.api.getFaces().subscribe((faces) => this.faces.set(faces));
  }

  /** Enrôlement par la caméra Sentinel : la vision est en pause pendant la capture. */
  capture() {
    if (this.form.invalid || this.capturing()) return;
    const { name, status, samples } = this.form.getRawValue();
    this.capturing.set(true);
    this.message.set(null);
    this.api.captureFace(name, status, samples).subscribe((result) => {
      this.capturing.set(false);
      this.done(result, `${name} enregistré(e)`);
    });
  }

  setStatus(face: Face, status: FaceStatus) {
    this.api.setFaceStatus(face.name, status).subscribe((result) => this.done(result, `${face.name} : ${status}`));
  }

  remove(face: Face) {
    if (!confirm(`Supprimer ${face.name} de la base de visages ?`)) return;
    this.api.deleteFace(face.name).subscribe((result) => this.done(result, `${face.name} supprimé(e)`));
  }

  private done(result: ActionResult, success: string) {
    this.message.set({ ok: result.ok, text: result.ok ? success : (result.error ?? 'Erreur') });
    this.reload();
  }
}
