import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatSubmodulePushFailureDetail,
  isDivergentPullReconciliationError,
  isNoUpstreamError,
  isStaleInfoPushRejection,
  MERGE_RECONCILIATION_PULL_ARGS,
  normalizeGitErrorMessage,
  pullArgsSpecifyReconciliation,
  pushTargetRemoteBranchExists,
  runPullWithDivergenceFallback,
  runPushWithDeletedRemoteBranchFallback
} from './git-remote-error'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('normalizeGitErrorMessage', () => {
  it('keeps the submodule name when a recursive push is rejected', () => {
    const error = new Error(
      "Command failed: git push\nPushing submodule 'find-cmux-followers'\n" +
        'To https://github.com/stablyai/orca-internal\n' +
        ' ! [rejected]        master -> master (fetch first)\n' +
        "Unable to push submodule 'find-cmux-followers'\n" +
        'fatal: failed to push all needed submodules'
    )

    expect(normalizeGitErrorMessage(error, 'push')).toBe(
      "Submodule 'find-cmux-followers' has remote changes. Pull inside the submodule, then try again."
    )
  })

  it('preserves redacted pre-push hook output instead of the generic git tail line', () => {
    const error = new Error(
      [
        'Command failed: git push https://x-access-token:ghp_secret@github.com/acme/repo.git HEAD',
        'husky - pre-push hook failed',
        'eslint found 2 errors',
        "error: failed to push some refs to 'https://ghp_tailSecret@github.com/acme/repo.git'"
      ].join('\n')
    )

    const message = normalizeGitErrorMessage(error, 'push')

    expect(message).toContain('husky - pre-push hook failed')
    expect(message).toContain('eslint found 2 errors')
    expect(message).toContain(
      "error: failed to push some refs to 'https://github.com/acme/repo.git'"
    )
    expect(message).not.toContain('x-access-token')
    expect(message).not.toContain('ghp_secret')
    expect(message).not.toContain('ghp_tailSecret')
  })

  it('does not preserve remote pre-receive output as a push hook failure', () => {
    const error = new Error(
      [
        'Command failed: git push origin main',
        'remote: pre-receive hook declined',
        'remote: eslint failed in hosted checks',
        "error: failed to push some refs to 'origin'"
      ].join('\n')
    )

    expect(normalizeGitErrorMessage(error, 'push')).toBe(
      "error: failed to push some refs to 'origin'"
    )
  })

  it('explains how to configure a pull policy for divergent branches', () => {
    const error = new Error(
      'Command failed: git pull\n' +
        'hint: You have divergent branches and need to specify how to reconcile them.\n' +
        'fatal: Need to specify how to reconcile divergent branches.'
    )

    expect(normalizeGitErrorMessage(error, 'pull')).toBe(
      'Pull needs a Git pull policy for divergent branches. Configure one for this repository ' +
        'or host, then try again: git config pull.rebase false (merge), ' +
        'git config pull.rebase true (rebase), or git config pull.ff only (fast-forward only).'
    )
  })

  it('uses the tail diagnostic from newline-heavy failures without line-array splitting', () => {
    const splitSpy = vi.spyOn(String.prototype, 'split')
    const error = new Error(
      `Command failed: git fetch\r\n${'remote: progress update\r\n'.repeat(10_000)}remote side closed connection\r\n`
    )

    expect(normalizeGitErrorMessage(error, 'fetch')).toBe('remote side closed connection')

    const usedLineSplit = splitSpy.mock.calls.some(
      ([separator]) =>
        (typeof separator === 'string' && separator === '\n') ||
        (separator instanceof RegExp && separator.source === '\\r?\\n')
    )
    expect(usedLineSplit).toBe(false)
  })
})

