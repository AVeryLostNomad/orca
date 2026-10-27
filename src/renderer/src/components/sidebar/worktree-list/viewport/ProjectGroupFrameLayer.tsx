import React from 'react'
import type { ProjectGroupFrame } from './project-group-frames'

export function ProjectGroupFrameLayer({
  frames
}: {
  frames: readonly ProjectGroupFrame[]
}): React.JSX.Element {
  return (
    <>
      {frames.map((frame) => {
        const boundaryColor = `color-mix(in srgb, ${frame.color} 24%, var(--sidebar-border))`
        return (
          <div
            key={frame.key}
            aria-hidden="true"
            data-project-group-frame={frame.key}
            className="pointer-events-none absolute box-border rounded-sm"
            style={{
              left: `${frame.left}px`,
              right: `${frame.right}px`,
              top: `${frame.top}px`,
              height: `${frame.height}px`,
              backgroundColor: `color-mix(in srgb, ${frame.color} 6%, var(--worktree-sidebar))`,
              borderLeft: `1px solid ${boundaryColor}`,
              borderRight: `1px solid ${boundaryColor}`,
              borderTop: frame.showTopBoundary ? `1px solid ${boundaryColor}` : undefined,
              borderBottom: frame.showBottomBoundary ? `1px solid ${boundaryColor}` : undefined
            }}
          />
        )
      })}
    </>
  )
}

/** Insets a row inside a frame so its content clears the frame's right edge and closing bottom edges. */
export function insetRowWithinProjectGroupFrames(
  element: React.JSX.Element | null,
  index: number,
  frames: readonly ProjectGroupFrame[]
): React.JSX.Element | null {
  const containingFrame = frames.findLast(
    (frame) => index > frame.startIndex && index < frame.endIndex
  )
  return element && containingFrame
    ? React.cloneElement(element as React.ReactElement<{ style?: React.CSSProperties }>, {
        style: {
          ...element.props.style,
          paddingRight: containingFrame.right + 4,
          paddingBottom: frames.filter((frame) => frame.endIndex === index + 1).length * 4
        }
      })
    : element
}
