import {
  appendPaletteListEntries,
  CONTINUED_SECTION_HEADER_ID_SUFFIX,
  type PaletteItem,
  type PaletteListEntry
} from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteSections } from './use-worktree-jump-palette-sections'

type MultiPrimaryLayout = NonNullable<
  WorktreeJumpPaletteSections['paletteSections']['multiPrimaryLayout']
>

/** Typed-query first screen when both open tabs and workspaces match: preview, floor, then rests. */
export function appendMultiPrimaryPaletteEntries({
  entries,
  layout,
  openTabsLeadSections,
  pushOpenTabsHeader,
  pushWorktreesHeader,
  pushOverflowHint,
  handleExpandSection
}: {
  entries: PaletteListEntry[]
  layout: MultiPrimaryLayout
  openTabsLeadSections: boolean
  pushOpenTabsHeader: (idSuffix?: string) => void
  pushWorktreesHeader: (idSuffix?: string) => void
  pushOverflowHint: (id: string, overflowCount: number, onSeeMore?: () => void) => void
  handleExpandSection: (sectionKey: string) => void
}): void {
  const leadingSectionKey = openTabsLeadSections ? 'open-tabs' : 'worktrees'
  const trailingSectionKey = openTabsLeadSections ? 'worktrees' : 'open-tabs'
  const leadingHintId = openTabsLeadSections
    ? '__hint_open_tab_overflow__'
    : '__hint_worktree_overflow__'
  const trailingHintId = openTabsLeadSections
    ? '__hint_worktree_overflow__'
    : '__hint_open_tab_overflow__'
  const pushLeadingHeader = openTabsLeadSections ? pushOpenTabsHeader : pushWorktreesHeader
  const pushTrailingHeader = openTabsLeadSections ? pushWorktreesHeader : pushOpenTabsHeader
  pushLeadingHeader()
  appendPaletteListEntries(entries, layout.leadingPreview as PaletteItem[])
  pushOverflowHint(leadingHintId, layout.leadingMoreCount, () =>
    handleExpandSection(leadingSectionKey)
  )
  pushTrailingHeader()
  appendPaletteListEntries(entries, layout.trailingFloor as PaletteItem[])
  const hasLeadingRest = layout.leadingRest.length > 0
  if (hasLeadingRest) {
    pushLeadingHeader(CONTINUED_SECTION_HEADER_ID_SUFFIX)
    appendPaletteListEntries(entries, layout.leadingRest as PaletteItem[])
    pushOverflowHint(`${leadingHintId}_tail`, layout.leadingHardOverflowCount, () =>
      handleExpandSection(leadingSectionKey)
    )
  }
  if (layout.trailingRest.length > 0) {
    if (hasLeadingRest) {
      pushTrailingHeader(CONTINUED_SECTION_HEADER_ID_SUFFIX)
    }
    appendPaletteListEntries(entries, layout.trailingRest as PaletteItem[])
  }
  pushOverflowHint(trailingHintId, layout.trailingHardOverflowCount, () =>
    handleExpandSection(trailingSectionKey)
  )
}
