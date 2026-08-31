import { useCallback, useRef, useState } from 'react'

import {
  computeProjectHeaderDropPreview,
  measureProjectHeaderDragRects
} from './project-header-drop'
import { commitProjectHeaderDragDrop } from './project-header-drag-commit'
import {
  INITIAL_REPO_DRAG_STATE,
  type ProjectHeaderDragSession,
  type RepoDragState,
  type RepoHeaderDragController,
  type UseRepoHeaderDragArgs
} from './project-header-drag-contract'
import { createProjectHeaderDragSession } from './project-header-drag-start'
import { getWorktreeSidebarDragAutoscroll } from './worktree-sidebar-drag-autoscroll'
import { useProjectHeaderDragEffects } from './use-project-header-drag-effects'

// Why pointer events instead of HTML5 DnD: rows are absolutely-positioned by
// react-virtual and unmount/remount as scroll changes, so DnD enter/leave fire
// against stale targets. With pointer events we cache the active set of repo
// header positions and compute the drop index from the live pointer Y.

export function getProjectGroupDropTargetId(
  element: Element | null,
  sourceProjectGroupId: string | null
): string | null {
  const header = element?.closest<HTMLElement>('[data-project-group-header-id]')
  const projectGroupId = header?.getAttribute('data-project-group-header-id') ?? null
  return projectGroupId && projectGroupId !== sourceProjectGroupId ? projectGroupId : null
}

