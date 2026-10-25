import type { Repo } from './repo-types'

export type PrototypeGithubVisibility = 'private' | 'public'

export type PrototypePromotionTarget = {
  parentPath: string
  name: string
}

export type PreflightPrototypePromotionResult =
  | { sourcePath: string; targetPath: string }
  | { error: string }

/** Runs after the renderer removed the prototype, so it is addressed by path, not repo id. */
export type PromotePrototypeArgs = PrototypePromotionTarget & {
  sourcePath: string
  prototypeDisplayName: string
  /** Create a GitHub repository with `gh` and push the current branch to it. */
  publishToGithub: boolean
  githubVisibility?: PrototypeGithubVisibility
  githubAccountRef?: string
}

export type PromotePrototypeResult =
  | {
      repo: Repo
      githubUrl?: string
      /** Non-fatal follow-up failures (worktree repair, GitHub publish). */
      warnings: string[]
    }
  /** `restoredPrototype` is set when the move failed and the prototype was re-registered. */
  | { error: string; restoredPrototype?: Repo }
