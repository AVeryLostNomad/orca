import type React from 'react'
import { getFileTypeIcon } from '@/lib/file-type-icons'
import { FilePathCursorTooltip, splitTrailingSegment } from '@/components/file-path-cursor-tooltip'

/** Row body for a workspace file result (absorbed from QuickOpen). */
export function PaletteFileRow({ path }: { path: string }): React.JSX.Element {
  const { directory, filename } = splitTrailingSegment(path)
  const FileIcon = getFileTypeIcon(path)
  return (
    // Why: the trigger is this inner element, not the CommandItem. cmdk sets
    // its own onPointerMove after spreading props, which drops the one Radix
    // needs to open the tooltip.
    <FilePathCursorTooltip path={path}>
      <div className="flex w-full min-w-0 items-center gap-2 px-3 py-1">
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
        {/* shrink-0 + max-w-full: the directory gives up all of its width
            before the filename loses a character. */}
        <span className="min-w-0 max-w-full shrink-0 truncate text-foreground">{filename}</span>
        {directory ? (
          <span className="min-w-0 truncate text-muted-foreground">{directory}</span>
        ) : null}
      </div>
    </FilePathCursorTooltip>
  )
}
