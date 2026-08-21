export type PreviewPolicy = {
  auto: boolean
  delayMs: number
}

const MEDIUM_FILE_LENGTH = 15_000
const LONG_FILE_LENGTH = 20_000

export function getPreviewPolicy(sourceLength: number): PreviewPolicy {
  if (sourceLength > LONG_FILE_LENGTH) {
    return { auto: false, delayMs: 0 }
  }

  if (sourceLength > MEDIUM_FILE_LENGTH) {
    return { auto: true, delayMs: 1_200 }
  }

  return { auto: true, delayMs: 400 }
}
