export type RenderVersionGate = {
  begin(): number
  invalidate(): void
  isCurrent(version: number): boolean
}

export function invalidateRenderSynchronously(
  gate: RenderVersionGate,
  settlePreview: () => void,
) {
  gate.invalidate()
  settlePreview()
}

export type RenderTransitionOptions = {
  gate: RenderVersionGate
  source: string
  latestSource: { current: string }
  pending: { current: boolean }
  timer: { current: number | null }
  clearTimer(id: number): void
  settlePreview(): void
}

export function synchronizeRenderTransition({
  gate,
  source,
  latestSource,
  pending,
  timer,
  clearTimer,
  settlePreview,
}: RenderTransitionOptions) {
  latestSource.current = source
  pending.current = false
  if (timer.current !== null) {
    clearTimer(timer.current)
    timer.current = null
  }
  invalidateRenderSynchronously(gate, settlePreview)
}

export function createRenderVersionGate(): RenderVersionGate {
  let currentVersion = 0

  return {
    begin() {
      currentVersion += 1
      return currentVersion
    },
    invalidate() {
      currentVersion += 1
    },
    isCurrent(version: number) {
      return version === currentVersion
    },
  }
}
