import { describe, expect, it } from 'vitest'
import { OFFLINE_FONT_URLS } from './offlineAssets'
import { OfflinePackageRegistry } from './offlinePackageRegistry'

describe('offline Typst runtime', () => {
  it('loads every bundled font from the app origin', () => {
    expect(OFFLINE_FONT_URLS.length).toBeGreaterThan(0)
    for (const url of OFFLINE_FONT_URLS) {
      expect(url).not.toMatch(/^https?:\/\//)
    }
  })

  it('never falls back to the online Typst package registry', () => {
    const registry = new OfflinePackageRegistry()
    expect(
      registry.resolve(
        { namespace: 'preview', name: 'example', version: '1.0.0' },
        { untar: () => undefined },
      ),
    ).toBeUndefined()
  })
})
