import { classifyCapture, visibleNumberLimit } from './game.service';
describe('classifyCapture', () => {
  it('accepts the next number', () => expect(classifyCapture(37, 38).kind).toBe('next'));
  it('stores later numbers as hints', () => expect(classifyCapture(37, 52).kind).toBe('hint'));
  it('does not change progress for completed numbers', () =>
    expect(classifyCapture(37, 20).kind).toBe('done'));
  it('continues the sequence beyond 999', () => {
    expect(classifyCapture(999, 1000).kind).toBe('next');
    expect(classifyCapture(999, 10000).kind).toBe('hint');
    expect(classifyCapture(1000, 1000).kind).toBe('done');
  });
});

describe('visibleNumberLimit', () => {
  it('shows 20 numbers for a new game', () => expect(visibleNumberLimit(0, [])).toBe(20));
  it('uses the highest group progress plus 20 numbers', () =>
    expect(visibleNumberLimit(37, [12, 52, 41])).toBe(72));
  it('keeps showing the highest progress plus 20 beyond 999', () =>
    expect(visibleNumberLimit(1000, [1200])).toBe(1220));
});
