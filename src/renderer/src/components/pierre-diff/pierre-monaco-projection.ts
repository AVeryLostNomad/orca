import type { FileDiff as NativeFileDiff } from '@pierre/diffs'
import type { editor, IRange } from 'monaco-editor'
import type { ProjectedLine } from './pierre-monaco-projection-geometry'
import {
  collectProjectedLines,
  findProjectedLine,
  getNativeHiddenAreasSnapshot,
  getProjectionBounds,
  getProjectionViewport
} from './pierre-monaco-projection-geometry'
import type { PierreDiffAnnotationData } from './pierre-diff-comment-annotations'
import { installPierreNativeOverlay } from './pierre-monaco-projection-native'
import { installPierreMonacoHorizontalScroll } from './pierre-monaco-horizontal-scroll'

type HiddenAreaEditor = editor.IStandaloneCodeEditor & {
  setHiddenAreas: (ranges: IRange[]) => void
}

function getHiddenAreaEditor(editorInstance: editor.IStandaloneCodeEditor): HiddenAreaEditor {
  if (typeof (editorInstance as Partial<HiddenAreaEditor>).setHiddenAreas !== 'function') {
    throw new Error('Pierre Monaco projection requires Monaco hidden-area support.')
  }
  return editorInstance as HiddenAreaEditor
}

export type InstallPierreMonacoProjectionArgs = {
  editor: editor.IStandaloneCodeEditor
  host: HTMLElement
  nativeFileDiff: NativeFileDiff<PierreDiffAnnotationData>
  container: HTMLElement
}

/**
 * Mirrors Pierre's currently materialized modified rows into one retained Monaco editor.
 * Pierre remains responsible for every non-code row; Monaco only occupies content-line boxes.
 */
