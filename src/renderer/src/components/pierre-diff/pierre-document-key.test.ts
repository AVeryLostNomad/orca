// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@pierre/diffs/edit'

type NativeEditor = Editor<undefined> & {
  __syncRenderView: (
    highlighter: unknown,
    fileContainer: HTMLElement,
    file: { name: string; contents: string; cacheKey: string; lang: string },
    annotations: undefined,
    renderRange: undefined
  ) => void
}

function createNativeSurface(): HTMLElement {
  const surface = document.createElement('div')
  const shadow = surface.attachShadow({ mode: 'open' })
  shadow.innerHTML = '<div data-code><div data-gutter></div><div data-content></div></div>'
  document.body.append(surface)
  return surface
}

function createHighlighter(): unknown {
  const theme = { type: 'dark', colors: {} }
  return {
    getLoadedLanguages: () => [],
    getTheme: () => theme,
    setTheme: () => ({ theme, colorMap: [] })
  }
}

function createFileInstance(): never {
  return {
    type: 'file',
    options: {},
    attachEditor: () => () => {},
    applyDocumentChange: () => {},
    getCodeScrollLeft: () => 0,
    setCodeScrollLeft: () => {},
    setEditorActiveLine: () => {},
    updateRenderCache: () => {},
    __getEffectiveCodeOptions: () => ({ theme: 'test', themeType: 'dark' })
  } as never
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('Pierre Editor documentKey', () => {
  it('keeps a native document and caret through content-versioned metadata updates', () => {
    vi.stubGlobal('matchMedia', () => ({
      addEventListener: () => {},
      matches: false,
      removeEventListener: () => {}
    }))
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect(): void {}
        observe(): void {}
      }
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: () => ({ width: 8 })
    } as unknown as CanvasRenderingContext2D)
    const editor = new Editor({ documentKey: 'working-document:a' }) as NativeEditor
    const surface = createNativeSurface()
    const highlighter = createHighlighter()
    editor.edit(createFileInstance())
    editor.__syncRenderView(
      highlighter,
      surface,
      {
        name: 'example.ts',
        contents: 'const value = 1',
        cacheKey: 'metadata:1',
        lang: 'text'
      },
      undefined,
      undefined
    )
    editor.setSelections([
      {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 6 },
        direction: 'none'
      }
    ])
    editor.applyEdits([
      {
        range: {
          start: { line: 0, character: 15 },
          end: { line: 0, character: 15 }
        },
        newText: '!'
      }
    ])

    editor.__syncRenderView(
      highlighter,
      surface,
      {
        name: 'example.ts',
        contents: 'const value = 2',
        cacheKey: 'metadata:2',
        lang: 'text'
      },
      undefined,
      undefined
    )

    expect(editor.getText()).toBe('const value = 1!')
    expect(editor.getState().selections).toEqual([
      {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 6 },
        direction: 0
      }
    ])

    editor.setOptions({ documentKey: 'working-document:b' })
    editor.__syncRenderView(
      highlighter,
      surface,
      {
        name: 'example.ts',
        contents: 'const replacement = 3',
        cacheKey: 'metadata:3',
        lang: 'text'
      },
      undefined,
      undefined
    )
    expect(editor.getText()).toBe('const replacement = 3')
    editor.cleanUp()
  })
})
