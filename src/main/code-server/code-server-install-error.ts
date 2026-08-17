export type InstallProgress = (fraction: number) => void

export type InstallErrorCode =
  | 'missing-prereq'
  | 'unsupported-arch'
  | 'download-failed'
  | 'no-install-script'
  | 'checksum-mismatch'

export class CodeServerInstallError extends Error {
  readonly code: InstallErrorCode
  constructor(code: InstallErrorCode, message: string) {
    super(message)
    this.name = 'CodeServerInstallError'
    this.code = code
  }
}
