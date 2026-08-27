import { openWithFilePathsFromArguments } from '../../shared/open-with-file'

/**
 * Queues OS "open with" file intents (macOS open-file, Win/Linux argv) until the
 * renderer can take them: publish delivers live; otherwise the paths stay pending
 * for the renderer's consume-on-mount pull. Mirrors SkillShareDeepLinkState.
 */
export class OpenWithFileState {
  private pendingPaths: string[] = []

  capture(paths: readonly string[], publish?: (paths: string[]) => boolean): boolean {
    const valid = paths.filter((path) => path.length > 0)
    if (valid.length === 0) {
      return false
    }
    if (publish?.(valid)) {
      return true
    }
    this.pendingPaths.push(...valid)
    return true
  }

  captureFromArgv(argv: readonly string[], publish?: (paths: string[]) => boolean): boolean {
    return this.capture(openWithFilePathsFromArguments(argv), publish)
  }

  consume(): string[] {
    const paths = this.pendingPaths
    this.pendingPaths = []
    return paths
  }
}
