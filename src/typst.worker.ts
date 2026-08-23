/// <reference lib="webworker" />
import { MemoryAccessModel, $typst } from '@myriaddreamin/typst.ts'
import { TypstSnippet } from '@myriaddreamin/typst.ts/contrib/snippet'
import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'
import {
  collectSourceJumpPoints,
  compileTypstWorkspace,
  createSerialExecutor,
  locateTypstCursorPage,
  type TypstCompileRuntime,
  type TypstQueryRuntime,
} from './typstCompile'
import type { TypstWorkerRequest } from './typst'
import {
  createDocumentRequestGate,
  normalizePageOffsets,
  type TypstPageInfo,
} from './virtualPreview'
import { OFFLINE_FONT_URLS } from './offlineAssets'
import { OfflinePackageRegistry } from './offlinePackageRegistry'
import { RenderSessionCache, renderDocumentPage, type TypstRendererLike } from './renderSessionCache'

const workerScope = self as DedicatedWorkerGlobalScope
const accessModel = new MemoryAccessModel()
const encoder = new TextEncoder()
const executeSerially = createSerialExecutor()
const requestGate = createDocumentRequestGate()
let nextDocumentId = 1
let currentDocument:
  | { id: string; artifact: Uint8Array; pages: TypstPageInfo[] }
  | undefined
const renderSessionCache = new RenderSessionCache()

$typst.setCompilerInitOptions({ getModule: () => compilerWasmUrl })
$typst.setRendererInitOptions({ getModule: () => rendererWasmUrl })
$typst.use(
  TypstSnippet.disableDefaultFontAssets(),
  TypstSnippet.preloadFonts(OFFLINE_FONT_URLS),
  TypstSnippet.withAccessModel(accessModel),
  TypstSnippet.withPackageRegistry(new OfflinePackageRegistry()),
)

async function getRuntime() {
  const compiler = await $typst.getCompiler()
  const renderer = await $typst.getRenderer()
  if (!compiler || !renderer) {
    throw new Error('Typst compiler or renderer is unavailable')
  }

  const runtime: TypstCompileRuntime & TypstQueryRuntime = {
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
    query(options) {
      const { mainFilePath, root, selector, field } = options
      return compiler.runWithWorld({ mainFilePath, root }, async (world) => {
        const compiled = await world.compile({ diagnostics: 'full' })
        if (compiled.hasError) {
          throw new Error('Typst could not compile the cursor position marker')
        }
        return world.query({ selector, field })
      })
    },
  }
  return { runtime, renderer }
}

workerScope.onmessage = (event: MessageEvent<TypstWorkerRequest>) => {
  const request = event.data
  if (!request) {
    return
  }
  const requestEpoch =
    request.type === 'compile'
      ? requestGate.startCompile()
      : requestGate.capture()
  void executeSerially(async () => {
    try {
      if (!requestGate.isCurrent(requestEpoch)) {
        throw new Error('Typst preview request was superseded')
      }
      const { runtime, renderer } = await getRuntime()
      // The runtime driver exposes `createModule` but the shipped TypstRenderer
      // type omits it, so view the renderer through our minimal seam instead.
      const sessionRenderer = renderer as unknown as TypstRendererLike
      if (request.type === 'compile') {
        const result = await compileTypstWorkspace(runtime, request.workspace)
        if (!requestGate.isCurrent(requestEpoch)) {
          throw new Error('Typst preview request was superseded')
        }
        if (!result.artifact) {
          workerScope.postMessage({
            id: request.id,
            type: 'compile-result',
            documentId: null,
            pages: [],
            diagnostics: result.diagnostics,
          })
          return
        }

        const artifact = result.artifact
        const documentId = `doc-${nextDocumentId++}`
        const session = await renderSessionCache.acquire(sessionRenderer, documentId, artifact)
        const pages = normalizePageOffsets(renderer.retrievePagesInfoFromSession(session))
        if (!requestGate.isCurrent(requestEpoch)) {
          throw new Error('Typst preview request was superseded')
        }
        currentDocument = { id: documentId, artifact, pages }
        workerScope.postMessage({
          id: request.id,
          type: 'compile-result',
          documentId,
          pages,
          diagnostics: result.diagnostics,
        })
        return
      }

      if (request.type === 'locate-cursor') {
        const pageIndex = await locateTypstCursorPage(
          runtime,
          request.workspace,
          request.offset,
          `typoff-cursor-${request.id}`,
        )
        if (!requestGate.isCurrent(requestEpoch)) {
          throw new Error('Typst cursor request was superseded')
        }
        workerScope.postMessage({
          id: request.id,
          type: 'cursor-result',
          pageIndex,
        })
        return
      }

      if (request.type === 'locate-source') {
        const points = await collectSourceJumpPoints(runtime, request.workspace)
        const candidates = points.filter(
          (point) => point.page === request.pageIndex + 1,
        )
        if (candidates.length === 0) {
          throw new Error('The clicked area has no mappable source position')
        }
        // Points are sorted ascending by (page, y): keep the last line whose
        // y is within the 6pt tolerance above the click, else the first line.
        let chosen = candidates[0]
        for (const point of candidates) {
          if (point.y <= request.yPt + 6) {
            chosen = point
          }
        }
        if (!requestGate.isCurrent(requestEpoch)) {
          throw new Error('Typst source jump request was superseded')
        }
        workerScope.postMessage({
          id: request.id,
          type: 'source-result',
          offset: chosen.offset,
        })
        return
      }

      if (request.type === 'export-svg-pages') {
        if (!currentDocument || currentDocument.id !== request.documentId) {
          throw new Error('The requested Typst document is no longer available')
        }
        const document = currentDocument
        const pages: Array<{ pageIndex: number; svg: string }> = []
        // Render sequentially so every page reuses the same warm session slot
        // without concurrent resets racing each other.
        for (let pageIndex = 0; pageIndex < document.pages.length; pageIndex++) {
          const svg = await renderDocumentPage(
            sessionRenderer,
            renderSessionCache,
            request.documentId,
            document.artifact,
            pageIndex,
            document.pages[pageIndex],
          )
          pages.push({ pageIndex, svg })
        }
        if (!requestGate.isCurrent(requestEpoch)) {
          throw new Error('Typst preview request was superseded')
        }
        workerScope.postMessage({
          id: request.id,
          type: 'export-result',
          documentId: request.documentId,
          pages,
        })
        return
      }

      if (request.type === 'render-page') {
        if (!currentDocument || currentDocument.id !== request.documentId) {
          throw new Error('The requested Typst document is no longer available')
        }
        const document = currentDocument
        const page = document.pages[request.pageIndex]
        if (!page) {
          throw new Error(`Typst page ${request.pageIndex + 1} does not exist`)
        }
        const svg = await renderDocumentPage(
          sessionRenderer,
          renderSessionCache,
          request.documentId,
          document.artifact,
          request.pageIndex,
          page,
        )
        if (!requestGate.isCurrent(requestEpoch)) {
          throw new Error('Typst preview request was superseded')
        }
        workerScope.postMessage({
          id: request.id,
          type: 'page-result',
          documentId: request.documentId,
          pageIndex: request.pageIndex,
          svg,
        })
        return
      }

      // All known request types are handled above; this is a safety net.
      throw new Error(`Unknown Typst worker request type`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      workerScope.postMessage({ id: request.id, type: 'error', message })
    }
  })
}