export function installPierreMonacoProjection({
  editor,
  host,
  nativeFileDiff,
  container
}: InstallPierreMonacoProjectionArgs): () => void {
  let disposed = false
  let frame: number | undefined
  let visible = false
  let lastRevealLine: number | undefined
  let cachedHiddenAreasKey: string | undefined
  let cachedMetadata: unknown
  let appliedWordWrap: 'off' | 'on' | undefined
  let appliedTypography: string | undefined
  let keyboardNavigation = false
  let zoneIds: string[] = []
  let appliedLayout: string | undefined
  let appliedLines: ProjectedLine[] = []
  const hiddenAreaEditor = getHiddenAreaEditor(editor)
  const root = host.shadowRoot ?? host
  const {
    cleanup: cleanupNativeOverlay,
    disableNativeEditor,
    restoreNativeEditor
  } = installPierreNativeOverlay(host, root, container)

  const clearZones = (): void => {
    if (!zoneIds.length) {
      return
    }
    editor.changeViewZones((accessor) => {
      for (const zoneId of zoneIds) {
        accessor.removeZone(zoneId)
      }
    })
    zoneIds = []
  }

  const deactivate = (): void => {
    appliedLayout = undefined
    clearZones()
    hiddenAreaEditor.setHiddenAreas([])
    container.style.display = 'none'
    if (visible) {
      visible = false
      restoreNativeEditor()
    }
  }

  const requestReconcile = (): void => {
    if (disposed || frame !== undefined) {
      return
    }
    frame = requestAnimationFrame(() => {
      frame = undefined
      horizontalScroll.runProjecting(reconcile)
    })
  }
  const horizontalScroll = installPierreMonacoHorizontalScroll(
    editor,
    container,
    nativeFileDiff,
    requestReconcile
  )

  const requestReveal = (lineNumber: number): void => {
    if (lastRevealLine === lineNumber) {
      return
    }
    lastRevealLine = lineNumber
    nativeFileDiff.revealLine(lineNumber)
    requestReconcile()
  }

  const reconcile = (): void => {
    if (disposed) {
      return
    }
    const model = editor.getModel()
    if (!model || model.isDisposed()) {
      deactivate()
      return
    }
    const lines = collectProjectedLines(root, model.getLineCount())
    if (!lines.length) {
      deactivate()
      return
    }

    const cursorLine = editor.getPosition()?.lineNumber
    if (lastRevealLine !== undefined) {
      const revealedLine = findProjectedLine(root, lastRevealLine)
      if (revealedLine) {
        revealedLine.scrollIntoView({ block: 'nearest' })
        lastRevealLine = undefined
      } else if (cursorLine !== lastRevealLine) {
        lastRevealLine = undefined
      }
    }

    const positioningRoot =
      container.offsetParent instanceof HTMLElement
        ? container.offsetParent
        : container.parentElement
    if (!positioningRoot) {
      return
    }
    const positioningRect = positioningRoot.getBoundingClientRect()
    const { left, top, width, height } = getProjectionBounds(lines, positioningRect)
    const wordWrap = root.querySelector('[data-overflow="wrap"]') ? 'on' : 'off'
    const nativeLine = findProjectedLine(root, lines[0]!.lineNumber)
    const nativeTextStyle = nativeLine ? getComputedStyle(nativeLine) : undefined
    const fontSize = Number.parseFloat(nativeTextStyle?.fontSize ?? '')
    const lineHeight = Number.parseFloat(nativeTextStyle?.lineHeight ?? '')
    const paddingLeft = Math.max(0, Number.parseFloat(nativeTextStyle?.paddingLeft ?? '') || 0)
    const typographyKey = `${nativeTextStyle?.fontFamily}:${fontSize}:${lineHeight}`
    if (wordWrap !== appliedWordWrap || typographyKey !== appliedTypography) {
      editor.updateOptions({
        wordWrap,
        padding: { top: 0, bottom: 0 },
        ...(nativeTextStyle?.fontFamily ? { fontFamily: nativeTextStyle.fontFamily } : {}),
        ...(fontSize > 0 ? { fontSize } : {}),
        ...(lineHeight > 0 ? { lineHeight } : {})
      })
      appliedWordWrap = wordWrap
      appliedTypography = typographyKey
    }

    const textLeft = left + paddingLeft
    const viewport = nativeLine ? getProjectionViewport(nativeLine, positioningRect) : undefined
    // Why: an overlay as wide as the scrolled rows overflows Pierre's frame and makes the
    // outer pane scroll horizontally; Monaco scrolls inside the code viewport instead.
    const contentLeft = viewport ? Math.max(textLeft, viewport.left) : textLeft
    const contentWidth = Math.max(1, viewport ? viewport.right - contentLeft : width - paddingLeft)
    const scrollLeft = Math.max(0, contentLeft - textLeft)
    container.style.display = 'block'
    container.style.left = `${contentLeft}px`
    container.style.top = `${top}px`
    container.style.width = `${contentWidth}px`
    container.style.height = `${height}px`

    const hiddenAreas = getNativeHiddenAreasSnapshot(nativeFileDiff, model.getLineCount())
    const layoutKey = `${contentLeft}:${top}:${contentWidth}:${height}:${typographyKey}:${wordWrap}:${model.getVersionId()}:${hiddenAreas.key}`
    const unchangedRows =
      lines.length === appliedLines.length &&
      lines.every((line, index) => {
        const previous = appliedLines[index]!
        return (
          line.lineNumber === previous.lineNumber &&
          line.top - lines[0]!.top === previous.top - appliedLines[0]!.top &&
          line.bottom - line.top === previous.bottom - previous.top
        )
      })
    // Hover decorations mutate Pierre's DOM without changing the projected rows.
    if (appliedLayout === layoutKey && unchangedRows) {
      horizontalScroll.apply(scrollLeft)
      disableNativeEditor()
      return
    }
    appliedLayout = layoutKey
    appliedLines = lines
    clearZones()
    if (cachedMetadata !== nativeFileDiff.fileDiff || cachedHiddenAreasKey !== hiddenAreas.key) {
      cachedMetadata = nativeFileDiff.fileDiff
      cachedHiddenAreasKey = hiddenAreas.key
      hiddenAreaEditor.setHiddenAreas(hiddenAreas.areas)
    }
    editor.layout({ width: contentWidth, height })
    editor.setScrollTop(editor.getTopForLineNumber(lines[0]!.lineNumber))
    horizontalScroll.apply(scrollLeft)

    const zoneSpecs: { afterLineNumber: number; heightInPx: number }[] = []
    for (let index = 1; index < lines.length; index++) {
      const previous = lines[index - 1]!
      const current = lines[index]!
      const nativeDistance = current.top - previous.top
      const monacoDistance =
        editor.getTopForLineNumber(current.lineNumber) -
        editor.getTopForLineNumber(previous.lineNumber)
      const heightInPx = Math.round(nativeDistance - monacoDistance)
      if (heightInPx > 0) {
        zoneSpecs.push({ afterLineNumber: previous.lineNumber, heightInPx })
      }
    }
    if (zoneSpecs.length) {
      editor.changeViewZones((accessor) => {
        zoneIds = zoneSpecs.map(({ afterLineNumber, heightInPx }) => {
          const spacer = document.createElement('div')
          spacer.style.pointerEvents = 'none'
          return accessor.addZone({
            afterLineNumber,
            heightInPx,
            domNode: spacer,
            showInHiddenAreas: true,
            suppressMouseDown: true
          })
        })
      })
    }

    visible = true
    // Pierre replaces its editable content node during a render; disable the replacement too.
    disableNativeEditor()
  }

  const mutationObserver = new MutationObserver(requestReconcile)
  mutationObserver.observe(root, { childList: true, subtree: true })
  const resizeObserver = new ResizeObserver(requestReconcile)
  resizeObserver.observe(host)
  if (container.parentElement) {
    resizeObserver.observe(container.parentElement)
  }

  const scrollParents: HTMLElement[] = []
  for (let node = host.parentElement; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) {
      node.addEventListener('scroll', requestReconcile, { passive: true })
      scrollParents.push(node)
    }
  }
  root.addEventListener('scroll', requestReconcile, { capture: true, passive: true })

  const keyDownSubscription = editor.onKeyDown((event) => {
    keyboardNavigation = [
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'End',
      'Home',
      'PageDown',
      'PageUp'
    ].includes(event.browserEvent.key)
    if (keyboardNavigation) {
      requestAnimationFrame(() => {
        keyboardNavigation = false
      })
    }
  })
  const cursorSubscription = editor.onDidChangeCursorPosition((event) => {
    if (!keyboardNavigation || !editor.hasTextFocus()) {
      return
    }
    const materializedLine = findProjectedLine(root, event.position.lineNumber)
    if (materializedLine) {
      materializedLine.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      requestReconcile()
      return
    }
    if (!nativeFileDiff.isLineRenderable(event.position.lineNumber)) {
      requestReveal(event.position.lineNumber)
      return
    }
    const materializedLines = collectProjectedLines(root, editor.getModel()?.getLineCount() ?? 0)
    const firstMaterializedLine = materializedLines[0]
    if (firstMaterializedLine && scrollParents[0]) {
      scrollParents[0].scrollBy({
        top:
          editor.getTopForLineNumber(event.position.lineNumber) -
          editor.getTopForLineNumber(firstMaterializedLine.lineNumber),
        behavior: 'auto'
      })
    }
  })
  const modelSubscription = editor.onDidChangeModelContent(requestReconcile)

  requestReconcile()
  return () => {
    disposed = true
    if (frame !== undefined) {
      cancelAnimationFrame(frame)
    }
    mutationObserver.disconnect()
    resizeObserver.disconnect()
    for (const parent of scrollParents) {
      parent.removeEventListener('scroll', requestReconcile)
    }
    root.removeEventListener('scroll', requestReconcile, true)
    cursorSubscription.dispose()
    keyDownSubscription.dispose()
    modelSubscription.dispose()
    horizontalScroll.dispose()
    deactivate()
    cleanupNativeOverlay()
    container.style.removeProperty('display')
    container.style.removeProperty('left')
    container.style.removeProperty('top')
    container.style.removeProperty('width')
    container.style.removeProperty('height')
  }
}
