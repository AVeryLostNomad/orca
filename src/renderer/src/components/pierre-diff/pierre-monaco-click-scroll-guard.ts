/**
 * Monaco focuses its edit context without `preventScroll` before it moves the caret, so a click
 * can scroll the surrounding diff list to the stale caret. Undo only scrolls made during the press.
 */
export function installPierreMonacoClickScrollGuard(
  container: HTMLElement,
  host: HTMLElement
): () => void {
  let snapshot: [HTMLElement, number][] | null = null
  const onPointerDown = (event: PointerEvent): void => {
    if (!(event.target instanceof Node) || !container.contains(event.target)) {
      return
    }
    snapshot = []
    for (let node = host.parentElement; node; node = node.parentElement) {
      snapshot.push([node, node.scrollTop])
    }
  }
  const restore = (): void => {
    const taken = snapshot
    snapshot = null
    for (const [node, scrollTop] of taken ?? []) {
      if (node.scrollTop !== scrollTop) {
        node.scrollTop = scrollTop
      }
    }
  }
  container.addEventListener('pointerdown', onPointerDown, true)
  // Bubble on window runs after Monaco's own mousedown handling; mouseup covers stopped propagation.
  window.addEventListener('mousedown', restore)
  window.addEventListener('mouseup', restore, true)
  return () => {
    container.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('mousedown', restore)
    window.removeEventListener('mouseup', restore, true)
  }
}
