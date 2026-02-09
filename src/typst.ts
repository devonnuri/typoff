import { $typst } from '@myriaddreamin/typst.ts'

type Rect = {
  lo: { x: number; y: number }
  hi: { x: number; y: number }
}

type RenderOptions = {
  window?: Rect
}
import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'

$typst.setCompilerInitOptions({
  getModule: () => compilerWasmUrl,
})

$typst.setRendererInitOptions({
  getModule: () => rendererWasmUrl,
})

export async function renderTypstSvg(
  source: string,
  options: RenderOptions = {},
): Promise<string> {
  return $typst.svg({
    mainContent: source,
    ...options,
  })
}
