export type SnapshotTextModel = {
  uri: { toString(): string }
  getValue(): string
  getVersionId(): number
  getAlternativeVersionId(): number
  getLanguageId(): string
}

export type MonacoModelSnapshot = Readonly<{
  content: string
  version: number
  alternativeVersion: number
  identity: string
  language: string
}>

const snapshots = new WeakMap<SnapshotTextModel, MonacoModelSnapshot>()

/** One text serialization per model revision, shared by store and comparison listeners. */
export function getMonacoModelSnapshot(model: SnapshotTextModel): MonacoModelSnapshot {
  const previous = snapshots.get(model)
  const version = model.getVersionId()
  const alternativeVersion = model.getAlternativeVersionId()
  const language = model.getLanguageId()
  if (
    previous?.version === version &&
    previous.alternativeVersion === alternativeVersion &&
    previous.language === language
  ) {
    return previous
  }
  const snapshot: MonacoModelSnapshot = {
    content: previous?.version === version ? previous.content : model.getValue(),
    version,
    alternativeVersion,
    language,
    identity: previous?.identity ?? model.uri.toString()
  }
  snapshots.set(model, snapshot)
  return snapshot
}
