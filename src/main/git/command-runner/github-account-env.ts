import { addWslEnvKeys } from '../../wsl-env'
import { appendGitConfigEnv } from './git-process-env'

export type GitAccountCredential = { ref: string; token: string; host: string }
export type GitAccountCommitIdentity = { name: string; email: string }

type GitAccountCredentialResolver = (
  cwd: string | undefined
) => Promise<GitAccountCredential | null>
type GitAccountIdentityResolver = (
  cwd: string | undefined
) => Promise<GitAccountCommitIdentity | null>
type GhAccountEnvResolver = (
  cwd: string | undefined
) => Promise<{ ref: string; token: string } | null>

let gitAccountCredentialResolver: GitAccountCredentialResolver | null = null
let gitAccountTokenInvalidator: ((ref: string) => void) | null = null
let gitAccountIdentityResolver: GitAccountIdentityResolver | null = null
let ghAccountEnvResolver: GhAccountEnvResolver | null = null
let ghAccountTokenInvalidator: ((ref: string) => void) | null = null

export function setGitAccountCredentialResolver(
  resolver: GitAccountCredentialResolver | null,
  invalidator?: (ref: string) => void
): void {
  gitAccountCredentialResolver = resolver
  gitAccountTokenInvalidator = invalidator ?? null
}

export function setGitAccountIdentityResolver(resolver: GitAccountIdentityResolver | null): void {
  gitAccountIdentityResolver = resolver
}

export function setGhAccountEnvResolver(
  resolver: GhAccountEnvResolver | null,
  invalidator?: (ref: string) => void
): void {
  ghAccountEnvResolver = resolver
  ghAccountTokenInvalidator = invalidator ?? null
}

const NETWORK_GIT_SUBCOMMANDS: Record<string, true> = {
  push: true,
  pull: true,
  fetch: true,
  clone: true,
  'ls-remote': true
}
const COMMIT_IDENTITY_GIT_SUBCOMMANDS: Record<string, true> = {
  commit: true,
  merge: true,
  rebase: true,
  'cherry-pick': true,
  revert: true,
  am: true,
  pull: true,
  tag: true,
  stash: true
}

function leadingGitSubcommand(args: readonly string[]): string | null {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '-c' || arg === '-C') {
      index++
      continue
    }
    if (!arg.startsWith('-')) {
      return arg
    }
  }
  return null
}

export function gitNetworkSubcommand(args: readonly string[]): string | null {
  const subcommand = leadingGitSubcommand(args)
  return subcommand !== null && NETWORK_GIT_SUBCOMMANDS[subcommand] === true ? subcommand : null
}

export function gitCommitIdentitySubcommand(args: readonly string[]): string | null {
  const subcommand = leadingGitSubcommand(args)
  return subcommand !== null && COMMIT_IDENTITY_GIT_SUBCOMMANDS[subcommand] === true
    ? subcommand
    : null
}

export const GIT_IDENTITY_ENV_KEYS = [
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL'
] as const

function callerProvidesGitIdentityEnv(env: NodeJS.ProcessEnv | undefined): boolean {
  return GIT_IDENTITY_ENV_KEYS.some((key) => env?.[key] !== undefined)
}

const PINNED_GH_CREDENTIAL_HELPER =
  '!f() { if [ "$1" = get ]; then printf \'username=x-access-token\\npassword=%s\\n\' "$ORCA_PINNED_GH_TOKEN"; fi; }; f'
const GIT_CONFIG_WSLENV_KEY_RE = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/

type ResolvedGitAccount = {
  credential: GitAccountCredential | null
  identity: GitAccountCommitIdentity | null
}

const NO_GIT_ACCOUNT: ResolvedGitAccount = { credential: null, identity: null }

/** Synchronous when no lookup applies, so ordinary git calls reach admission without an extra tick. */
export function resolveGitAccountForCommand(
  args: readonly string[],
  cwd: string | undefined,
  callerEnv: NodeJS.ProcessEnv | undefined
): ResolvedGitAccount | Promise<ResolvedGitAccount> {
  const credentialResolver =
    gitAccountCredentialResolver && gitNetworkSubcommand(args) ? gitAccountCredentialResolver : null
  const identityResolver =
    gitAccountIdentityResolver &&
    gitCommitIdentitySubcommand(args) &&
    !callerProvidesGitIdentityEnv(callerEnv)
      ? gitAccountIdentityResolver
      : null
  if (!credentialResolver && !identityResolver) {
    return NO_GIT_ACCOUNT
  }
  return (async () => ({
    credential: credentialResolver ? await credentialResolver(cwd) : null,
    identity: identityResolver ? await identityResolver(cwd) : null
  }))()
}

