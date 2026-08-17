import type { Repo } from '../../../../shared/repo-types'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { CodeServerImportModal } from '../code-server-pane/CodeServerImportModal'
import { useCodeServerImport } from '../code-server-pane/useCodeServerImport'
import { RepoSettingsDraftInput } from './RepositorySettingsDraftInput'
import { SearchableSetting } from './SearchableSetting'
import { isEmbeddedEditorSupported } from '@/lib/embedded-editor-support'
import { translate } from '@/i18n/i18n'

type RepositoryCodeServerWorkspaceUpdate = Pick<Repo, 'codeServerWorkspaceFile'>

type RepositoryCodeServerWorkspaceSectionProps = {
  repo: Repo
  updateRepo: (repoId: string, updates: Partial<RepositoryCodeServerWorkspaceUpdate>) => void
  forceVisible: boolean
}

// Normalize to a relative path (mirrors the persistence/IPC sanitizers) so a
// pasted absolute path can't escape each worktree's root at open time.
function normalizeWorkspaceFileInput(value: string): string | undefined {
  return value.trim().replace(/^[/\\]+/, '') || undefined
}

export function RepositoryCodeServerWorkspaceSection({
  repo,
  updateRepo,
  forceVisible
}: RepositoryCodeServerWorkspaceSectionProps): React.JSX.Element {
  // Import runs against the local desktop's editors; hide it where the
  // embedded editor itself is unavailable (web client).
  const importSupported = isEmbeddedEditorSupported()
  const importFlow = useCodeServerImport()
  const title = translate(
    'auto.components.settings.RepositoryCodeServerWorkspaceSection.5660fc5055',
    'VS Code Workspace File'
  )
  const importTitle = translate(
    'auto.components.settings.RepositoryCodeServerWorkspaceSection.31d390a5f5',
    'Editor Settings Import'
  )
  return (
    <>
      <SearchableSetting
        title={title}
        description={translate(
          'auto.components.settings.RepositoryCodeServerWorkspaceSection.aa02335b82',
          'Open a .code-workspace file in the embedded editor instead of the worktree folder.'
        )}
        keywords={[
          repo.displayName,
          'vscode',
          'code-server',
          'workspace',
          'code-workspace',
          'multi-root'
        ]}
        className="space-y-2"
        forceVisible={forceVisible}
      >
        <div className="flex items-center justify-between gap-3">
          <Label className="text-sm font-semibold">{title}</Label>
          {repo.codeServerWorkspaceFile ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => updateRepo(repo.id, { codeServerWorkspaceFile: undefined })}
            >
              {translate(
                'auto.components.settings.RepositoryCodeServerWorkspaceSection.b3f41cbfcc',
                'Clear'
              )}
            </Button>
          ) : null}
        </div>
        <RepoSettingsDraftInput
          repoId={repo.id}
          storeValue={repo.codeServerWorkspaceFile ?? ''}
          placeholder={translate(
            'auto.components.settings.RepositoryCodeServerWorkspaceSection.92cc086f07',
            'e.g. project.code-workspace'
          )}
          onTextChange={() => {}}
          onBlur={(e) => {
            const next = normalizeWorkspaceFileInput(e.currentTarget.value)
            if (next === (repo.codeServerWorkspaceFile?.trim() || undefined)) {
              return
            }
            updateRepo(repo.id, { codeServerWorkspaceFile: next })
          }}
          className="h-9 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.RepositoryCodeServerWorkspaceSection.ef15c3fb5d',
            'Relative to each worktree root. Leave empty to open the folder.'
          )}
        </p>
      </SearchableSetting>
      {importSupported && (
        <SearchableSetting
          title={importTitle}
          description={translate(
            'auto.components.settings.RepositoryCodeServerWorkspaceSection.0adbaf6498',
            'Use your VS Code or Cursor settings, keybindings, snippets, and extensions in the embedded editor.'
          )}
          keywords={['vscode', 'cursor', 'code-server', 'import', 'extensions', 'keybindings']}
          className="space-y-2"
          forceVisible={forceVisible}
        >
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm font-semibold">{importTitle}</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void importFlow.openImport()}
            >
              {translate(
                'auto.components.settings.RepositoryCodeServerWorkspaceSection.39cfd126b7',
                'Import from VS Code / Cursor…'
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.RepositoryCodeServerWorkspaceSection.17b8e0b02f',
              'Applies to the embedded editor in every repository.'
            )}
          </p>
          <CodeServerImportModal {...importFlow} />
        </SearchableSetting>
      )}
    </>
  )
}
