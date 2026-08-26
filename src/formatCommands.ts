// Pure logic for typst.app-style formatting shortcuts (Cmd+B / Cmd+I):
// wrap the selection in Typst markup markers, or toggle them off when the
// selection is already wrapped. DOM-free so it can be tested directly.

export interface FormatMarker {
  open: string
  close: string
}

export const STRONG_MARKER: FormatMarker = { open: '*', close: '*' }
export const EMPH_MARKER: FormatMarker = { open: '_', close: '_' }

export interface FormatEditInput {
  text: string
  from: number
  to: number
}

export interface FormatEditResult {
  /** The full document text after applying the edit. */
  text: string
  /** Selection covering the inner content after wrapping (wrap case). */
  selectionFrom?: number
  selectionTo?: number
  /** Cursor position after inserting an empty marker pair (no selection). */
  cursor?: number
}

function isWrapped(input: FormatEditInput, marker: FormatMarker): boolean {
  return (
    input.from >= marker.open.length &&
    input.to <= input.text.length - marker.close.length &&
    input.text.slice(input.from - marker.open.length, input.from) === marker.open &&
    input.text.slice(input.to, input.to + marker.close.length) === marker.close
  )
}

/** Selection spans the markers themselves: `*hello*` with from..to over it all. */
function selectionSpansMarkers(
  input: FormatEditInput,
  marker: FormatMarker,
): boolean {
  return (
    input.text.slice(input.from, input.from + marker.open.length) ===
      marker.open &&
    input.to - marker.close.length > input.from + marker.open.length &&
    input.text.slice(input.to - marker.close.length, input.to) === marker.close
  )
}

export function computeFormatEdit(
  input: FormatEditInput,
  marker: FormatMarker,
): FormatEditResult {
  if (input.from === input.to) {
    const text =
      input.text.slice(0, input.from) +
      marker.open +
      marker.close +
      input.text.slice(input.to)
    return { text, cursor: input.from + marker.open.length }
  }

  if (isWrapped(input, marker)) {
    const text =
      input.text.slice(0, input.from - marker.open.length) +
      input.text.slice(input.from, input.to) +
      input.text.slice(input.to + marker.close.length)
    return {
      text,
      selectionFrom: input.from - marker.open.length,
      selectionTo: input.to - marker.open.length,
    }
  }

  if (selectionSpansMarkers(input, marker)) {
    const innerFrom = input.from + marker.open.length
    const innerTo = input.to - marker.close.length
    const text =
      input.text.slice(0, input.from) +
      input.text.slice(innerFrom, innerTo) +
      input.text.slice(input.to)
    return {
      text,
      selectionFrom: input.from,
      selectionTo: input.to - marker.close.length - marker.open.length,
    }
  }

  const text =
    input.text.slice(0, input.from) +
    marker.open +
    input.text.slice(input.from, input.to) +
    marker.close +
    input.text.slice(input.to)
  return {
    text,
    selectionFrom: input.from + marker.open.length,
    selectionTo: input.to + marker.open.length,
  }
}
