import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isFileSystemAccessSupported,
  openTypstFile,
  saveTypstFile,
} from './fileIo'

const pickerTypes = [{ description: 'Typst', accept: { 'text/plain': ['.typ'] } }]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isFileSystemAccessSupported', () => {
  it('returns true when both pickers are available', () => {
    vi.stubGlobal('showOpenFilePicker', vi.fn())
    vi.stubGlobal('showSaveFilePicker', vi.fn())
    expect(isFileSystemAccessSupported()).toBe(true)
  })

  it('returns false when the api is missing', () => {
    expect(isFileSystemAccessSupported()).toBe(false)
  })
})

describe('openTypstFile', () => {
  it('reads text through the file system access api', async () => {
    const getFile = vi.fn(async () => ({
      name: 'Notes.typ',
      text: async () => '#hello',
    }))
    const showOpenFilePicker = vi.fn(async () => [
      { name: 'Notes.typ', getFile },
    ])
    vi.stubGlobal('showOpenFilePicker', showOpenFilePicker)

    await expect(openTypstFile()).resolves.toEqual({
      name: 'Notes.typ',
      content: '#hello',
    })
    expect(showOpenFilePicker).toHaveBeenCalledWith({
      types: pickerTypes,
      multiple: false,
    })
    expect(getFile).toHaveBeenCalledOnce()
  })

  it('returns null when the user cancels the picker', async () => {
    vi.stubGlobal(
      'showOpenFilePicker',
      vi.fn(async () => {
        throw new DOMException('The user aborted a request.', 'AbortError')
      }),
    )

    await expect(openTypstFile()).resolves.toBeNull()
  })

  it('returns null when the api is unavailable', async () => {
    await expect(openTypstFile()).resolves.toBeNull()
  })
})

describe('saveTypstFile', () => {
  it('writes through the file system access api and returns the name', async () => {
    const write = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const createWritable = vi.fn(async () => ({ write, close }))
    const showSaveFilePicker = vi.fn(async () => ({
      name: 'Report.typ',
      createWritable,
    }))
    vi.stubGlobal('showSaveFilePicker', showSaveFilePicker)

    await expect(saveTypstFile('Report.typ', '#body')).resolves.toBe(
      'Report.typ',
    )
    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'Report.typ',
      types: pickerTypes,
    })
    expect(write).toHaveBeenCalledWith('#body')
    expect(close).toHaveBeenCalledOnce()
  })

  it('returns null when the user cancels the save dialog', async () => {
    vi.stubGlobal(
      'showSaveFilePicker',
      vi.fn(async () => {
        throw new DOMException('The user aborted a request.', 'AbortError')
      }),
    )

    await expect(saveTypstFile('Report.typ', '#body')).resolves.toBeNull()
  })

  it('falls back to an anchor download when the api is unavailable', async () => {
    const click = vi.fn()
    const createElement = vi.fn(() => ({
      href: '',
      download: '',
      click,
      remove: vi.fn(),
    }))
    const appendChild = vi.fn()
    vi.stubGlobal('document', { createElement, body: { appendChild } })
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    })

    await expect(saveTypstFile('Fallback.typ', '#fallback')).resolves.toBe(
      'Fallback.typ',
    )
    expect(createElement).toHaveBeenCalledWith('a')
    expect(click).toHaveBeenCalledOnce()
  })
})
