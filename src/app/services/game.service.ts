import { Injectable } from '@angular/core';

export type CaptureResult = { kind: 'next' | 'hint' | 'past'; number: number; nextNumber: number };

export function visibleNumberLimit(currentNumber: number, friendProgresses: number[]): number {
  const highestProgress = Math.max(0, currentNumber, ...friendProgresses);
  return highestProgress + 5;
}

export function classifyCapture(currentNumber: number, number: number): CaptureResult {
  if (number <= currentNumber) return { kind: 'past', number, nextNumber: currentNumber + 1 };
  if (number === currentNumber + 1) return { kind: 'next', number, nextNumber: number + 1 };
  return { kind: 'hint', number, nextNumber: currentNumber + 1 };
}

@Injectable({ providedIn: 'root' })
export class GameService {
  classify(currentNumber: number, number: number): CaptureResult {
    return classifyCapture(currentNumber, number);
  }
}
