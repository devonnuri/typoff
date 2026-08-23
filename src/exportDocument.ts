import { exportTypstPages, type TypstExportedPage } from './typst'

export type ExportedSvgPage = TypstExportedPage

const triggerAnchorDownload = (
  name: string,
  content: string,
  mime: string,
): void => {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Bundles every page into one dependency-free HTML "archive": the SVGs are
 * stacked vertically with page separators so the whole document can be viewed
 * (and each page extracted) from a single file.
 */
export function buildSvgPagesHtml(
  pages: ReadonlyArray<ExportedSvgPage>,
  baseName: string,
): string {
  const ordered = [...pages].sort((a, b) => a.pageIndex - b.pageIndex)
  const sections = ordered
    .map(
      ({ pageIndex, svg }) =>
        `<section class="typoff-page" data-page="${pageIndex + 1}">\n${svg}\n</section>`,
    )
    .join('\n<hr class="typoff-page-separator" />\n')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${baseName}</title>
<style>
  body { margin: 0; background: #f8f4ec; }
  .typoff-page { display: block; margin: 2rem auto; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2); width: fit-content; }
  .typoff-page-separator { border: none; border-top: 1px dashed #999; margin: 0 auto; width: min(60rem, 90%); }
</style>
</head>
<body>
${sections}
</body>
</html>
`
}

/**
 * Downloads the rendered pages: a single `.svg` for one-page documents or a
 * self-contained `.html` archive stacking all pages for multi-page documents.
 * Throws when there is nothing to download.
 */
export function downloadSvgPages(
  pages: ReadonlyArray<ExportedSvgPage>,
  baseName: string,
): void {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('No rendered pages to export')
  }
  const sorted = [...pages].sort((a, b) => a.pageIndex - b.pageIndex)
  if (sorted.length === 1) {
    triggerAnchorDownload(`${baseName}.svg`, sorted[0].svg, 'image/svg+xml')
    return
  }
  triggerAnchorDownload(
    `${baseName}.html`,
    buildSvgPagesHtml(sorted, baseName),
    'text/html',
  )
}

/**
 * Renders every page of the compiled `documentId` through the worker and
 * triggers the download. The Export-menu button wiring in App.tsx will call
 * this once the concurrent App.tsx work lands.
 */
export async function exportCurrentDocument(
  documentId: string,
  baseName: string,
): Promise<void> {
  const pages = await exportTypstPages(documentId)
  downloadSvgPages(pages, baseName)
}
