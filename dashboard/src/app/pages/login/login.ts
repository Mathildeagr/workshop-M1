import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, type LoginResult } from '../../services/auth.service';

const ERRORS: Record<Exclude<LoginResult, 'ok'>, string> = {
  invalid: "Nom d'utilisateur ou mot de passe incorrect",
  rate_limited: 'Trop de tentatives, réessayez dans quelques minutes',
  unavailable: 'Serveur indisponible : vérifiez que l’API et la base de données sont démarrées',
};

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);

  form = inject(FormBuilder).nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });
  error = signal<string | null>(null);
  loading = signal(false);

  submit() {
    if (this.form.invalid || this.loading()) return;
    const { username, password } = this.form.getRawValue();
    this.loading.set(true);
    this.auth.login(username, password).subscribe((result) => {
      this.loading.set(false);
      this.error.set(result === 'ok' ? null : ERRORS[result]);
      if (result === 'ok') this.router.navigate(['/']);
    });
  }
}
