import type { Repo } from '../../shared/repo-types'
import type {
  PreflightPrototypePromotionResult,
  PromotePrototypeArgs,
  PromotePrototypeResult,
  PrototypePromotionTarget
} from '../../shared/prototype-types'

export type PrototypesApi = {
  create: () => Promise<{ repo: Repo } | { error: string }>
  preflightPromote: (
    args: PrototypePromotionTarget & { repoId: string }
  ) => Promise<PreflightPrototypePromotionResult>
  promote: (args: PromotePrototypeArgs) => Promise<PromotePrototypeResult>
  deleteFiles: (args: { path: string }) => Promise<{ warnings: string[] } | { error: string }>
}
