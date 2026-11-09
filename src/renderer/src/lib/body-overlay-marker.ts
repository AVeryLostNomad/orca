import { useLayoutEffect } from 'react'

type BodyOverlayAttribute = 'data-modal-overlay-open' | 'data-onboarding-overlay-open'

const openCounts: Record<BodyOverlayAttribute, number> = {
  'data-modal-overlay-open': 0,
  'data-onboarding-overlay-open': 0
}

/** Flags <body> while a body-portaled overlay is mounted. Replaces `body:has(> overlay)`, which made
 *  Blink restyle the whole document on unrelated DOM churn (every editor keystroke). */
export function useBodyOverlayFlag(attribute: BodyOverlayAttribute): void {
  useLayoutEffect(() => {
    openCounts[attribute] += 1
    document.body.setAttribute(attribute, '')
    return () => {
      openCounts[attribute] -= 1
      if (openCounts[attribute] === 0) {
        document.body.removeAttribute(attribute)
      }
    }
  }, [attribute])
}

/** Render inside the overlay element: Radix omits it for non-modal dialogs, so the flag follows the real backdrop. */
export function BodyOverlayFlag({ attribute }: { attribute: BodyOverlayAttribute }): null {
  useBodyOverlayFlag(attribute)
  return null
}
