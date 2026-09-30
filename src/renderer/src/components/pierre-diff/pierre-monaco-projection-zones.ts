import type { editor } from 'monaco-editor'
import type { ProjectedLine } from './pierre-monaco-projection-geometry'

export type PierreMonacoSpacerZones = {
  clear: () => void
  /** Pads Monaco so each projected line lands on its native row's offset. */
  sync: (lines: readonly ProjectedLine[]) => void
}

export function createPierreMonacoSpacerZones(
  editorInstance: editor.IStandaloneCodeEditor
): PierreMonacoSpacerZones {
  let zoneIds: string[] = []

  const clear = (): void => {
    if (!zoneIds.length) {
      return
    }
    editorInstance.changeViewZones((accessor) => {
      for (const zoneId of zoneIds) {
        accessor.removeZone(zoneId)
      }
    })
    zoneIds = []
  }

  const sync = (lines: readonly ProjectedLine[]): void => {
    clear()
    const zoneSpecs: { afterLineNumber: number; heightInPx: number }[] = []
    for (let index = 1; index < lines.length; index++) {
      const previous = lines[index - 1]!
      const current = lines[index]!
      const nativeDistance = current.top - previous.top
      const monacoDistance =
        editorInstance.getTopForLineNumber(current.lineNumber) -
        editorInstance.getTopForLineNumber(previous.lineNumber)
      const heightInPx = Math.round(nativeDistance - monacoDistance)
      if (heightInPx > 0) {
        zoneSpecs.push({ afterLineNumber: previous.lineNumber, heightInPx })
      }
    }
    if (!zoneSpecs.length) {
      return
    }
    editorInstance.changeViewZones((accessor) => {
      zoneIds = zoneSpecs.map(({ afterLineNumber, heightInPx }) => {
        const spacer = document.createElement('div')
        spacer.style.pointerEvents = 'none'
        return accessor.addZone({
          afterLineNumber,
          heightInPx,
          domNode: spacer,
          showInHiddenAreas: true,
          suppressMouseDown: true
        })
      })
    })
  }

  return { clear, sync }
}
