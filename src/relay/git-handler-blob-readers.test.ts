import { describe, expect, it, vi } from 'vitest'
import {
  readBlobAtIndex,
  readBlobAtOid,
  readUnstagedLeft,
  type GitBufferExec
} from './git-handler-ops'

describe('git blob readers', () => {
  it('normalizes Windows separators before reading OID blobs', async () => {
    const gitBuffer = vi.fn<GitBufferExec>().mockResolvedValue(Buffer.from('head-content'))

    const result = await readBlobAtOid(gitBuffer, '/repo', 'HEAD', 'src\\file.ts')

    expect(gitBuffer).toHaveBeenCalledWith(
      ['show', '--end-of-options', 'HEAD:src/file.ts'],
      '/repo'
    )
    expect(result).toEqual({
      content: 'head-content',
      isBinary: false,
      readState: 'present'
    })
  })

  it('marks OID blobs that overflow maxBuffer as binary', async () => {
    const gitBuffer = vi
      .fn<GitBufferExec>()
      .mockRejectedValue(
        Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ENOBUFS' })
      )

    const result = await readBlobAtOid(gitBuffer, '/repo', 'HEAD', 'large.log')

    expect(result).toEqual({ content: '', isBinary: true, readState: 'present' })
  })

  it('normalizes Windows separators before reading index blobs', async () => {
    const gitBuffer = vi.fn<GitBufferExec>().mockResolvedValue(Buffer.from('index-content'))

    const result = await readBlobAtIndex(gitBuffer, '/repo', 'src\\file.ts')

    expect(gitBuffer).toHaveBeenCalledWith(['show', '--end-of-options', ':src/file.ts'], '/repo')
    expect(result).toEqual({
      content: 'index-content',
      isBinary: false,
      readState: 'present'
    })
  })

  it('marks index blobs that overflow maxBuffer as binary', async () => {
    const gitBuffer = vi
      .fn<GitBufferExec>()
      .mockRejectedValue(
        Object.assign(new Error('git stdout exceeded maxBuffer.'), { code: 'ENOBUFS' })
      )

    const result = await readBlobAtIndex(gitBuffer, '/repo', 'large.log')

    // Why: overflow is size-capped content, not a staged deletion.
    expect(result).toEqual({ content: '', isBinary: true, readState: 'present' })
  })

  it('keeps a present empty index blob instead of falling back to HEAD', async () => {
    const gitBuffer = vi.fn<GitBufferExec>().mockResolvedValue(Buffer.alloc(0))

    const result = await readUnstagedLeft(gitBuffer, '/repo', 'empty.txt')

    expect(result).toEqual({ content: '', isBinary: false, readState: 'present' })
    expect(gitBuffer).toHaveBeenCalledTimes(1)
    expect(gitBuffer).toHaveBeenCalledWith(['show', '--end-of-options', ':empty.txt'], '/repo')
  })

  it('classifies recognized missing index paths as absent', async () => {
    const gitBuffer = vi.fn<GitBufferExec>().mockRejectedValue(
      Object.assign(new Error('git show failed'), {
        code: 128,
        stderr: "fatal: path 'deleted.txt' does not exist (neither on disk nor in the index)\n"
      })
    )

    await expect(readBlobAtIndex(gitBuffer, '/repo', 'deleted.txt')).resolves.toEqual({
      content: '',
      isBinary: false,
      readState: 'absent'
    })
  })

  it('keeps denied blob reads unavailable even when Git exits 128', async () => {
    const gitBuffer = vi.fn<GitBufferExec>().mockRejectedValue(
      Object.assign(new Error('git show failed'), {
        code: 128,
        stderr: 'fatal: cannot read object: Permission denied\n'
      })
    )

    await expect(readBlobAtOid(gitBuffer, '/repo', 'HEAD', 'file.txt')).resolves.toEqual({
      content: '',
      isBinary: false,
      readState: 'unavailable'
    })
  })

  it('classifies recognized missing OID paths as absent', async () => {
    const gitBuffer = vi.fn<GitBufferExec>().mockRejectedValue(
      Object.assign(new Error('git show failed'), {
        code: 128,
        stderr: "fatal: path 'deleted.txt' does not exist in 'HEAD'\n"
      })
    )

    await expect(readBlobAtOid(gitBuffer, '/repo', 'HEAD', 'deleted.txt')).resolves.toEqual({
      content: '',
      isBinary: false,
      readState: 'absent'
    })
  })

  it('keeps an unverified invalid HEAD unavailable', async () => {
    const gitBuffer = vi.fn<GitBufferExec>().mockRejectedValue(
      Object.assign(new Error('git show failed'), {
        code: 128,
        stderr: "fatal: invalid object name 'HEAD'.\n"
      })
    )

    await expect(readBlobAtOid(gitBuffer, '/repo', 'HEAD', 'new.txt')).resolves.toEqual({
      content: '',
      isBinary: false,
      readState: 'unavailable'
    })
  })

  it('keeps repository failures unavailable even when Git exits 128', async () => {
    const gitBuffer = vi.fn<GitBufferExec>().mockRejectedValue(
      Object.assign(new Error('git show failed'), {
        code: 128,
        stderr: 'fatal: not a git repository (or any of the parent directories): .git\n'
      })
    )

    await expect(readBlobAtOid(gitBuffer, '/repo', 'HEAD', 'file.txt')).resolves.toEqual({
      content: '',
      isBinary: false,
      readState: 'unavailable'
    })
  })

  it('does not fall back to HEAD after an unavailable index read', async () => {
    const gitBuffer = vi
      .fn<GitBufferExec>()
      .mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }))

    await expect(readUnstagedLeft(gitBuffer, '/repo', 'file.txt')).resolves.toEqual({
      content: '',
      isBinary: false,
      readState: 'unavailable'
    })
    expect(gitBuffer).toHaveBeenCalledTimes(1)
  })
})
