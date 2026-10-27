import React from 'react'
import type { GroupHeaderRow } from '../../../../../../shared/sidebar-list/row-types'
import { getProjectGroupHeaderPaddingLeft } from './indentation'
import { resolveRepoHeaderColor } from '../../project-header-color'

type ProjectGroupHeaderColors = {
  projectGroupColor: string | undefined
  /** Only a pinned, expanded group with an explicit color gets a sticky frame. */
  stickyGroupFrameColor: string | undefined
}

export function getProjectGroupHeaderColors(
  row: GroupHeaderRow,
  isProjectGroupHeader: boolean,
  pinnedAndExpanded: boolean
): ProjectGroupHeaderColors {
  const projectGroupColor =
    isProjectGroupHeader && !row.repo && row.projectGroup && 'color' in row.projectGroup
      ? resolveRepoHeaderColor(row.projectGroup.color)
      : undefined
  const hasExplicitColor =
    row.projectGroup &&
    'color' in row.projectGroup &&
    typeof row.projectGroup.color === 'string' &&
    row.projectGroup.color.trim() !== ''
  return {
    projectGroupColor,
    stickyGroupFrameColor: pinnedAndExpanded && hasExplicitColor ? projectGroupColor : undefined
  }
}

export function ProjectGroupStickyFrame({
  color,
  depth
}: {
  color: string
  depth: number
}): React.JSX.Element {
  const boundary = `1px solid color-mix(in srgb, ${color} 24%, var(--sidebar-border))`
  return (
    <div
      aria-hidden="true"
      data-project-group-sticky-frame=""
      className="pointer-events-none absolute inset-y-0 box-border rounded-t-sm"
      style={{
        left: Math.max(1, getProjectGroupHeaderPaddingLeft(depth) - 8),
        right: 4 + depth * 4,
        backgroundColor: `color-mix(in srgb, ${color} 6%, var(--worktree-sidebar))`,
        borderLeft: boundary,
        borderRight: boundary,
        borderTop: boundary
      }}
    />
  )
}
