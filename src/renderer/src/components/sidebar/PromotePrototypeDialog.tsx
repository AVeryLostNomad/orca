import React, { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { formatGithubAccountRef } from '../../../../shared/github/github-account-ref'
import type { PrototypeGithubVisibility } from '../../../../shared/prototype-types'
import { joinCreateProjectPath } from './create-project-defaults'
import { promotePrototypeToProject } from './prototype-actions'
import { useCreateProjectGithubAccount } from './useCreateProjectGithubAccount'

function toProjectDirName(displayName: string): string {
  return displayName.trim().toLowerCase().replace(/\s+/g, '-')
}

const PromotePrototypeDialog = React.memo(function PromotePrototypeDialog() {
  const activeModal = useAppStore((s) => s.activeModal)
  const modalData = useAppStore((s) => s.modalData)
  const closeModal = useAppStore((s) => s.closeModal)
  const repoId = typeof modalData.repoId === 'string' ? modalData.repoId : ''
  const prototypeName = useAppStore(
    (s) => s.repos.find((repo) => repo.id === repoId && repo.isPrototype)?.displayName ?? ''
  )
  const isOpen = activeModal === 'promote-prototype'

  const [name, setName] = useState(() => toProjectDirName(prototypeName))
  const [parentPath, setParentPath] = useState('')
  const [publishToGithub, setPublishToGithub] = useState(true)
  const [visibility, setVisibility] = useState<PrototypeGithubVisibility>('private')
  const [error, setError] = useState<string | null>(null)
  const [isPromoting, setIsPromoting] = useState(false)
  const { githubAccounts, githubAccountsLoading, githubAccountRef, setGithubAccountRef } =
    useCreateProjectGithubAccount()
  const hasGithubAccount = githubAccounts.length > 0

  useEffect(() => {
    let cancelled = false
    void window.api.repos.getDefaultCreateProjectParent().then((parent) => {
      if (!cancelled) {
        setParentPath((current) => current || parent)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleBrowse = useCallback(async () => {
    const dir = await window.api.repos.pickDirectory()
    if (dir) {
      setParentPath(dir)
      setError(null)
    }
  }, [])

  const willPublish = publishToGithub && hasGithubAccount
  const canSubmit =
    Boolean(repoId) &&
    name.trim().length > 0 &&
    parentPath.trim().length > 0 &&
    !isPromoting &&
    !(willPublish && (githubAccountsLoading || !githubAccountRef))

  const handlePromote = useCallback(async () => {
    if (!canSubmit) {
      return
    }
    setIsPromoting(true)
    setError(null)
    try {
      const result = await promotePrototypeToProject({
        repoId,
        parentPath,
        name,
        publishToGithub: willPublish,
        githubVisibility: visibility,
        githubAccountRef: willPublish ? githubAccountRef : null
      })
      if ('error' in result) {
        setError(result.error)
        return
      }
      closeModal()
    } catch (err) {
      setError(extractIpcErrorMessage(err, String(err)))
    } finally {
      setIsPromoting(false)
    }
  }, [canSubmit, closeModal, githubAccountRef, name, parentPath, repoId, visibility, willPublish])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !isPromoting) {
        closeModal()
      }
    },
    [closeModal, isPromoting]
  )

  const targetPreview = parentPath.trim()
    ? joinCreateProjectPath(parentPath, name.trim() || 'project-name')
    : ''

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate(
              'auto.components.sidebar.PromotePrototypeDialog.title',
              'Promote to Project'
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'auto.components.sidebar.PromotePrototypeDialog.description',
              'Moves {{name}} out of the prototypes folder and keeps it as a regular project. Its open terminals will close.',
              { name: prototypeName }
            )}
          </DialogDescription>
        </DialogHeader>

        <form
          className="min-w-0 space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void handlePromote()
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="promote-prototype-name">
              {translate('auto.components.sidebar.PromotePrototypeDialog.name', 'Name')}
            </Label>
            <Input
              id="promote-prototype-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
              className="font-mono"
              disabled={isPromoting}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="promote-prototype-location">
              {translate('auto.components.sidebar.PromotePrototypeDialog.location', 'Location')}
            </Label>
            <div className="flex gap-2">
              <Input
                id="promote-prototype-location"
                value={parentPath}
                onChange={(event) => {
                  setParentPath(event.target.value)
                  setError(null)
                }}
                className="min-w-0 flex-1 font-mono"
                disabled={isPromoting}
                spellCheck={false}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleBrowse()}
                disabled={isPromoting}
              >
                {translate('auto.components.sidebar.PromotePrototypeDialog.browse', 'Browse…')}
              </Button>
            </div>
            {targetPreview ? (
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {targetPreview}
              </p>
            ) : null}
          </div>

          {githubAccountsLoading ? (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {translate(
                'auto.components.sidebar.AddRepoCreateStep.github_accounts_checking',
                'Checking GitHub accounts…'
              )}
            </p>
          ) : hasGithubAccount ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="promote-prototype-publish"
                  checked={publishToGithub}
                  onCheckedChange={(checked) => setPublishToGithub(checked === true)}
                  disabled={isPromoting}
                />
                <Label htmlFor="promote-prototype-publish" className="font-normal">
                  {translate(
                    'auto.components.sidebar.PromotePrototypeDialog.publish',
                    'Create a GitHub repository and push'
                  )}
                </Label>
              </div>
              {publishToGithub ? (
                <div className="flex gap-2 pl-6">
                  {githubAccounts.length > 1 ? (
                    <Select
                      value={githubAccountRef ?? undefined}
                      onValueChange={setGithubAccountRef}
                      disabled={isPromoting}
                    >
                      <SelectTrigger className="min-w-0 flex-1" size="sm">
                        <SelectValue
                          placeholder={translate(
                            'auto.components.sidebar.AddRepoCreateStep.github_account_placeholder',
                            'Choose an account'
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {githubAccounts.map((account) => {
                          const ref = formatGithubAccountRef({
                            kind: 'gh-cli',
                            host: account.host,
                            user: account.user
                          })
                          return (
                            <SelectItem key={ref} value={ref}>
                              {account.user} ({account.host})
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  ) : null}
                  <Select
                    value={visibility}
                    onValueChange={(value) => setVisibility(value as PrototypeGithubVisibility)}
                    disabled={isPromoting}
                  >
                    <SelectTrigger className="w-28" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="private">
                        {translate(
                          'auto.components.sidebar.PromotePrototypeDialog.private',
                          'Private'
                        )}
                      </SelectItem>
                      <SelectItem value="public">
                        {translate(
                          'auto.components.sidebar.PromotePrototypeDialog.public',
                          'Public'
                        )}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {translate(
                'auto.components.sidebar.PromotePrototypeDialog.noGithub',
                'Connect a GitHub account with `gh auth login` to publish automatically.'
              )}
            </p>
          )}

          {error ? <p className="text-xs break-words text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={isPromoting}
            >
              {translate('auto.components.sidebar.PromotePrototypeDialog.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isPromoting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {translate('auto.components.sidebar.PromotePrototypeDialog.promote', 'Promote')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
})

export default PromotePrototypeDialog
