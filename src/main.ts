import { provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideMaplibreWorker } from '@maplibre/ngx-maplibre-gl/config';
import { AppComponent } from './app/app/app.component';
import { routes } from './app/app.routes';

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection(),
    provideRouter(routes, withHashLocation()),
    provideServiceWorker('ngsw-worker.js', { enabled: true }),
    provideMaplibreWorker('maplibre-gl-worker.mjs'),
  ],
}).catch((error: unknown) => console.error(error));