describe('formatSubmodulePushFailureDetail', () => {
  it('keeps normalized guidance when transport layers prefix the error', () => {
    expect(
      formatSubmodulePushFailureDetail(
        "Error invoking remote method 'git:push': Error: Submodule 'vendor/tools' has remote changes. Pull inside the submodule, then try again."
      )
    ).toBe(
      "Submodule 'vendor/tools' has remote changes. Pull inside the submodule, then try again."
    )
  })

  it('falls back to submodule-specific guidance when git omits the nested reason', () => {
    expect(
      formatSubmodulePushFailureDetail(
        "Unable to push submodule 'vendor/tools'\nfatal: failed to push all needed submodules"
      )
    ).toBe(
      "Submodule 'vendor/tools' could not be pushed. Resolve the submodule push error, then try again."
    )
  })

  it('checks newline-heavy output without full CRLF normalization', () => {
    const replaceSpy = vi.spyOn(String.prototype, 'replace')
    const message = `${'remote: progress\r\n'.repeat(10_000)}Unable to push submodule 'vendor/tools'\r\nfatal: failed to push all needed submodules\r\n`

    expect(formatSubmodulePushFailureDetail(message)).toBe(
      "Submodule 'vendor/tools' could not be pushed. Resolve the submodule push error, then try again."
    )

    const usedCrlfReplace = replaceSpy.mock.calls.some(
      ([pattern]) => pattern instanceof RegExp && pattern.source === '\\r\\n'
    )
    expect(usedCrlfReplace).toBe(false)
  })
})

describe('isNoUpstreamError', () => {
  it('treats a missing HEAD@{u} tracking ref as no upstream', () => {
    const error = new Error(
      "fatal: ambiguous argument 'HEAD@{u}': unknown revision or path not in the working tree.\n" +
        "Use '--' to separate paths from revisions, like this:\n" +
        "'git <command> [<revision>...] -- [<file>...]'"
    )

    expect(isNoUpstreamError(error)).toBe(true)
  })

  it('does not treat unrelated ambiguous refs as no upstream', () => {
    const error = new Error(
      "fatal: ambiguous argument 'feature': unknown revision or path not in the working tree."
    )

    expect(isNoUpstreamError(error)).toBe(false)
  })
})

describe('isDivergentPullReconciliationError', () => {
  it('detects git 2.27+ divergent-branch reconciliation failures', () => {
    const error = new Error(
      'Command failed: git pull\n' +
        'hint: You have divergent branches and need to specify how to reconcile them.\n' +
        'fatal: Need to specify how to reconcile divergent branches.'
    )

    expect(isDivergentPullReconciliationError(error)).toBe(true)
  })

  it('does not match a fast-forward-only abort on divergent branches', () => {
    const error = new Error(
      'Command failed: git pull\nfatal: Not possible to fast-forward, aborting.'
    )

    expect(isDivergentPullReconciliationError(error)).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isDivergentPullReconciliationError('divergent branches')).toBe(false)
  })
})

describe('pullArgsSpecifyReconciliation', () => {
  it('is false when no strategy flag is present', () => {
    expect(pullArgsSpecifyReconciliation([])).toBe(false)
    expect(pullArgsSpecifyReconciliation(['origin', 'main'])).toBe(false)
  })

  it('is true for any explicit reconciliation flag', () => {
    expect(pullArgsSpecifyReconciliation(['--ff-only'])).toBe(true)
    expect(pullArgsSpecifyReconciliation(['--rebase'])).toBe(true)
    expect(pullArgsSpecifyReconciliation(['--no-rebase'])).toBe(true)
    expect(pullArgsSpecifyReconciliation(['--rebase=interactive'])).toBe(true)
    expect(pullArgsSpecifyReconciliation(['-r'])).toBe(true)
  })
})

describe('runPullWithDivergenceFallback', () => {
  const divergentError = new Error(
    'Command failed: git pull\n' +
      'hint: You have divergent branches and need to specify how to reconcile them.\n' +
      'fatal: Need to specify how to reconcile divergent branches.'
  )

  it('retries with merge reconciliation args on a policy error', async () => {
    const calls: string[][] = []
    const runPull = vi.fn(async (effectiveArgs: string[]) => {
      calls.push(effectiveArgs)
      if (effectiveArgs.length === 0) {
        throw divergentError
      }
    })

    await runPullWithDivergenceFallback([], runPull)

    expect(calls).toEqual([[], [...MERGE_RECONCILIATION_PULL_ARGS]])
    expect(runPull).toHaveBeenCalledTimes(2)
  })

  it('does not retry when pull args already specify reconciliation', async () => {
    const runPull = vi.fn(async () => {
      throw divergentError
    })

    await expect(runPullWithDivergenceFallback(['--ff-only'], runPull)).rejects.toBe(divergentError)
    expect(runPull).toHaveBeenCalledTimes(1)
    expect(runPull).toHaveBeenCalledWith(['--ff-only'])
  })

  it('rethrows non-divergence errors without retrying', async () => {
    const otherError = new Error('fatal: Not possible to fast-forward, aborting.')
    const runPull = vi.fn(async () => {
      throw otherError
    })

    await expect(runPullWithDivergenceFallback([], runPull)).rejects.toBe(otherError)
    expect(runPull).toHaveBeenCalledTimes(1)
  })
})

