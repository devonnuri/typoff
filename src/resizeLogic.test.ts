import { describe, expect, it } from 'vitest'
import {
  KEYBOARD_RESIZE_DELTA,
  MIN_PANE_WIDTH,
  MIN_SIDEBAR_WIDTH,
  applyKeyboardResize,
} from './resizeLogic'

describe('applyKeyboardResize', () => {
  const bounds = { min: 180, max: 600 }

  it('grows the width on ArrowRight by the default delta', () => {
    expect(applyKeyboardResize(240, 'ArrowRight', bounds)).toBe(
      240 + KEYBOARD_RESIZE_DELTA,
    )
  })

  it('shrinks the width on ArrowLeft by the default delta', () => {
    expect(applyKeyboardResize(240, 'ArrowLeft', bounds)).toBe(
      240 - KEYBOARD_RESIZE_DELTA,
    )
  })

  it('treats ArrowDown like ArrowRight (grow)', () => {
    expect(applyKeyboardResize(240, 'ArrowDown', bounds)).toBe(
      240 + KEYBOARD_RESIZE_DELTA,
    )
  })

  it('treats ArrowUp like ArrowLeft (shrink)', () => {
    expect(applyKeyboardResize(240, 'ArrowUp', bounds)).toBe(
      240 - KEYBOARD_RESIZE_DELTA,
    )
  })

  it('supports a custom delta', () => {
    expect(applyKeyboardResize(240, 'ArrowRight', bounds, 48)).toBe(288)
    expect(applyKeyboardResize(240, 'ArrowLeft', bounds, 48)).toBe(192)
  })

  it('clamps to the minimum when shrinking past it', () => {
    expect(applyKeyboardResize(MIN_SIDEBAR_WIDTH - 10, 'ArrowLeft', bounds)).toBe(
      bounds.min,
    )
  })

  it('clamps to the maximum when growing past it', () => {
    expect(applyKeyboardResize(bounds.max + 10, 'ArrowRight', bounds)).toBe(
      bounds.max,
    )
  })

  it('never returns a value outside the given bounds', () => {
    const values = [
      0,
      100,
      bounds.min,
      400,
      bounds.max,
      10_000,
      Number.NaN,
    ].flatMap((current) =>
      (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const).map(
        (key) => applyKeyboardResize(current, key, bounds),
      ),
    )
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(bounds.min)
      expect(value).toBeLessThanOrEqual(bounds.max)
    }
  })

  it('exports the same clamp constants App.tsx uses for dragging', () => {
    expect(MIN_SIDEBAR_WIDTH).toBe(180)
    expect(MIN_PANE_WIDTH).toBe(320)
    expect(KEYBOARD_RESIZE_DELTA).toBe(16)
  })
})
