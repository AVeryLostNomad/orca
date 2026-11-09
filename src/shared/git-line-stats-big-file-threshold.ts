// Git diffs files above core.bigFileThreshold as binary ('-' counts). Line stats must not content-diff
// multi-MB generated assets: a 49 MB Unity scene costs ~5s per numstat versus ~0.2s when skipped.
// Older Git ignores the setting for diffs, so mixed-version remotes only lose the speedup.
export const GIT_LINE_STATS_BIG_FILE_CONFIG_ARGS: readonly string[] = [
  '-c',
  'core.bigFileThreshold=8m'
]
