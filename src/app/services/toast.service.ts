import { Injectable, inject } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly snackBar = inject(MatSnackBar);

  error(message: string): void {
    this.open(message, 'error-toast', 5000);
  }

  success(message: string): void {
    this.open(message, 'success-toast', 3000);
  }

  info(message: string): void {
    this.open(message, 'info-toast', 3000);
  }

  private open(message: string, panelClass: string, duration: number): void {
    const config: MatSnackBarConfig = {
      duration,
      horizontalPosition: 'center',
      verticalPosition: 'top',
      panelClass: [panelClass],
    };
    this.snackBar.open(message, 'Schließen', config);
  }
}
