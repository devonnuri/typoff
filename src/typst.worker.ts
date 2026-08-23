/// <reference lib="webworker" />
import { MemoryAccessModel, $typst } from '@myriaddreamin/typst.ts'
import { TypstSnippet } from '@myriaddreamin/typst.ts/contrib/snippet'
import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'
import {
  compileTypstWorkspace,
  createSerialExecutor,
  locateTypstCursorPage,
  type TypstCompileRuntime,
  type TypstQueryRuntime,
} from './typstCompile'
import type { TypstWorkerRequest } from './typst'
import {
  createDocumentRequestGate,
  isolateSvgPage,
  normalizePageOffsets,
  stripSvgForeignObjects,
  type TypstPageInfo,
} from './virtualPreview'
import { OFFLINE_FONT_URLS } from './offlineAssets'
import { OfflinePackageRegistry } from './offlinePackageRegistry'

const workerScope = self as DedicatedWorkerGlobalScope
const accessModel = new MemoryAccessModel()
const encoder = new TextEncoder()
const executeSerially = createSerialExecutor()
const requestGate = createDocumentRequestGate()
let nextDocumentId = 1
let currentDocument:
  | { id: string; artifact: Uint8Array; pages: TypstPageInfo[] }
  | undefined

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
        const rendererPages = await renderer.runWithSession(async (session) => {
          await renderer.manipulateData({
            renderSession: session,
            action: 'reset',
            data: artifact,
          })
          return renderer.retrievePagesInfoFromSession(session)
        })
        const pages = normalizePageOffsets(rendererPages)
        if (!requestGate.isCurrent(requestEpoch)) {
          throw new Error('Typst preview request was superseded')
        }
        const documentId = `doc-${nextDocumentId++}`
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

      if (!currentDocument || currentDocument.id !== request.documentId) {
        throw new Error('The requested Typst document is no longer available')
      }
      const document = currentDocument
      const page = document.pages[request.pageIndex]
      if (!page) {
        throw new Error(`Typst page ${request.pageIndex + 1} does not exist`)
      }
      const svg = await renderer.runWithSession(async (session) => {
        await renderer.manipulateData({
          renderSession: session,
          action: 'reset',
          data: document.artifact,
        })
        const rendered = renderer.renderSvgDiff({
          renderSession: session,
          window: {
            lo: { x: 0, y: page.pageOffset },
            hi: {
              x: page.width,
              y: page.pageOffset + page.height - 0.001,
            },
          },
        })
          const sanitized = stripSvgForeignObjects(rendered)
          return isolateSvgPage(sanitized, request.pageIndex, page)
      })
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      workerScope.postMessage({ id: request.id, type: 'error', message })
    }
  })
}