export function useRepoHeaderDrag({
  orderedRepoIds,
  sidebarRepoHeaderIdsByBucket,
  repoById,
  usesProjectGroupOrdering,
  onCommitRepoOrder,
  onCommitProjectGroupOrder,
  getScrollContainer
}: UseRepoHeaderDragArgs): RepoHeaderDragController {
  const [state, setState] = useState<RepoDragState>(INITIAL_REPO_DRAG_STATE)
  const [sessionArmed, setSessionArmed] = useState(false)
  const latestDropIndexRef = useRef<number | null>(null)
  const latestTargetProjectGroupIdRef = useRef<string | null>(null)
  latestDropIndexRef.current = state.dropIndex
  const orderedIdsRef = useRef(orderedRepoIds)
  orderedIdsRef.current = orderedRepoIds
  const sidebarRepoHeaderIdsByBucketRef = useRef(sidebarRepoHeaderIdsByBucket)
  sidebarRepoHeaderIdsByBucketRef.current = sidebarRepoHeaderIdsByBucket
  const repoByIdRef = useRef(repoById)
  repoByIdRef.current = repoById
  const usesProjectGroupOrderingRef = useRef(usesProjectGroupOrdering)
  usesProjectGroupOrderingRef.current = usesProjectGroupOrdering
  const onCommitRepoOrderRef = useRef(onCommitRepoOrder)
  onCommitRepoOrderRef.current = onCommitRepoOrder
  const onCommitProjectGroupOrderRef = useRef(onCommitProjectGroupOrder)
  onCommitProjectGroupOrderRef.current = onCommitProjectGroupOrder
  const getContainerRef = useRef(getScrollContainer)
  getContainerRef.current = getScrollContainer
  const autoscrollLastFrameTimeRef = useRef<number | null>(null)
  const autoscrollFrameIdRef = useRef<number | null>(null)

  const dragSessionRef = useRef<ProjectHeaderDragSession | null>(null)
  const clickSwallowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshHeaderRects = useCallback(() => {
    const container = getContainerRef.current()
    const session = dragSessionRef.current
    if (!container || !session) {
      return []
    }
    const rects = measureProjectHeaderDragRects(container, session.bucketKey)
    session.headerRects = rects
    return rects
  }, [])

  const getProjectGroupDropTarget = useCallback((pointerX: number, pointerY: number) => {
    const session = dragSessionRef.current
    if (!session || !usesProjectGroupOrderingRef.current) {
      return null
    }
    const sourceProjectGroupId = repoByIdRef.current.get(session.repoId)?.projectGroupId ?? null
    return getProjectGroupDropTargetId(
      document.elementFromPoint(pointerX, pointerY),
      sourceProjectGroupId
    )
  }, [])

  const computeDrop = useCallback(
    (pointerY: number): { dropIndex: number; dropIndicatorY: number } | null => {
      const session = dragSessionRef.current
      const container = getContainerRef.current()
      if (!session || !container) {
        return null
      }
      return computeProjectHeaderDropPreview({
        pointerY,
        containerTop: container.getBoundingClientRect().top,
        scrollTop: container.scrollTop,
        rects: session.headerRects,
        sidebarRepoHeaderIds: session.sidebarRepoHeaderIds,
        contentBottom: container.scrollHeight
      })
    },
    []
  )

  const applyDrop = useCallback(
    (
      repoId: string,
      drop: { dropIndex: number; dropIndicatorY: number } | null,
      targetProjectGroupId: string | null
    ) => {
      latestDropIndexRef.current = drop?.dropIndex ?? null
      latestTargetProjectGroupIdRef.current = targetProjectGroupId
      const nextState: RepoDragState = {
        draggingRepoId: repoId,
        dropIndex: drop?.dropIndex ?? null,
        dropIndicatorY: drop?.dropIndicatorY ?? null,
        targetProjectGroupId
      }
      setState((prev) =>
        prev.draggingRepoId === nextState.draggingRepoId &&
        prev.dropIndex === nextState.dropIndex &&
        prev.dropIndicatorY === nextState.dropIndicatorY &&
        prev.targetProjectGroupId === nextState.targetProjectGroupId
          ? prev
          : nextState
      )
    },
    []
  )

  const cancelAutoscroll = useCallback(() => {
    if (autoscrollFrameIdRef.current !== null) {
      window.cancelAnimationFrame(autoscrollFrameIdRef.current)
      autoscrollFrameIdRef.current = null
    }
    autoscrollLastFrameTimeRef.current = null
  }, [])

  const endDrag = useCallback(
    (commit: boolean) => {
      cancelAutoscroll()
      const session = dragSessionRef.current
      if (!session) {
        setState(INITIAL_REPO_DRAG_STATE)
        setSessionArmed(false)
        return
      }
      try {
        session.handleEl.releasePointerCapture(session.pointerId)
      } catch {
        // capture may already be released (pointercancel, element unmounted)
      }
      if (session.promoted) {
        const handleEl = session.handleEl
        const swallow = (e: MouseEvent): void => {
          const target = e.target as Node | null
          if (target && handleEl.contains(target)) {
            e.stopPropagation()
            e.preventDefault()
          }
          window.removeEventListener('click', swallow, true)
        }
        window.addEventListener('click', swallow, true)
        clickSwallowTimeoutRef.current = setTimeout(() => {
          window.removeEventListener('click', swallow, true)
          clickSwallowTimeoutRef.current = null
        }, 0)
      }
      const targetProjectGroupId =
        commit && session.promoted ? latestTargetProjectGroupIdRef.current : null
      const sidebarDropIndex =
        commit && session.promoted && latestDropIndexRef.current !== null
          ? latestDropIndexRef.current
          : null
      dragSessionRef.current = null
      setState(INITIAL_REPO_DRAG_STATE)
      latestTargetProjectGroupIdRef.current = null
      setSessionArmed(false)
      if (targetProjectGroupId !== null) {
        onCommitProjectGroupOrderRef.current(session.repoId, targetProjectGroupId)
        return
      }
      if (sidebarDropIndex === null) {
        return
      }

      commitProjectHeaderDragDrop({
        session,
        sidebarDropIndex,
        orderedRepoIds: orderedIdsRef.current,
        repoById: repoByIdRef.current,
        usesProjectGroupOrdering: usesProjectGroupOrderingRef.current,
        onCommitRepoOrder: onCommitRepoOrderRef.current,
        onCommitProjectGroupOrder: onCommitProjectGroupOrderRef.current
      })
    },
    [cancelAutoscroll]
  )

  const runAutoscrollFrame = useCallback(
    (frameTime: number) => {
      autoscrollFrameIdRef.current = null
      const session = dragSessionRef.current
      const container = getContainerRef.current()
      if (!session?.promoted || !container) {
        cancelAutoscroll()
        return
      }

      const previousFrameTime = autoscrollLastFrameTimeRef.current ?? frameTime
      autoscrollLastFrameTimeRef.current = frameTime
      const autoscroll = getWorktreeSidebarDragAutoscroll({
        point: { clientX: 0, clientY: session.latestPointerY },
        containerRect: container.getBoundingClientRect(),
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        elapsedMs: frameTime - previousFrameTime
      })
      if (autoscroll) {
        container.scrollTop = autoscroll.scrollTop
        refreshHeaderRects()
      }

      const targetProjectGroupId = getProjectGroupDropTarget(
        session.latestPointerX,
        session.latestPointerY
      )
      applyDrop(
        session.repoId,
        targetProjectGroupId ? null : computeDrop(session.latestPointerY),
        targetProjectGroupId
      )

      autoscrollFrameIdRef.current = window.requestAnimationFrame(runAutoscrollFrame)
    },
    [applyDrop, cancelAutoscroll, computeDrop, getProjectGroupDropTarget, refreshHeaderRects]
  )

  const ensureAutoscroll = useCallback(() => {
    if (autoscrollFrameIdRef.current !== null) {
      return
    }
    autoscrollLastFrameTimeRef.current = null
    autoscrollFrameIdRef.current = window.requestAnimationFrame(runAutoscrollFrame)
  }, [runAutoscrollFrame])

  useProjectHeaderDragEffects({
    sessionArmed,
    draggingRepoId: state.draggingRepoId,
    dragSessionRef,
    clickSwallowTimeoutRef,
    applyDrop,
    cancelAutoscroll,
    computeDrop,
    endDrag,
    ensureAutoscroll,
    getProjectGroupDropTarget,
    refreshHeaderRects
  })

  const onHandlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, repoId: string) => {
      const session = createProjectHeaderDragSession({
        event,
        repoId,
        repoById: repoByIdRef.current,
        sidebarRepoHeaderIdsByBucket: sidebarRepoHeaderIdsByBucketRef.current,
        allowSingleHeader: usesProjectGroupOrderingRef.current,
        getScrollContainer: getContainerRef.current
      })
      if (!session) {
        return
      }
      dragSessionRef.current = session
      setSessionArmed(true)
    },
    []
  )

  return { state, onHandlePointerDown }
}

export {
  isRepoHeaderActionTarget,
  isProjectHeaderDragHandleTarget
} from './project-header-drag-contract'
