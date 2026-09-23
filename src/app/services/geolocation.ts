import { Injectable, signal } from '@angular/core';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface LocationCoordinates extends Coordinates {
  accuracy: number;
}

export interface LocationPosition {
  coords: LocationCoordinates;
}

export function distanceInMeters(from: Coordinates, to: Coordinates): number {
  const earthRadiusMeters = 6371000;
  const fromLatitude = (from.latitude * Math.PI) / 180;
  const toLatitude = (to.latitude * Math.PI) / 180;
  const latitudeDelta = ((from.latitude - to.latitude) * Math.PI) / 180;
  const longitudeDelta = ((from.longitude - to.longitude) * Math.PI) / 180;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  readonly position = signal<LocationPosition | null>(null);
  private watchId: number | null = null;
  private firstPosition: Promise<LocationPosition | null> | null = null;

  activate(initialPosition?: LocationPosition): Promise<LocationPosition | null> {
    if (initialPosition) this.position.set(initialPosition);
    if (this.watchId === null && navigator.geolocation) {
      this.firstPosition = new Promise((resolve) => {
        let pending = true;
        const complete = (position: LocationPosition | null): void => {
          if (!pending) return;
          pending = false;
          resolve(position);
        };
        this.watchId = navigator.geolocation.watchPosition(
          (position) => {
            this.position.set(position);
            complete(position);
          },
          () => complete(null),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
        );
      });
    }
    return this.position()
      ? Promise.resolve(this.position())
      : (this.firstPosition ?? Promise.resolve(null));
  }
}
