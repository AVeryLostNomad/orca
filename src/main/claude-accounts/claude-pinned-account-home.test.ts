import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import {
  linkSharedClaudeConfigIntoPinnedHome,
  pickFresherClaudeCredentials,
  writePinnedHomeGlobalConfig
} from './claude-pinned-account-home'

describe('claude pinned account home', () => {
  let root: string
  let shared: string
  let home: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-claude-pin-'))
    shared = join(root, 'shared')
    home = join(root, 'home')
    mkdirSync(join(shared, 'skills'), { recursive: true })
    writeFileSync(join(shared, 'settings.json'), '{}')
    writeFileSync(join(shared, 'CLAUDE.md'), '# memory')
    writeFileSync(join(shared, '.credentials.json'), '{"secret":true}')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('links shared config but never the shared login', () => {
    linkSharedClaudeConfigIntoPinnedHome(home, shared)
    expect(lstatSync(join(home, 'settings.json')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(home, 'skills'))).toBe(join(shared, 'skills'))
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf-8')).toBe('# memory')
    expect(() => lstatSync(join(home, '.credentials.json'))).toThrow()
  })

  it('leaves entries Claude created inside the home alone', () => {
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'settings.json'), '{"own":true}')
    linkSharedClaudeConfigIntoPinnedHome(home, shared)
    expect(lstatSync(join(home, 'settings.json')).isSymbolicLink()).toBe(false)
  })

  it('mirrors the shared global config but keeps the pinned identity', () => {
    mkdirSync(home, { recursive: true })
    const sharedConfig = join(root, '.claude.json')
    writeFileSync(
      sharedConfig,
      JSON.stringify({
        mcpServers: { a: {} },
        oauthAccount: { emailAddress: 'work@example.com' },
        projects: { '/p': { trusted: true } }
      })
    )
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { '/q': {} } }))
    writePinnedHomeGlobalConfig(home, sharedConfig, {
      emailAddress: 'me@example.com'
    })
    const written = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf-8'))
    expect(written.oauthAccount).toEqual({ emailAddress: 'me@example.com' })
    expect(written.mcpServers).toEqual({ a: {} })
    expect(Object.keys(written.projects).sort()).toEqual(['/p', '/q'])
  })

  it('picks the credentials with the later expiry', () => {
    const creds = (expiresAt: number): string => JSON.stringify({ claudeAiOauth: { expiresAt } })
    expect(pickFresherClaudeCredentials(creds(1), creds(2))).toBe('home')
    expect(pickFresherClaudeCredentials(creds(3), creds(2))).toBe('managed')
    expect(pickFresherClaudeCredentials(creds(3), creds(3))).toBe('same')
    expect(pickFresherClaudeCredentials(creds(3), null)).toBe('managed')
  })
})
