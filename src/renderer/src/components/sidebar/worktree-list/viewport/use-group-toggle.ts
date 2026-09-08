import { useCallback, useEffect, useMemo, useRef } from 'react'
import type React from 'react'
import { flushSync } from 'react-dom'
import { VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT } from '@/hooks/useVirtualizedScrollAnchor'
import './group-toggle-motion.css'
import { createLineageToggleHandlerCache } from '../../worktree-lineage-toggle-handler-cache'

const MOTION_TARGETS = [
  {
    selector: '[data-worktree-virtual-row][data-worktree-virtual-row-key]',
    keyAttribute: 'data-worktree-virtual-row-key',
    namePrefix: 'worktree-sidebar-row',
    transitionClass: 'worktree-sidebar-row'
  },
  {
    selector: '[data-project-group-frame]',
    keyAttribute: 'data-project-group-frame',
    namePrefix: 'worktree-sidebar-frame',
    transitionClass: 'worktree-sidebar-frame'
  }
] as const

type SidebarViewTransition = {
  ready?: Promise<unknown>
  finished: Promise<unknown>
  skipTransition: () => void
}

type ActiveSidebarTransition = {
  transition: SidebarViewTransition
  targets: Set<HTMLElement>
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => SidebarViewTransition
}

type MotionNameState = {
  names: Map<string, number>
  nextId: number
}

function labelMotionTargets(
  scrollElement: HTMLDivElement,
  motionNames: MotionNameState
): HTMLElement[] {
  const targets: HTMLElement[] = []
  for (const { selector, keyAttribute, namePrefix, transitionClass } of MOTION_TARGETS) {
    for (const target of scrollElement.querySelectorAll<HTMLElement>(selector)) {
      const key = target.getAttribute(keyAttribute)
      if (key === null) {
        continue
      }
      const motionKey = `${namePrefix}:${key}`
      let id = motionNames.names.get(motionKey)
      if (id === undefined) {
        id = motionNames.nextId
        motionNames.names.set(motionKey, id)
        motionNames.nextId += 1
      }
      target.style.setProperty('view-transition-name', `${namePrefix}-${id}`)
      target.style.setProperty('view-transition-class', transitionClass)
      targets.push(target)
    }
  }
  return targets
}

function clearMotionTargets(targets: readonly HTMLElement[]): void {
  for (const target of targets) {
    target.style.removeProperty('view-transition-name')
    target.style.removeProperty('view-transition-class')
  }
}

// Collapsing a section changes total height, so snapshot the anchor first or the viewport jumps.
export function useGroupToggleWithScrollAnchor(args: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  toggleGroup: (key: string) => void
}) {
  const { scrollRef, toggleGroup } = args
  const activeTransitionRef = useRef<ActiveSidebarTransition | null>(null)
  const recordCurrentScrollAnchor = useCallback(() => {
    scrollRef.current?.dispatchEvent(new Event(VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT))
  }, [scrollRef])
  const cancelActiveTransition = useCallback(() => {
    const activeTransition = activeTransitionRef.current
    if (activeTransition === null) {
      return
    }
    activeTransitionRef.current = null
    try {
      activeTransition.transition.skipTransition()
    } finally {
      clearMotionTargets([...activeTransition.targets])
      document.documentElement.removeAttribute('data-worktree-sidebar-group-transition')
    }
  }, [])
  useEffect(() => cancelActiveTransition, [cancelActiveTransition])

  const toggleGroupWithScrollAnchor = useCallback(
    (groupKey: string) => {
      recordCurrentScrollAnchor()
      const scrollElement = scrollRef.current
      const startViewTransition = (document as ViewTransitionDocument).startViewTransition?.bind(
        document
      )
      if (
        !scrollElement ||
        !startViewTransition ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      ) {
        toggleGroup(groupKey)
        return
      }

      // Why: a browser permits one same-document View Transition at a time.
      // Finish the current snapshot before capturing the user's latest toggle.
      cancelActiveTransition()
      document.documentElement.setAttribute('data-worktree-sidebar-group-transition', '')
      const motionNames: MotionNameState = { names: new Map(), nextId: 0 }
      const targets = new Set(labelMotionTargets(scrollElement, motionNames))
      let updateStarted = false
      try {
        const transition = startViewTransition(() => {
          updateStarted = true
          flushSync(() => toggleGroup(groupKey))
          // The browser captures the after-state when this callback returns.
          for (const target of labelMotionTargets(scrollElement, motionNames)) {
            targets.add(target)
          }
        })
        const activeTransition = { transition, targets }
        activeTransitionRef.current = activeTransition
        const finishTransition = () => {
          if (activeTransitionRef.current === activeTransition) {
            activeTransitionRef.current = null
            clearMotionTargets([...targets])
            document.documentElement.removeAttribute('data-worktree-sidebar-group-transition')
          }
        }
        // ready rejects when a transition is skipped; consuming it prevents an
        // unhandled rejection and releases temporary names if capture aborts.
        void transition.ready?.catch(finishTransition)
        void transition.finished.then(finishTransition, finishTransition)
      } catch (error) {
        clearMotionTargets([...targets])
        document.documentElement.removeAttribute('data-worktree-sidebar-group-transition')
        if (updateStarted) {
          throw error
        }
        toggleGroup(groupKey)
      }
    },
    [cancelActiveTransition, recordCurrentScrollAnchor, scrollRef, toggleGroup]
  )
  // Why: memo'd WorktreeCard needs a per-group-key stable onLineageToggle
  // identity to bail out of re-renders; see worktree-lineage-toggle-handler-cache.
  const getLineageToggleHandler = useMemo(
    () => createLineageToggleHandlerCache(toggleGroupWithScrollAnchor),
    [toggleGroupWithScrollAnchor]
  )

  return { toggleGroupWithScrollAnchor, getLineageToggleHandler }
}
