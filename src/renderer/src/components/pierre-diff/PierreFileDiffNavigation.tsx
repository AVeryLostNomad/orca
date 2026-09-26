import { useEffect, useMemo } from 'react'
import { useVirtualizer } from '@pierre/diffs/react'
import type {
  FileDiff as NativeFileDiff,
  FileDiffMetadata,
  VirtualizedFileDiff
} from '@pierre/diffs'
import type { RefObject } from 'react'
import { installDiffChangeNavigationShortcut } from '../editor/editor-shortcuts'
import { useDiffNavigationRegistration } from '../editor/diff-navigation-context'
import type { PierreDiffAnnotationData } from './pierre-diff-comment-annotations'

type PierreFileDiffNavigationProps = {
  fileDiff: FileDiffMetadata
  nativeFileDiffRef: RefObject<NativeFileDiff<PierreDiffAnnotationData> | null>
  shortcutTargetRef: RefObject<HTMLElement | null>
}

/** Registers hunk navigation against Pierre's virtualizer, not transient DOM rows. */
export function PierreFileDiffNavigation({
  fileDiff,
  nativeFileDiffRef,
  shortcutTargetRef
}: PierreFileDiffNavigationProps): null {
  const virtualizer = useVirtualizer()
  const { registerDiffNavigation, unregisterDiffNavigation } = useDiffNavigationRegistration()
  const navigation = useMemo(() => {
    let hunkIndex = -1
    const scrollToHunk = (direction: 1 | -1): void => {
      const hunks = fileDiff.hunks
      if (hunks.length === 0) {
        return
      }
      hunkIndex = (hunkIndex + direction + hunks.length) % hunks.length
      const lineNumber = hunks[hunkIndex]!.additionStart
      const nativeFileDiff = nativeFileDiffRef.current
      if (!nativeFileDiff || !virtualizer) {
        return
      }
      nativeFileDiff.setEditorActiveLine(lineNumber, { side: 'additions' })
      const virtualFileDiff = nativeFileDiff as VirtualizedFileDiff<PierreDiffAnnotationData>
      const linePosition = virtualFileDiff.getLinePosition(lineNumber, 'additions')
      if (!linePosition) {
        return
      }
      virtualizer.scrollTo({
        top: (virtualFileDiff.top ?? 0) + linePosition.top,
        behavior: 'smooth'
      })
    }
    return {
      changeCount: fileDiff.hunks.length,
      goToPreviousDiff: () => scrollToHunk(-1),
      goToNextDiff: () => scrollToHunk(1)
    }
  }, [fileDiff, nativeFileDiffRef, virtualizer])
  useEffect(() => {
    const target = shortcutTargetRef.current
    return target ? installDiffChangeNavigationShortcut(target, navigation) : undefined
  }, [navigation, shortcutTargetRef])

  useEffect(() => {
    registerDiffNavigation(navigation)
    return () => unregisterDiffNavigation(navigation)
  }, [navigation, registerDiffNavigation, unregisterDiffNavigation])

  return null
}