describe('stale-info push rejection', () => {
  const staleInfoError = new Error(
    'Command failed: git push --force-with-lease --set-upstream origin HEAD:feature\n' +
      'To github.com:me/repo.git\n' +
      ' ! [rejected]        HEAD -> feature (stale info)\n' +
      "error: failed to push some refs to 'github.com:me/repo.git'"
  )

  it('detects the lease rejection line', () => {
    expect(isStaleInfoPushRejection(staleInfoError)).toBe(true)
    expect(isStaleInfoPushRejection(new Error('fatal: unrelated'))).toBe(false)
    expect(isStaleInfoPushRejection('stale info')).toBe(false)
  })

  it('normalizes to actionable fetch guidance', () => {
    expect(normalizeGitErrorMessage(staleInfoError, 'push')).toBe(
      'Push rejected: the remote branch changed since your last fetch (stale info). Fetch and try again.'
    )
  })

  it('retries a lease push as a plain push when the remote branch is gone', async () => {
    const leases: boolean[] = []
    const runPush = vi.fn(async (forceWithLease: boolean) => {
      leases.push(forceWithLease)
      if (forceWithLease) {
        throw staleInfoError
      }
    })

    await runPushWithDeletedRemoteBranchFallback(runPush, {
      forceWithLease: true,
      remoteBranchExists: async () => false
    })

    expect(leases).toEqual([true, false])
  })

  it('surfaces the lease rejection when the remote branch still exists', async () => {
    const runPush = vi.fn(async () => {
      throw staleInfoError
    })

    await expect(
      runPushWithDeletedRemoteBranchFallback(runPush, {
        forceWithLease: true,
        remoteBranchExists: async () => true
      })
    ).rejects.toBe(staleInfoError)
    expect(runPush).toHaveBeenCalledTimes(1)
  })

  it('surfaces the lease rejection when existence cannot be verified', async () => {
    const runPush = vi.fn(async () => {
      throw staleInfoError
    })

    await expect(
      runPushWithDeletedRemoteBranchFallback(runPush, {
        forceWithLease: true,
        remoteBranchExists: async () => null
      })
    ).rejects.toBe(staleInfoError)
    expect(runPush).toHaveBeenCalledTimes(1)
  })

  it('does not retry non-lease pushes', async () => {
    const runPush = vi.fn(async () => {
      throw staleInfoError
    })

    await expect(
      runPushWithDeletedRemoteBranchFallback(runPush, {
        forceWithLease: false,
        remoteBranchExists: async () => false
      })
    ).rejects.toBe(staleInfoError)
    expect(runPush).toHaveBeenCalledTimes(1)
  })
})

describe('pushTargetRemoteBranchExists', () => {
  it('checks the refspec branch on the target remote', async () => {
    const exec = vi.fn(async (args: string[]) => {
      expect(args).toEqual(['ls-remote', '--heads', 'fork', 'refs/heads/feature'])
      return { stdout: 'abc123\trefs/heads/feature\n' }
    })

    expect(
      await pushTargetRemoteBranchExists(exec, { remote: 'fork', refspec: 'HEAD:feature' })
    ).toBe(true)
  })

  it('resolves HEAD to the current branch for the origin fallback', async () => {
    const exec = vi.fn(async (args: string[]) => {
      if (args[0] === 'symbolic-ref') {
        return { stdout: 'feature\n' }
      }
      expect(args).toEqual(['ls-remote', '--heads', 'origin', 'refs/heads/feature'])
      return { stdout: '' }
    })

    expect(await pushTargetRemoteBranchExists(exec, null)).toBe(false)
  })

  it('returns null when the existence check itself fails', async () => {
    const exec = vi.fn(async () => {
      throw new Error('network down')
    })

    expect(await pushTargetRemoteBranchExists(exec, { remote: 'origin', refspec: 'HEAD:x' })).toBe(
      null
    )
  })
})
