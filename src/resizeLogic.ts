export const MIN_SIDEBAR_WIDTH = 180
export const MIN_PANE_WIDTH = 320
export const KEYBOARD_RESIZE_DELTA = 16

export type ResizeArrowKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'

export interface ResizeBounds {
  min: number
  max: number
}

const GROW_KEYS: ReadonlySet<string> = new Set(['ArrowRight', 'ArrowDown'])

export function isResizeArrowKey(key: string): key is ResizeArrowKey {
  return (
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown'
  )
}

/**
 * Apply a keyboard resize step to the current pane width.
 *
 * ArrowRight/ArrowDown grow the pane, ArrowLeft/ArrowUp shrink it. The result
 * is clamped to [bounds.min, bounds.max] so keyboard resizing obeys exactly
 * the same limits as mouse dragging.
 */
export function applyKeyboardResize(
  currentWidth: number,
  key: ResizeArrowKey,
  bounds: ResizeBounds,
  delta: number = KEYBOARD_RESIZE_DELTA,
): number {
  if (!Number.isFinite(currentWidth)) {
    return Math.min(Math.max(bounds.min, bounds.min), bounds.max)
  }

  const step = GROW_KEYS.has(key) ? delta : -delta
  return Math.min(Math.max(currentWidth + step, bounds.min), bounds.max)
}
