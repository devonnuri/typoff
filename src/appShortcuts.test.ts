import { describe, expect, it } from 'vitest'
import {
  mapShortcutToAction,
  type AppShortcutEvent,
} from './appShortcuts'

const withCtrl = (key: string): AppShortcutEvent => ({
  key,
  ctrlKey: true,
  metaKey: false,
})

const withMeta = (key: string): AppShortcutEvent => ({
  key,
  ctrlKey: false,
  metaKey: true,
})

const plain = (key: string): AppShortcutEvent => ({
  key,
  ctrlKey: false,
  metaKey: false,
})

describe('mapShortcutToAction', () => {
  it('maps Ctrl+S and Cmd+S to render', () => {
    expect(mapShortcutToAction(withCtrl('s'))).toBe('render')
    expect(mapShortcutToAction(withMeta('s'))).toBe('render')
    expect(mapShortcutToAction(withCtrl('S'))).toBe('render')
  })

  it('maps Ctrl+N and Cmd+N to new-file', () => {
    expect(mapShortcutToAction(withCtrl('n'))).toBe('new-file')
    expect(mapShortcutToAction(withMeta('n'))).toBe('new-file')
    expect(mapShortcutToAction(withMeta('N'))).toBe('new-file')
  })

  it('no longer maps Cmd+B: it is reserved for editor bold', () => {
    expect(mapShortcutToAction(withCtrl('b'))).toBeNull()
    expect(mapShortcutToAction(withMeta('b'))).toBeNull()
    expect(mapShortcutToAction(withCtrl('B'))).toBeNull()
  })

  it('maps Ctrl+= / Ctrl++ and Cmd equivalents to zoom-in', () => {
    expect(mapShortcutToAction(withCtrl('='))).toBe('zoom-in')
    expect(mapShortcutToAction(withCtrl('+'))).toBe('zoom-in')
    expect(mapShortcutToAction(withMeta('='))).toBe('zoom-in')
    expect(mapShortcutToAction(withMeta('+'))).toBe('zoom-in')
  })

  it('maps Ctrl+- and Cmd+- to zoom-out', () => {
    expect(mapShortcutToAction(withCtrl('-'))).toBe('zoom-out')
    expect(mapShortcutToAction(withMeta('-'))).toBe('zoom-out')
  })

  it('maps Ctrl+0 and Cmd+0 to reset-zoom', () => {
    expect(mapShortcutToAction(withCtrl('0'))).toBe('reset-zoom')
    expect(mapShortcutToAction(withMeta('0'))).toBe('reset-zoom')
  })

  it('returns null for non-matching keys even with a modifier', () => {
    expect(mapShortcutToAction(withCtrl('x'))).toBeNull()
    expect(mapShortcutToAction(withCtrl('1'))).toBeNull()
    expect(mapShortcutToAction(withMeta('Escape'))).toBeNull()
    expect(mapShortcutToAction(withCtrl('ArrowUp'))).toBeNull()
  })

  it('returns null when no modifier is held', () => {
    expect(mapShortcutToAction(plain('s'))).toBeNull()
    expect(mapShortcutToAction(plain('n'))).toBeNull()
    expect(mapShortcutToAction(plain('b'))).toBeNull()
    expect(mapShortcutToAction(plain('='))).toBeNull()
    expect(mapShortcutToAction(plain('0'))).toBeNull()
  })
})
