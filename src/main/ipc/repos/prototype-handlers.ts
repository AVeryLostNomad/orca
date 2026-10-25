import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import type {
  PromotePrototypeArgs,
  PrototypePromotionTarget
} from '../../../shared/prototype-types'
import { createPrototype } from '../../prototypes/prototype-provisioning'
import { preflightPrototypePromotion, promotePrototype } from '../../prototypes/prototype-promotion'
import { deletePrototypeFiles } from '../../prototypes/prototype-removal'
import { invalidateAuthorizedRootsCache } from '../registered-worktree-roots-cache'
import { notifyReposChanged } from './repos-changed-notification'

export const PROTOTYPE_IPC_CHANNELS = [
  'prototypes:create',
  'prototypes:preflightPromote',
  'prototypes:promote',
  'prototypes:deleteFiles'
] as const

export function registerPrototypeHandlers(mainWindow: BrowserWindow, store: Store): void {
  const afterCatalogChange = (): void => {
    invalidateAuthorizedRootsCache()
    notifyReposChanged(mainWindow)
  }

  ipcMain.handle('prototypes:create', async () => {
    const result = await createPrototype(store)
    if ('repo' in result) {
      afterCatalogChange()
    }
    return result
  })

  ipcMain.handle(
    'prototypes:preflightPromote',
    (_event, args: PrototypePromotionTarget & { repoId: string }) =>
      preflightPrototypePromotion(store, args)
  )

  ipcMain.handle('prototypes:promote', async (_event, args: PromotePrototypeArgs) => {
    const result = await promotePrototype(store, args)
    afterCatalogChange()
    return result
  })

  ipcMain.handle('prototypes:deleteFiles', (_event, args: { path: string }) =>
    deletePrototypeFiles(store, args.path)
  )
}
