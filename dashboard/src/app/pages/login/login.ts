import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

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
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  error = signal(false);

  submit() {
    if (this.form.invalid) return;
    const { email, password } = this.form.getRawValue();
    this.auth.login(email, password).subscribe((ok) => {
      this.error.set(!ok);
      if (ok) this.router.navigate(['/']);
    });
  }
}
