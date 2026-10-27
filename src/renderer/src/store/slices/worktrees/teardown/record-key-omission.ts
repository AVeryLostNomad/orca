/** Preserve identity when no key matches or teardown rerenders selectors for dozens of unchanged maps. Nullish partial-test slices normalize to {}, matching spread/delete; production initializes them. */
export function omitRecordKeys<T>(
  record: Record<string, T> | undefined,
  keys: Iterable<string>
): Record<string, T> {
  if (!record) {
    return {}
  }
  let next: Record<string, T> | null = null
  for (const key of keys) {
    if (!(key in record)) {
      continue
    }
    next ??= { ...record }
    delete next[key]
  }
  return next ?? record
}

/** Keep only the entries `keep` accepts, preserving identity when every entry stays. */
export function filterRecordEntries<T>(
  record: Record<string, T> | undefined,
  keep: (key: string, value: T) => boolean
): Record<string, T> {
  if (!record) {
    return {}
  }
  const dropped = Object.keys(record).filter((key) => !keep(key, record[key]!))
  return omitRecordKeys(record, dropped)
}