type GitAccountEnv = { account: ResolvedGitAccount; env: NodeJS.ProcessEnv }

/** The pinned account plus the env carrying it; synchronous when no lookup applies. */
export function gitAccountEnvForCommand(
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
  baseEnv: NodeJS.ProcessEnv
): GitAccountEnv | Promise<GitAccountEnv> {
  const pending = resolveGitAccountForCommand(args, options.cwd, options.env)
  const withEnv = (account: ResolvedGitAccount): GitAccountEnv => ({
    account,
    env: applyGitAccountEnv(baseEnv, account)
  })
  return pending instanceof Promise ? pending.then(withEnv) : withEnv(pending)
}

export function invalidateGitAccountOnAuthFailure(
  error: unknown,
  account: ResolvedGitAccount
): void {
  if (isGitAuthFailure(error)) {
    invalidateGitAccountTokenForAuthFailure(account)
  }
}

export function applyGitAccountEnv(
  env: NodeJS.ProcessEnv,
  account: ResolvedGitAccount
): NodeJS.ProcessEnv {
  let next = env
  if (account.credential) {
    const urlKey = `credential.https://${account.credential.host}`
    // Token stays in the environment; it is never copied into argv or a Git config value.
    next = appendGitConfigEnv({ ...next, ORCA_PINNED_GH_TOKEN: account.credential.token }, [
      [`${urlKey}.helper`, ''],
      [`${urlKey}.helper`, PINNED_GH_CREDENTIAL_HELPER]
    ])
    if (process.platform === 'win32') {
      addWslEnvKeys(next, [
        'ORCA_PINNED_GH_TOKEN',
        ...Object.keys(next).filter((key) => GIT_CONFIG_WSLENV_KEY_RE.test(key))
      ])
    }
  }
  if (account.identity) {
    next = {
      ...next,
      GIT_AUTHOR_NAME: account.identity.name,
      GIT_AUTHOR_EMAIL: account.identity.email,
      GIT_COMMITTER_NAME: account.identity.name,
      GIT_COMMITTER_EMAIL: account.identity.email
    }
    if (process.platform === 'win32') {
      addWslEnvKeys(next, GIT_IDENTITY_ENV_KEYS)
    }
  }
  return next
}

export function isGitAuthFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const { message, stderr } = error as { message?: unknown; stderr?: unknown }
  const text = `${typeof message === 'string' ? message : ''}\n${typeof stderr === 'string' ? stderr : ''}`
  return /Authentication failed|could not read Username|invalid credentials|HTTP 401/i.test(text)
}

export function invalidateGitAccountTokenForAuthFailure(account: ResolvedGitAccount): void {
  if (account.credential) {
    gitAccountTokenInvalidator?.(account.credential.ref)
  }
}

export type GhAccountInjectionOptions = {
  accountCwdHint?: string
  skipAccountEnv?: boolean
  env?: NodeJS.ProcessEnv
}

export function ghAccountInjectionAllowed(
  args: readonly string[],
  options: GhAccountInjectionOptions
): boolean {
  return (
    !options.skipAccountEnv &&
    args[0] !== 'auth' &&
    options.env?.GH_TOKEN === undefined &&
    options.env?.GITHUB_TOKEN === undefined
  )
}

/** Returns null synchronously when no lookup applies, so unbound gh calls still spawn without a tick. */
export function resolveGhAccountForCommand(
  args: readonly string[],
  options: GhAccountInjectionOptions & { cwd?: string }
): Promise<{ ref: string; token: string } | null> | null {
  if (!ghAccountEnvResolver || !ghAccountInjectionAllowed(args, options)) {
    return null
  }
  return ghAccountEnvResolver(options.cwd ?? options.accountCwdHint)
}

export function applyGhAccountEnv(
  env: NodeJS.ProcessEnv,
  account: { ref: string; token: string } | null
): NodeJS.ProcessEnv {
  if (!account) {
    return env
  }
  const next = { ...env, GH_TOKEN: account.token }
  addWslEnvKeys(next, ['GH_TOKEN'])
  return next
}

export function ghAccountRateLimitScope(account: { ref: string } | null): string | null {
  return account?.ref ?? null
}

export async function refreshGhAccountAfterAuthFailure(
  account: { ref: string; token: string },
  args: readonly string[],
  options: GhAccountInjectionOptions & { cwd?: string }
): Promise<{ ref: string; token: string } | null> {
  ghAccountTokenInvalidator?.(account.ref)
  return await resolveGhAccountForCommand(args, options)
}
