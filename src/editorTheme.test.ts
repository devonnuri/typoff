import { describe, expect, it } from 'vitest'
import { TYPOFF_DARK_PALETTE, contrastRatio } from './editorTheme'

describe('Typoff dark editor palette', () => {
  it('keeps every syntax role highly visible on the black editor background', () => {
    for (const [role, color] of Object.entries(TYPOFF_DARK_PALETTE.tokens)) {
      expect(contrastRatio(color, TYPOFF_DARK_PALETTE.background), role).toBeGreaterThanOrEqual(7)
    }
  })

  it('uses a bright, emphasized color for asterisks/operators', () => {
    expect(TYPOFF_DARK_PALETTE.tokens.operator).toBe('#f472b6')
  })
})
