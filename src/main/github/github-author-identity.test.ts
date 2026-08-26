import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ghExecFileAsyncMock, resolveGithubAccountTokenMock } = vi.hoisted(() => ({
  ghExecFileAsyncMock: vi.fn(),
  resolveGithubAccountTokenMock: vi.fn()
}))

vi.mock('../git/runner', () => ({
  ghExecFileAsync: ghExecFileAsyncMock
}))

vi.mock('./github-account-env', () => ({
  resolveGithubAccountToken: resolveGithubAccountTokenMock
}))

import { resolveGithubAuthorIdentity } from './github-author-identity'

describe('resolveGithubAuthorIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveGithubAccountTokenMock.mockResolvedValue('gho_selected')
  })

  it('resolves the selected gh keyring account and uses its GitHub no-reply address', async () => {
    ghExecFileAsyncMock.mockResolvedValue({
      stdout: JSON.stringify({
        id: 123,
        login: 'work',
        name: 'Work User',
        email: null,
        url: 'https://github.com/work'
      }),
      stderr: ''
    })

    await expect(resolveGithubAuthorIdentity('gh:github.com:work')).resolves.toEqual({
      name: 'Work User',
      email: '123+work@users.noreply.github.com'
    })
    expect(resolveGithubAccountTokenMock).toHaveBeenCalledWith('gh:github.com:work')
    expect(ghExecFileAsyncMock).toHaveBeenCalledWith(
      [
        'api',
        '--hostname',
        'github.com',
        'user',
        '--jq',
        '{id: .id, login: .login, name: .name, email: .email, url: .html_url}'
      ],
      expect.objectContaining({
        skipAccountEnv: true,
        env: expect.objectContaining({ GH_TOKEN: 'gho_selected' })
      })
    )
  })

  it('refuses a selected account whose keyring token is unavailable', async () => {
    resolveGithubAccountTokenMock.mockResolvedValue(null)

    await expect(resolveGithubAuthorIdentity('gh:github.com:missing')).resolves.toBeNull()
    expect(ghExecFileAsyncMock).not.toHaveBeenCalled()
  })
})
