import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FileDiff as NativeFileDiff } from '@pierre/diffs'
import type { editor } from 'monaco-editor'
import {
  computeDiffEditorFontSize,
  resolveEditorBaseFontSize,
  resolveEditorFontFamily
} from '@/lib/editor-font-zoom'
import { useMonacoThemeName } from '@/lib/monaco-highlighting/use-monaco-theme-name'
import { useLspForEditor } from '@/lib/lsp/use-lsp-for-editor'
import { monaco } from '@/lib/monaco-setup'
import { useAppStore } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import {
  acquireWorkingDocumentModel,
  attachWorkingDocumentEditor
} from '../editor/working-document-model'
import {
  installEditorSaveShortcut,
  installMonacoEditorFindShortcut
} from '../editor/editor-shortcuts'
import { EditorLspStatusChip } from '../editor/EditorLspStatusChip'
import { isLinuxUserAgent } from '../terminal-pane/pane-helpers'
import type { PierreDiffAnnotationData } from './pierre-diff-comment-annotations'
import { installPierreMonacoProjection } from './pierre-monaco-projection'
import { installPierreMonacoWidgetKeybindings } from './pierre-monaco-widget-keybindings'

let nextSurfaceId = 0

export type PierreMonacoEditorProps = {
  workingDocumentId: WorkingDocumentId
  host: HTMLElement
  nativeFileDiff: NativeFileDiff<PierreDiffAnnotationData>
  onSave?: (content: string) => Promise<boolean>
}

/**
 * An editable Monaco surface projected over Pierre's rendered modified lines.
 * The retained working-document model remains the sole text and undo authority;
 * Pierre stays responsible for its headers, baseline, deleted rows, and comments.
 */
export function PierreMonacoEditor({
  workingDocumentId,
  host,
  nativeFileDiff,
  onSave
}: PierreMonacoEditorProps) {
  const workingDocument = useAppStore((state) => state.workingDocuments[workingDocumentId])
  const settings = useAppStore((state) => state.settings)
  const editorFontZoomLevel = useAppStore((state) => state.editorFontZoomLevel)
  const monacoThemeName = useMonacoThemeName()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [statusHost, setStatusHost] = useState<HTMLElement | null>(null)
  const [mountedEditor, setMountedEditor] = useState<editor.IStandaloneCodeEditor | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  const ready =
    workingDocument?.loadState === 'ready' &&
    workingDocument.content !== undefined &&
    workingDocument.writable === true
  const filePath = workingDocument?.target.filePath ?? ''
  const language = workingDocument?.target.language ?? 'plaintext'
  const worktreeId = workingDocument?.target.worktreeId
  const fontSize = computeDiffEditorFontSize(
    resolveEditorBaseFontSize(settings),
    editorFontZoomLevel
  )
  const lineHeight = Math.round(fontSize * 1.5)
  const fontFamily = resolveEditorFontFamily(settings)

  useEffect(() => {
    monaco.editor.setTheme(monacoThemeName)
  }, [monacoThemeName])

  // Why: native Pierre's post-render host is recreated as it virtualizes. The
  // overlay moves with its newest host without replacing the retained Monaco model.
  useLayoutEffect(() => {
    const parent = host.parentElement
    if (!parent) {
      return
    }
    const overlay =
      containerRef.current ??
      (() => {
        const element = document.createElement('div')
        element.className = 'pierre-monaco-editor-overlay'
        element.dataset.testid = 'pierre-monaco-editor'
        containerRef.current = element
        return element
      })()
    if (overlay.parentElement !== parent) {
      parent.append(overlay)
    }
    setContainer(overlay)
    setStatusHost(parent)
  }, [host])

  useEffect(
    () => () => {
      containerRef.current?.remove()
      containerRef.current = null
    },
    []
  )

  useLayoutEffect(() => {
    if (!container || !ready) {
      return
    }
    const model = acquireWorkingDocumentModel(workingDocumentId)
    // Completion/hover widgets must escape the projected code-column clip.
    const widgetRoot = document.createElement('div')
    widgetRoot.className = 'monaco-editor'
    widgetRoot.dataset.pierreMonacoWidgets = ''
    document.body.append(widgetRoot)
    const editorInstance = monaco.editor.create(container, {
      model,
      automaticLayout: false,
      contextmenu: true,
      cursorSmoothCaretAnimation: 'off',
      fixedOverflowWidgets: true,
      overflowWidgetsDomNode: widgetRoot,
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 0,
      lineNumbers: 'off',
      minimap: { enabled: false },
      padding: { top: 0, bottom: 0 },
      readOnly: false,
      renderLineHighlight: 'none',
      scrollbar: {
        horizontal: 'hidden',
        vertical: 'hidden',
        handleMouseWheel: false,
        alwaysConsumeMouseWheel: false
      },
      scrollBeyondLastLine: false,
      smoothScrolling: false,
      stickyScroll: { enabled: false },
      tabSize: 2,
      'semanticHighlighting.enabled': true
    })
    const detachSurface = attachWorkingDocumentEditor(
      workingDocumentId,
      `pierre-monaco:${++nextSurfaceId}`
    )
    const disposeSaveShortcut = installEditorSaveShortcut(
      editorInstance.getContainerDomNode(),
      () => {
        void onSaveRef.current?.(model.getValue())
      }
    )
    const disposeFindShortcut = installMonacoEditorFindShortcut(editorInstance)
    const disposeWidgetKeybindings = installPierreMonacoWidgetKeybindings(
      widgetRoot,
      editorInstance
    )

    editorRef.current = editorInstance
    container.dataset.pierreMonacoReady = 'true'
    setMountedEditor(editorInstance)
    return () => {
      container.dataset.pierreMonacoReady = 'false'
      setMountedEditor(null)
      disposeFindShortcut()
      disposeSaveShortcut()
      disposeWidgetKeybindings()
      detachSurface()
      editorInstance.dispose()
      widgetRoot.remove()
      if (editorRef.current === editorInstance) {
        editorRef.current = null
      }
    }
  }, [container, ready, workingDocumentId])

  useLayoutEffect(() => {
    const editorInstance = mountedEditor
    if (!editorInstance) {
      return
    }
    editorInstance.updateOptions({
      fontFamily,
      fontSize,
      lineHeight,
      selectionClipboard: settings?.primarySelectionMiddleClickPaste ?? isLinuxUserAgent()
    })
  }, [mountedEditor, fontFamily, fontSize, lineHeight, settings?.primarySelectionMiddleClickPaste])

  const lspStatus = useLspForEditor({
    mountedEditor,
    filePath,
    language,
    worktreeId,
    documentId: workingDocumentId
  })

  useLayoutEffect(() => {
    if (!mountedEditor || !container) {
      return
    }
    return installPierreMonacoProjection({
      editor: mountedEditor,
      host,
      nativeFileDiff,
      container
    })
  }, [container, fontSize, host, lineHeight, mountedEditor, nativeFileDiff])

  return statusHost ? createPortal(<EditorLspStatusChip status={lspStatus} />, statusHost) : null
}
