import type { CSSProperties } from 'react'

/**
 * Maps @pierre/trees `--trees-*-override` variables onto Orca design tokens.
 *
 * Why var() references instead of resolved colors: custom properties inherit
 * through the tree's shadow root, so dark mode flips live with the app theme.
 */
const FILE_EXPLORER_TREE_THEME_VARIABLES: Record<`--${string}`, string> = {
  '--trees-bg-override': 'transparent',
  '--trees-bg-muted-override': 'var(--sidebar-accent)',
  '--trees-fg-override': 'var(--sidebar-foreground)',
  '--trees-fg-muted-override': 'var(--muted-foreground)',
  '--trees-selected-bg-override': 'var(--sidebar-accent)',
  '--trees-selected-fg-override': 'var(--sidebar-accent-foreground)',
  '--trees-selected-focused-border-color-override': 'var(--sidebar-ring)',
  '--trees-focus-ring-color-override': 'var(--ring)',
  '--trees-border-color-override': 'var(--sidebar-border)',
  '--trees-indent-guide-bg-override': 'var(--border)',
  '--trees-input-bg-override': 'var(--background)',
  '--trees-scrollbar-thumb-override': 'var(--border)',
  '--trees-font-size-override': 'var(--text-xs, 12px)',
  '--trees-status-added-override': 'var(--git-decoration-added)',
  '--trees-status-modified-override': 'var(--git-decoration-modified)',
  '--trees-status-deleted-override': 'var(--git-decoration-deleted)',
  '--trees-status-renamed-override': 'var(--git-decoration-renamed)',
  '--trees-status-untracked-override': 'var(--git-decoration-untracked)',
  '--trees-status-ignored-override': 'var(--git-decoration-ignored)',
  // Faint zebra tint consumed by the stripe rule in FILE_EXPLORER_TREE_UNSAFE_CSS.
  '--orca-file-tree-zebra-stripe': 'color-mix(in srgb, var(--sidebar-foreground) 4%, transparent)'
}

export const FILE_EXPLORER_TREE_HOST_STYLE: CSSProperties = {
  display: 'block',
  height: '100%',
  minHeight: 0,
  ...FILE_EXPLORER_TREE_THEME_VARIABLES
} as CSSProperties

/** Styling with no `--trees-*` override variable; injected into the shadow root. */
export const FILE_EXPLORER_TREE_UNSAFE_CSS = `
:host {
  font-family: inherit;
}
/* Zebra striping: rows are absolutely positioned at index * row-height inside
   the full-height virtualized list, so a repeating gradient on the list stays
   aligned with row parity regardless of which rows are mounted or scrolled. */
[data-file-tree-virtualized-list="true"] {
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent var(--trees-row-height),
    var(--orca-file-tree-zebra-stripe) var(--trees-row-height),
    var(--orca-file-tree-zebra-stripe) calc(var(--trees-row-height) * 2)
  );
}
/* Middle-truncation markers need an opaque backing to hide the clipped text
   under the ellipsis; --trees-bg is transparent here, so back with the
   sidebar surface the tree sits on. */
[data-type="item"] {
  --truncate-marker-background-color: var(--sidebar);
}
/* Rows inherit line-height = row height, so the marker's 1lh backing paints a
   full-height band that clashes with the zebra stripes; normal line-height
   shrinks it to text height. */
[data-type="item"] [data-truncate-container] {
  line-height: normal;
}
/* Selected rows always show the focused-style outline, not only on focus. */
[data-type="item"][data-item-selected="true"]::before {
  content: "";
  border-radius: var(--trees-border-radius);
  outline: var(--trees-focus-ring-width) solid var(--trees-selected-focused-border-color);
  outline-offset: var(--trees-focus-ring-offset);
  pointer-events: none;
  display: block;
  position: absolute;
  inset: 0;
}
`
