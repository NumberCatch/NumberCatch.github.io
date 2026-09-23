import { TestBed } from '@angular/core/testing';
import { GeolocationService } from './geolocation';

describe('GeolocationService', () => {
  let service: GeolocationService;
  let success: PositionCallback;

  beforeEach(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: vi.fn((callback: PositionCallback) => {
          success = callback;
          return 7;
        }),
      },
    });
    TestBed.configureTestingModule({});
    service = TestBed.inject(GeolocationService);
  });

  it('does not request GPS before activation', () => {
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
    expect(service.position()).toBeNull();
  });

  it('starts one persistent watcher and shares its latest position', async () => {
    const first = service.activate();
    const second = service.activate();
    const position = createPosition(50, 8);
    success(position);

    await expect(first).resolves.toBe(position);
    await expect(second).resolves.toBe(position);
    expect(service.position()).toBe(position);
    expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1);
  });

  it('accepts a position supplied by the map while starting the watcher', async () => {
    const position = createPosition(51, 9);

    await expect(service.activate(position)).resolves.toBe(position);
    expect(service.position()).toBe(position);
    expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1);
  });
});

function createPosition(latitude: number, longitude: number): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy: 10,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: 1,
    toJSON: () => ({}),
  };
}
