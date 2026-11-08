import { ipcMain, shell } from 'electron'
import { lstat, rm } from 'node:fs/promises'
import type { SshMutationExpectation } from '../../../shared/ssh-types'
import { assertSshMutationExpectation } from '../../ssh/connection/ssh-connection-generation'
import { SshHostNotServedError } from '../../providers/ssh-host-not-served-error'
import { tryDeleteWslUncPath } from '../../wsl-unc-delete'
import type { LocalFileAccess } from '../../../shared/local-file-access'
import {
  resolveDesktopAuthorizedPath,
  resolveLocalWriteRequestPath
} from '../local-file-access-resolution'
import { isENOENT } from './filesystem-path-containment'
import { registerFilesystemMutationHandlers } from './filesystem-mutations'
import { registerAgentSessionAttachmentUploadHandlers } from '../agent-session-attachment-upload-ipc'
import type { FilesystemHandlerContext } from './filesystem-handler-context'
import type {
  FileWriteDiskPrecondition,
  FileWriteResult
} from '../../../shared/file-write-disk-precondition'
import { writeLocalTextFileWithDiskPrecondition } from './local-disk-write-precondition'
import { windowsFsPath } from '../../wsl/wsl-unc-drive-fs-path'
import { TRASH_DELETE_FAILED_MESSAGE } from '../../../shared/trash-delete-failure'
import { deleteWithUnityMetaCompanion } from './unity-meta-companion'

export function registerFilesystemWriteHandlers(context: FilesystemHandlerContext): void {
  const { store } = context

  ipcMain.handle(
    'fs:writeFile',
    async (
      _event,
      args: {
        filePath: string
        content: string
        connectionId?: string
        access?: LocalFileAccess
        diskPrecondition?: FileWriteDiskPrecondition
      } & SshMutationExpectation
    ): Promise<FileWriteResult> => {
      assertSshMutationExpectation(
        args.connectionId,
        args.expectedSshTargetId,
        args.expectedSshConnectionGeneration,
        args.expectedExecutionHostId
      )
      if (args.connectionId) {
        throw new SshHostNotServedError(args.connectionId)
      }
      const filePath = await resolveLocalWriteRequestPath(args.filePath, args.access, store)
      try {
        const fileStats = await lstat(windowsFsPath(filePath))
        if (fileStats.isDirectory()) {
          throw new Error('Cannot write to a directory')
        }
      } catch (error) {
        if (!isENOENT(error)) {
          throw error
        }
      }
      return writeLocalTextFileWithDiskPrecondition(filePath, args.content, args.diskPrecondition)
    }
  )

  ipcMain.handle(
    'fs:deletePath',
    async (
      _event,
      args: {
        targetPath: string
        connectionId?: string
        recursive?: boolean
        permanent?: boolean
      } & SshMutationExpectation
    ): Promise<void> => {
      assertSshMutationExpectation(
        args.connectionId,
        args.expectedSshTargetId,
        args.expectedSshConnectionGeneration,
        args.expectedExecutionHostId
      )
      if (args.connectionId) {
        throw new SshHostNotServedError(args.connectionId)
      }
      // Delete the symlink entry, not a realpath target that may be outside allowed roots.
      const targetPath = await resolveDesktopAuthorizedPath(args.targetPath, store, {
        preserveSymlink: true
      })
      const deleteTarget = async (path: string, recursive?: boolean): Promise<void> => {
        // WSL UNC has no Recycle Bin; hard-delete inside the distro (#6415).
        if (await tryDeleteWslUncPath(path, { recursive })) {
          return
        }
        if (args.permanent === true) {
          await rm(windowsFsPath(path), { recursive: recursive === true, force: true })
          return
        }
        // Concurrent external deletion must leave UI deletion idempotent.
        try {
          await shell.trashItem(path)
        } catch (error) {
          if (isENOENT(error)) {
            return
          }
          // Tagged so the renderer can offer permanent deletion (e.g. drive with Recycle Bin disabled).
          const reason = error instanceof Error ? error.message : String(error)
          throw new Error(`${TRASH_DELETE_FAILED_MESSAGE}: ${reason}`)
        }
      }
      await (store.getSettings().unityIntegrationEnabled !== false
        ? deleteWithUnityMetaCompanion(targetPath, (path) => deleteTarget(path, args.recursive))
        : deleteTarget(targetPath, args.recursive))
    }
  )

  registerFilesystemMutationHandlers(store)
  registerAgentSessionAttachmentUploadHandlers()
}
