import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { editor, IDisposable } from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import { basename } from '@/lib/path'
import type { SerializedLineChange } from '@/lib/diff-comparison/comparison-types'
import { GitHunkPeek } from './GitHunkPeek'
import {
  buildGitHunkPeekRows,
  buildGitHunkRevertEdit,
  findGitHunkIndexAtLine,
  getGitHunkKind,
  getGitHunkPeekAfterLine,
  type GitHunkPeekRow
} from './git-gutter-hunks'

const HEADER_PX = 28
const MAX_VISIBLE_ROWS = 14
// The Git bar occupies the start of the decorations lane; folding chevrons sit past it.
const GUTTER_MARK_HIT_WIDTH_PX = 12

/** Git changes computed for the model's current version; stale results are never exposed. */
export type GitHunkSnapshot = {
  model: editor.ITextModel
  changes: readonly SerializedLineChange[]
  originalContent: string
  language: string
}

/** Opens an inline diff of one Git change under the gutter mark that was clicked. */
export class GitHunkPeekController {
  private zoneId: string | null = null
  private zoneAfterLine = -1
  private zoneHeight = -1
  private overlay: editor.IOverlayWidget | null = null
  private host: HTMLDivElement | null = null
  private root: Root | null = null
  private changeIndex = 0
  private readonly disposables: IDisposable[] = []

  constructor(
    private readonly mountedEditor: editor.IStandaloneCodeEditor,
    private readonly getSnapshot: () => GitHunkSnapshot | null,
    private readonly getFilePath: () => string
  ) {
    const editorNode = mountedEditor.getDomNode()
    if (editorNode) {
      // Capture phase: Monaco's folding contribution shares this gutter lane and
      // would otherwise toggle a fold on the same click.
      const onPointerDown = (event: PointerEvent): void => this.onGutterPointerDown(event)
      editorNode.addEventListener('pointerdown', onPointerDown, true)
      this.disposables.push({
        dispose: () => editorNode.removeEventListener('pointerdown', onPointerDown, true)
      })
    }
    const onDocumentPointerDown = (event: PointerEvent): void => {
      if (this.isOpen && !(event.target instanceof Node && editorNode?.contains(event.target))) {
        this.close()
      }
    }
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    this.disposables.push(
      { dispose: () => document.removeEventListener('pointerdown', onDocumentPointerDown, true) },
      mountedEditor.onMouseDown((event) => {
        const { type } = event.target
        if (
          this.isOpen &&
          type !== monaco.editor.MouseTargetType.CONTENT_VIEW_ZONE &&
          type !== monaco.editor.MouseTargetType.OVERLAY_WIDGET
        ) {
          this.close()
        }
      }),
      mountedEditor.onKeyDown((event) => {
        if (this.isOpen && event.keyCode === monaco.KeyCode.Escape) {
          event.preventDefault()
          event.stopPropagation()
          this.close()
        }
      }),
      mountedEditor.onDidChangeModel(() => this.close()),
      mountedEditor.onDidLayoutChange(() => this.layoutOverlay()),
      mountedEditor.onDidChangeConfiguration(() => this.refresh())
    )
  }

  get isOpen(): boolean {
    return this.zoneId !== null
  }

  /** Called after Git marks change; keeps an open peek on the same change or closes it. */
  refresh(): void {
    if (!this.isOpen) {
      return
    }
    const snapshot = this.getSnapshot()
    if (!snapshot || snapshot.changes.length === 0) {
      this.close()
      return
    }
    this.show(snapshot, Math.min(this.changeIndex, snapshot.changes.length - 1), false)
  }

  /** Toggles the peek for the change drawn at `lineNumber`; false when no change is there. */
  openAtLine(lineNumber: number): boolean {
    const snapshot = this.getSnapshot()
    if (!snapshot) {
      return false
    }
    const index = findGitHunkIndexAtLine(
      snapshot.model,
      snapshot.changes,
      snapshot.originalContent,
      lineNumber
    )
    if (index === null) {
      return false
    }
    if (this.isOpen && index === this.changeIndex) {
      this.close()
    } else {
      this.show(snapshot, index, true)
    }
    return true
  }

  close(): void {
    const { zoneId, root } = this
    this.zoneId = null
    this.root = null
    if (zoneId !== null) {
      this.mountedEditor.changeViewZones((accessor) => accessor.removeZone(zoneId))
    }
    if (this.overlay) {
      this.mountedEditor.removeOverlayWidget(this.overlay)
      this.overlay = null
    }
    this.host = null
    // Unmounting synchronously inside a React or Monaco event races their bookkeeping.
    if (root) {
      queueMicrotask(() => root.unmount())
    }
  }

