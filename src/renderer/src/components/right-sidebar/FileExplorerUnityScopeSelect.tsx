import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { FILE_EXPLORER_FULL_ROOT } from './file-explorer-display-root'
import type { FileExplorerUnityScope } from './use-file-explorer-unity-scope'

/** Compact Unity Project-window style root picker for the explorer header; nothing outside Unity workspaces. */
export function FileExplorerUnityScopeSelect({
  scope
}: {
  scope: Pick<FileExplorerUnityScope, 'options' | 'choice' | 'selectScope'>
}): React.JSX.Element | null {
  const { options, choice: value, selectScope: onValueChange } = scope
  if (!options) {
    return null
  }
  const wholeFolderLabel = translate(
    'auto.components.right.sidebar.FileExplorerUnityScopeSelect.wholeFolder',
    'Whole folder'
  )
  const controlLabel = translate(
    'auto.components.right.sidebar.FileExplorerUnityScopeSelect.label',
    'Explorer scope'
  )
  const selectedLabel =
    value === FILE_EXPLORER_FULL_ROOT
      ? wholeFolderLabel
      : (options.find((option) => option.value === value)?.label ?? value)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="max-w-[55%] shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={controlLabel}
            >
              <span className="truncate">{selectedLabel}</span>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {controlLabel}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" collisionPadding={8} className="min-w-[10rem]">
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value={FILE_EXPLORER_FULL_ROOT}>
            {wholeFolderLabel}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
