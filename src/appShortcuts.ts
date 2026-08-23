// Global app keyboard shortcuts. Pure mapping logic so it can be tested
// without a DOM; App.tsx owns the window listener and dispatches actions.
export type AppShortcutAction =
  | 'render'
  | 'new-file'
  | 'toggle-sidebar'
  | 'zoom-in'
  | 'zoom-out'
  | 'reset-zoom'

export interface AppShortcutEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
}

const SHORTCUT_KEYS: Record<string, AppShortcutAction> = {
  s: 'render',
  n: 'new-file',
  b: 'toggle-sidebar',
  '=': 'zoom-in',
  '+': 'zoom-in',
  '-': 'zoom-out',
  '0': 'reset-zoom',
}

export function mapShortcutToAction(
  event: AppShortcutEvent,
): AppShortcutAction | null {
  if (!event.ctrlKey && !event.metaKey) {
    return null
  }
  return SHORTCUT_KEYS[event.key.toLowerCase()] ?? null
}
