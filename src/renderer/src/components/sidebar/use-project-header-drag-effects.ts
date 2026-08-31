import { useEffect, type RefObject } from 'react'

import {
  PROJECT_HEADER_DRAG_THRESHOLD_PX,
  type ProjectHeaderDragSession
} from './project-header-drag-contract'

type ProjectHeaderDrop = { dropIndex: number; dropIndicatorY: number }

type UseProjectHeaderDragEffectsArgs = {
  sessionArmed: boolean
  draggingRepoId: string | null
  dragSessionRef: RefObject<ProjectHeaderDragSession | null>
  clickSwallowTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>
  applyDrop: (
    repoId: string,
    drop: ProjectHeaderDrop | null,
    targetProjectGroupId: string | null
  ) => void
  cancelAutoscroll: () => void
  computeDrop: (pointerY: number) => ProjectHeaderDrop | null
  endDrag: (commit: boolean) => void
  ensureAutoscroll: () => void
  getProjectGroupDropTarget: (pointerX: number, pointerY: number) => string | null
  refreshHeaderRects: () => unknown
}

export function useProjectHeaderDragEffects({
  sessionArmed,
  draggingRepoId,
  dragSessionRef,
  clickSwallowTimeoutRef,
  applyDrop,
  cancelAutoscroll,
  computeDrop,
  endDrag,
  ensureAutoscroll,
  getProjectGroupDropTarget,
  refreshHeaderRects
}: UseProjectHeaderDragEffectsArgs): void {
  useEffect(() => {
    if (!sessionArmed) {
      return
    }
    const onPointerMove = (event: PointerEvent): void => {
      const session = dragSessionRef.current
      if (!session || event.pointerId !== session.pointerId) {
        return
      }
      session.latestPointerY = event.clientY
      session.latestPointerX = event.clientX
      if (!session.promoted) {
        const dx = event.clientX - session.startX
        const dy = event.clientY - session.startY
        if (
          dx * dx + dy * dy <
          PROJECT_HEADER_DRAG_THRESHOLD_PX * PROJECT_HEADER_DRAG_THRESHOLD_PX
        ) {
          return
        }
        session.promoted = true
        if (session.handleEl.isConnected) {
          try {
            session.handleEl.setPointerCapture(session.pointerId)
          } catch {
            // Global pointer listeners keep the drag alive when capture fails.
          }
        }
        refreshHeaderRects()
      }
      refreshHeaderRects()
      const targetProjectGroupId = getProjectGroupDropTarget(event.clientX, event.clientY)
      applyDrop(
        session.repoId,
        targetProjectGroupId ? null : computeDrop(event.clientY),
        targetProjectGroupId
      )
      ensureAutoscroll()
    }
    const finishPointerDrag = (event: PointerEvent, commit: boolean): void => {
      const session = dragSessionRef.current
      if (session && event.pointerId === session.pointerId) {
        endDrag(commit)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        endDrag(false)
      }
    }
    const onBlur = (): void => endDrag(false)
    const onPointerUp = (event: PointerEvent): void => finishPointerDrag(event, true)
    const onPointerCancel = (event: PointerEvent): void => finishPointerDrag(event, false)

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
      cancelAutoscroll()
      if (clickSwallowTimeoutRef.current !== null) {
        clearTimeout(clickSwallowTimeoutRef.current)
        clickSwallowTimeoutRef.current = null
      }
    }
  }, [
    applyDrop,
    cancelAutoscroll,
    clickSwallowTimeoutRef,
    computeDrop,
    dragSessionRef,
    endDrag,
    ensureAutoscroll,
    getProjectGroupDropTarget,
    refreshHeaderRects,
    sessionArmed
  ])

  useEffect(() => {
    if (draggingRepoId === null) {
      return
    }
    const body = document.body
    const prevCursor = body.style.cursor
    const prevUserSelect = body.style.userSelect
    body.style.cursor = 'grabbing'
    body.style.userSelect = 'none'
    return () => {
      body.style.cursor = prevCursor
      body.style.userSelect = prevUserSelect
    }
  }, [draggingRepoId])
}