  dispose(): void {
    this.close()
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose()
    }
  }

  private onGutterPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return
    }
    const hit = this.mountedEditor.getTargetAtClientPoint(event.clientX, event.clientY)
    if (hit?.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS || !hit.position) {
      return
    }
    // Folding decorations cover the same lane, so hit-test by position rather than element.
    const laneX = hit.detail.offsetX - this.mountedEditor.getLayoutInfo().decorationsLeft
    if (laneX < 0 || laneX > GUTTER_MARK_HIT_WIDTH_PX) {
      return
    }
    if (!this.openAtLine(hit.position.lineNumber)) {
      return
    }
    // Suppressing pointerdown also suppresses the compatibility mousedown folding listens to.
    event.preventDefault()
    event.stopPropagation()
  }

  private move(delta: number): void {
    const snapshot = this.getSnapshot()
    if (!snapshot || snapshot.changes.length === 0) {
      return
    }
    const count = snapshot.changes.length
    this.show(snapshot, (this.changeIndex + delta + count) % count, true)
  }

  private revert(): void {
    const snapshot = this.getSnapshot()
    const change = snapshot?.changes[this.changeIndex]
    if (!snapshot || !change || this.mountedEditor.getOption(monaco.editor.EditorOption.readOnly)) {
      return
    }
    const edit = buildGitHunkRevertEdit(snapshot.model, change, snapshot.originalContent)
    this.close()
    this.mountedEditor.pushUndoStop()
    this.mountedEditor.executeEdits('orca.git.revertChange', [edit])
    this.mountedEditor.pushUndoStop()
    this.mountedEditor.focus()
  }

  private ensureHost(): HTMLDivElement {
    if (this.host) {
      return this.host
    }
    const host = document.createElement('div')
    host.className = 'orca-git-hunk-peek-host'
    // Keep Monaco from treating clicks and keys inside the peek as editor input.
    host.addEventListener('mousedown', (event) => event.stopPropagation())
    host.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') {
        return
      }
      event.stopPropagation()
      this.close()
      this.mountedEditor.focus()
    })
    this.host = host
    this.root = createRoot(host)
    this.overlay = {
      getId: () => 'orca.gitHunkPeek',
      getDomNode: () => host,
      getPosition: () => null
    }
    this.mountedEditor.addOverlayWidget(this.overlay)
    return host
  }

  private show(snapshot: GitHunkSnapshot, index: number, reveal: boolean): void {
    const change = snapshot.changes[index]
    if (!change || !getGitHunkKind(change, snapshot.originalContent, snapshot.model)) {
      return
    }
    this.changeIndex = index
    const rows = buildGitHunkPeekRows(
      snapshot.model,
      snapshot.changes,
      index,
      snapshot.originalContent
    )
    const lineHeight = this.mountedEditor.getOption(monaco.editor.EditorOption.lineHeight)
    const afterLineNumber = getGitHunkPeekAfterLine(
      snapshot.model,
      change,
      snapshot.originalContent
    )
    const host = this.ensureHost()
    const heightInPx = HEADER_PX + Math.min(rows.length, MAX_VISIBLE_ROWS) * lineHeight + 2
    // Re-adding an unchanged zone on every recompute would visibly jump the text below it.
    if (
      this.zoneId === null ||
      this.zoneAfterLine !== afterLineNumber ||
      this.zoneHeight !== heightInPx
    ) {
      this.mountedEditor.changeViewZones((accessor) => {
        if (this.zoneId !== null) {
          accessor.removeZone(this.zoneId)
        }
        host.style.top = '-10000px'
        this.zoneId = accessor.addZone({
          afterLineNumber,
          heightInPx,
          domNode: document.createElement('div'),
          onDomNodeTop: (top) => {
            host.style.top = `${top}px`
          },
          onComputedHeight: (height) => {
            host.style.height = `${height}px`
          }
        })
      })
      this.zoneAfterLine = afterLineNumber
      this.zoneHeight = heightInPx
    }
    this.layoutOverlay()
    this.render(snapshot, rows)
    if (reveal) {
      this.mountedEditor.revealLinesInCenterIfOutsideViewport(
        Math.max(1, change.modifiedStartLineNumber),
        Math.max(1, afterLineNumber),
        monaco.editor.ScrollType.Smooth
      )
    }
  }

  private layoutOverlay(): void {
    if (!this.host) {
      return
    }
    const layout = this.mountedEditor.getLayoutInfo()
    this.host.style.left = `${layout.minimap.minimapLeft === 0 ? layout.minimap.minimapWidth : 0}px`
    this.host.style.width = `${layout.width - layout.minimap.minimapWidth - layout.verticalScrollbarWidth}px`
  }

  private render(snapshot: GitHunkSnapshot, rows: readonly GitHunkPeekRow[]): void {
    const fontInfo = this.mountedEditor.getOption(monaco.editor.EditorOption.fontInfo)
    // Monaco's font options hold the bare family; its rendered lines carry the full fallback stack.
    const renderedLine = this.mountedEditor.getDomNode()?.querySelector('.view-line')
    const fontFamily = renderedLine
      ? getComputedStyle(renderedLine).fontFamily
      : fontInfo.fontFamily
    this.root?.render(
      createElement(GitHunkPeek, {
        fileName: basename(this.getFilePath()),
        rows,
        language: snapshot.language,
        changeIndex: this.changeIndex,
        changeCount: snapshot.changes.length,
        canRevert: !this.mountedEditor.getOption(monaco.editor.EditorOption.readOnly),
        fontFamily,
        fontSize: fontInfo.fontSize,
        lineHeight: this.mountedEditor.getOption(monaco.editor.EditorOption.lineHeight),
        onRevert: () => this.revert(),
        onPrevious: () => this.move(-1),
        onNext: () => this.move(1),
        onClose: () => {
          this.close()
          this.mountedEditor.focus()
        }
      })
    )
  }
}
