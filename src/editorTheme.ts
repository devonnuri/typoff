export const TYPOFF_DARK_PALETTE = {
  background: '#0a0a0a',
  foreground: '#f3f4f6',
  accent: '#5eead4',
  tokens: {
    keyword: '#67e8f9',
    string: '#fbbf24',
    number: '#fb923c',
    comment: '#94a3b8',
    operator: '#f472b6',
    atom: '#c4b5fd',
  },
} as const

function relativeLuminance(color: string): number {
  const channels = color
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    )

  if (!channels || channels.length !== 3) {
    throw new Error(`Expected a six-digit hex color, received ${color}`)
  }
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}
