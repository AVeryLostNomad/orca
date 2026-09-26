import type { FileDiff as NativeFileDiff } from '@pierre/diffs'
import type { editor } from 'monaco-editor'
import type { PierreDiffAnnotationData } from './pierre-diff-comment-annotations'

const WHEEL_LINE_PX = 16

export type PierreMonacoHorizontalScroll = {
  /** Applies the native code column's scroll offset to Monaco. */
  apply: (scrollLeft: number) => void
  /** Suppresses Monaco-to-Pierre propagation while the projection mutates Monaco. */
  runProjecting: (callback: () => void) => void
  dispose: () => void
}

/**
 * Pierre's code columns own horizontal scrolling; the viewport-sized Monaco
 * overlay mirrors their offset and forwards wheel and caret-reveal scrolling back.
 */
export function installPierreMonacoHorizontalScroll(
  editorInstance: editor.IStandaloneCodeEditor,
  container: HTMLElement,
  nativeFileDiff: NativeFileDiff<PierreDiffAnnotationData>,
  onContentSizeChange: () => void
): PierreMonacoHorizontalScroll {
  let appliedScrollLeft = 0
  let projecting = false

  const scrollSubscription = editorInstance.onDidScrollChange((event) => {
    if (
      projecting ||
      !editorInstance.hasTextFocus() ||
      !event.scrollLeftChanged ||
      event.scrollLeft === appliedScrollLeft
    ) {
      return
    }
    const delta = event.scrollLeft - appliedScrollLeft
    appliedScrollLeft = event.scrollLeft
    nativeFileDiff.setCodeScrollLeft(nativeFileDiff.getCodeScrollLeft() + delta)
  })
  const contentSizeSubscription = editorInstance.onDidContentSizeChange(onContentSizeChange)

  // Monaco ignores the wheel so vertical scrolling reaches the pane.
  const onWheel = (event: WheelEvent): void => {
    const horizontal =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.shiftKey
          ? event.deltaY
          : 0
    if (!horizontal) {
      return
    }
    const previous = nativeFileDiff.getCodeScrollLeft()
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : 1
    nativeFileDiff.setCodeScrollLeft(previous + horizontal * scale)
    if (nativeFileDiff.getCodeScrollLeft() !== previous) {
      event.preventDefault()
    }
  }
  container.addEventListener('wheel', onWheel, { passive: false })

  return {
    apply: (scrollLeft) => {
      editorInstance.setScrollLeft(scrollLeft)
      // Monaco clamps to its own content width; record what it actually applied.
      appliedScrollLeft = editorInstance.getScrollLeft()
    },
    runProjecting: (callback) => {
      projecting = true
      try {
        callback()
      } finally {
        projecting = false
      }
    },
    dispose: () => {
      scrollSubscription.dispose()
      contentSizeSubscription.dispose()
      container.removeEventListener('wheel', onWheel)
    }
  }
}
