export type CommandBarMode = 'all' | 'files'

/** Reads the palette mode from modal data (Cmd+P opens the bar in file mode). */
export function parseCommandBarMode(modalData: Record<string, unknown> | null): CommandBarMode {
  return modalData?.paletteMode === 'files' ? 'files' : 'all'
}
