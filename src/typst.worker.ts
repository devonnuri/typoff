import { $typst, MemoryAccessModel } from '@myriaddreamin/typst.ts'
import { TypstSnippet } from '@myriaddreamin/typst.ts/contrib/snippet'
import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'
import { OFFLINE_FONT_URLS } from './offlineAssets'
import { OfflinePackageRegistry } from './offlinePackageRegistry'

type Rect = {
  lo: { x: number; y: number }
  hi: { x: number; y: number }
}

type RenderOptions = {
  window?: Rect
}

type RenderRequest = {
  id: number
  type: 'render'
  source: string
  options: RenderOptions
}

type RenderResponse =
  | { id: number; type: 'result'; svg: string }
  | { id: number; type: 'error'; message: string }

const accessModel = new MemoryAccessModel()
$typst.use(
  TypstSnippet.disableDefaultFontAssets(),
  TypstSnippet.preloadFonts(OFFLINE_FONT_URLS),
  TypstSnippet.withAccessModel(accessModel),
  TypstSnippet.withPackageRegistry(new OfflinePackageRegistry()),
)

$typst.setCompilerInitOptions({
  getModule: () => compilerWasmUrl,
})

$typst.setRendererInitOptions({
  getModule: () => rendererWasmUrl,
})

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const request = event.data
  if (request.type !== 'render') {
    return
  }

  try {
    const svg = await $typst.svg({
      mainContent: request.source,
      ...request.options,
    })
    const response: RenderResponse = {
      id: request.id,
      type: 'result',
      svg,
    }
    self.postMessage(response)
  } catch (error) {
    const message =
      error instanceof Error
        ? [error.message, error.stack].filter(Boolean).join('\n')
        : String(error)
    const response: RenderResponse = {
      id: request.id,
      type: 'error',
      message: message || 'Typst render failed',
    }
    self.postMessage(response)
  }
}

export {}
