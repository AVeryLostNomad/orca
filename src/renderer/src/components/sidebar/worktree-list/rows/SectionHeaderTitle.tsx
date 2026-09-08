import type React from 'react'
import { cn } from '@/lib/utils'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { RepoForkIndicator } from '@/components/repo/repo-fork-indicator'
import { resolveProjectHeaderTextColor } from '../../project-header-color'
import type { FolderWorkspacePathStatus } from '../../../../../../shared/folder-workspace-path-status'
import type { GroupHeaderRow } from '../grouping/row-types'
import { FolderPathStatusIndicator } from './FolderPathStatusIndicator'
import { RepoScanUnavailableIndicator } from './RepoScanUnavailableIndicator'

export function SectionHeaderTitle({
  row,
  repoHeaderColor,
  projectGroupColor,
  projectGroupPathStatus,
  isRepoHeader,
  isProjectGroupHeader
}: {
  row: GroupHeaderRow
  repoHeaderColor: string | undefined
  projectGroupColor: string | undefined
  projectGroupPathStatus: FolderWorkspacePathStatus | null
  isRepoHeader: boolean
  isProjectGroupHeader: boolean
}): React.JSX.Element {
  const projectGroupIcon =
    isProjectGroupHeader && row.projectGroup && 'icon' in row.projectGroup
      ? row.projectGroup.icon
      : null
  const headerTextColor = resolveProjectHeaderTextColor(
    row.repo ? repoHeaderColor : projectGroupColor
  )
  return (
    <>
      {row.icon ? (
        <div
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-[4px]',
            row.repo && repoHeaderColor
              ? 'text-muted-foreground'
              : projectGroupColor
                ? undefined
                : row.tone
          )}
          style={projectGroupColor ? { color: projectGroupColor } : undefined}
        >
          {row.repo ? (
            <RepoIconGlyph
              repoIcon={row.repo.repoIcon}
              color={repoHeaderColor}
              className="size-4"
              iconClassName="size-3.5"
            />
          ) : projectGroupIcon ? (
            <RepoIconGlyph
              repoIcon={projectGroupIcon}
              color={projectGroupColor}
              className="size-4"
              iconClassName="size-3.5"
            />
          ) : (
            <row.icon className="size-3" />
          )}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <div
            className="min-w-0 truncate text-[13px] font-semibold leading-none"
            style={headerTextColor ? { color: headerTextColor } : undefined}
          >
            {row.label}
          </div>
          <RepoForkIndicator upstream={row.repo?.upstream} />
          <FolderPathStatusIndicator status={projectGroupPathStatus} />
          {isRepoHeader ? <RepoScanUnavailableIndicator repo={row.repo!} /> : null}
        </div>
      </div>
    </>
  )
}
