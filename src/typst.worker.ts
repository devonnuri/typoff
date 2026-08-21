/// <reference lib="webworker" />
import {
  MemoryAccessModel,
  $typst,
} from '@myriaddreamin/typst.ts'
import { TypstSnippet } from '@myriaddreamin/typst.ts/contrib/snippet'
import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'
import {
  compileTypstWorkspace,
  createSerialExecutor,
  type TypstCompileRuntime,
} from './typstCompile'
import type { RenderOptions } from './typst'
import type { TypstWorkspace } from './typstWorkspace'
import { OFFLINE_FONT_URLS } from './offlineAssets'
import { OfflinePackageRegistry } from './offlinePackageRegistry'

type RenderRequest = {
  id: number
  type: 'render'
  workspace: TypstWorkspace
  options: RenderOptions
}

const workerScope = self as DedicatedWorkerGlobalScope
const accessModel = new MemoryAccessModel()
const encoder = new TextEncoder()
const executeSerially = createSerialExecutor()

$typst.setCompilerInitOptions({ getModule: () => compilerWasmUrl })
$typst.setRendererInitOptions({ getModule: () => rendererWasmUrl })
$typst.use(
  TypstSnippet.disableDefaultFontAssets(),
  TypstSnippet.preloadFonts(OFFLINE_FONT_URLS),
  TypstSnippet.withAccessModel(accessModel),
  TypstSnippet.withPackageRegistry(new OfflinePackageRegistry()),
)

async function renderWorkspace(request: RenderRequest) {
  const compiler = await $typst.getCompiler()
  const renderer = await $typst.getRenderer()
  if (!compiler || !renderer) {
    throw new Error('Typst compiler or renderer is unavailable')
  }

  const runtime: TypstCompileRuntime = {
    async resetShadow() {
      accessModel.reset()
      await compiler.reset()
    },
    addSource(path, content) {
      accessModel.insertFile(path, encoder.encode(content), new Date())
    },
    compile(options) {
      return compiler.compile(options)
    },
    renderVector(vector, options) {
      return renderer.runWithSession(async (session) => {
        renderer.manipulateData({
          renderSession: session,
          action: 'reset',
          data: vector,
        })
        return renderer.renderSvgDiff({
          renderSession: session,
          ...options,
        })
      })
    },
  }

  return compileTypstWorkspace(runtime, request.workspace, request.options)
}

workerScope.onmessage = (event: MessageEvent<RenderRequest>) => {
  const request = event.data
  if (!request || request.type !== 'render') {
    return
  }

  void executeSerially(async () => {
    try {
      const result = await renderWorkspace(request)
      workerScope.postMessage({ id: request.id, type: 'result', ...result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      workerScope.postMessage({ id: request.id, type: 'error', message })
    }
  })
}
