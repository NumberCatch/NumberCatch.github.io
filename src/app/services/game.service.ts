import { Injectable } from '@angular/core';

export type CaptureResult = { kind: 'next' | 'hint' | 'done'; number: number; nextNumber: number };

export function visibleNumberLimit(currentNumber: number, friendProgresses: number[]): number {
  const highestProgress = Math.max(0, currentNumber, ...friendProgresses);
  return highestProgress + 20;
}

export function classifyCapture(currentNumber: number, number: number): CaptureResult {
  if (number <= currentNumber) return { kind: 'done', number, nextNumber: currentNumber + 1 };
  if (number === currentNumber + 1) return { kind: 'next', number, nextNumber: number + 1 };
  return { kind: 'hint', number, nextNumber: currentNumber + 1 };
}

@Injectable({ providedIn: 'root' })
export class GameService {
  classify(currentNumber: number, number: number): CaptureResult {
    return classifyCapture(currentNumber, number);
  }
}
