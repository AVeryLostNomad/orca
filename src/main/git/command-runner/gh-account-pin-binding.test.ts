import { afterEach, describe, expect, it } from 'vitest'
import { applyPinnedGhAccountBinding, setGhAccountBindingResolver } from './github-account-env'

const WORK = { host: 'github.com', user: 'work-login' }

describe('applyPinnedGhAccountBinding', () => {
  afterEach(() => {
    setGhAccountBindingResolver(null)
  })

  it('routes a keyring pin through the host-pinned bound-account path', () => {
    setGhAccountBindingResolver((cwd) => (cwd === '/repo' ? WORK : null))

    expect(applyPinnedGhAccountBinding(['pr', 'list'], { cwd: '/repo' })).toEqual({
      cwd: '/repo',
      ghAccount: WORK,
      skipAccountEnv: true,
      host: 'github.com'
    })
  })

  it('resolves the pin from the account hint for cwd-less SSH calls', () => {
    setGhAccountBindingResolver((cwd) => (cwd === '/remote-repo' ? WORK : null))

    expect(
      applyPinnedGhAccountBinding(['api', 'user'], { accountCwdHint: '/remote-repo' }).ghAccount
    ).toEqual(WORK)
  })

  it('leaves PAT pins and unpinned repos on the token path', () => {
    setGhAccountBindingResolver(() => null)
    const options = { cwd: '/repo' }

    expect(applyPinnedGhAccountBinding(['pr', 'list'], options)).toBe(options)
  })

  it('never overrides a caller token or an auth subcommand', () => {
    setGhAccountBindingResolver(() => WORK)
    const withToken = { cwd: '/repo', env: { GH_TOKEN: 'explicit' } }
    const authProbe = { cwd: '/repo' }

    expect(applyPinnedGhAccountBinding(['pr', 'list'], withToken)).toBe(withToken)
    expect(applyPinnedGhAccountBinding(['auth', 'token'], authProbe)).toBe(authProbe)
  })

  it('pins the host for an existing upstream binding without a fork pin', () => {
    const binding = { host: 'GHE.Example.com', user: 'me' }

    expect(applyPinnedGhAccountBinding(['pr', 'list'], { ghAccount: binding }).host).toBe(
      'ghe.example.com'
    )
  })
})
