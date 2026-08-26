import { describe, expect, it } from 'vitest'
import { shouldAutoCloseMath } from './mathAutoclose'

describe('math delimiter auto-close', () => {
  it('closes an opening dollar in markup', () => {
    expect(shouldAutoCloseMath({ before: 'x = ', after: '\nnext' })).toBe(true)
  })

  it('does not close when already inside math (odd count before)', () => {
    expect(shouldAutoCloseMath({ before: '$x + ', after: 'y$' })).toBe(false)
  })

  it('does not insert when the next char is a word character', () => {
    expect(shouldAutoCloseMath({ before: 'cost: 5', after: 'dollars' })).toBe(
      false,
    )
  })

  it('does not double-close when the next char is already $', () => {
    expect(shouldAutoCloseMath({ before: 'a ', after: '$' })).toBe(false)
  })
})
