import { defineMethod } from '../core'
import {
  GitStashPush,
  GitStashSha,
  WorktreeSelector
} from '../../../../shared/rpc-contract/git-params'

export const GIT_STASH_METHODS = [
  defineMethod({
    name: 'git.stashList',
    permission: 'workspace',
    params: WorktreeSelector,
    handler: async (params, { runtime }) => runtime.listRuntimeGitStashes(params.worktree)
  }),
  defineMethod({
    name: 'git.stashFiles',
    permission: 'workspace',
    params: GitStashSha,
    handler: async (params, { runtime }) =>
      runtime.listRuntimeGitStashFiles(params.worktree, params.sha)
  }),
  defineMethod({
    name: 'git.stashPush',
    permission: 'workspace',
    params: GitStashPush,
    handler: async (params, { runtime }) =>
      runtime.pushRuntimeGitStash(params.worktree, params.request)
  }),
  defineMethod({
    name: 'git.stashApply',
    permission: 'workspace',
    params: GitStashSha,
    handler: async (params, { runtime }) =>
      runtime.applyRuntimeGitStash(params.worktree, params.sha)
  }),
  defineMethod({
    name: 'git.stashDrop',
    permission: 'workspace',
    params: GitStashSha,
    handler: async (params, { runtime }) => runtime.dropRuntimeGitStash(params.worktree, params.sha)
  })
]
