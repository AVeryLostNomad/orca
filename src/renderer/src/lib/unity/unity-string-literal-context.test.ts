import { describe, expect, it } from 'vitest'
import { lexCSharp, significantCSharpTokens } from './csharp-lexer'
import {
  findUnityStringSlots,
  unityStringSlotAtOffset,
  type UnityStringSlot
} from './unity-string-literal-context'

function slotsOf(source: string): UnityStringSlot[] {
  return findUnityStringSlots(significantCSharpTokens(lexCSharp(source)))
}

describe('findUnityStringSlots', () => {
  it('places the caret slot inside empty, unterminated and verbatim literals', () => {
    const empty = 'CompareTag("")'
    expect(unityStringSlotAtOffset(slotsOf(empty), empty.indexOf('"') + 1)?.kind).toBe('tag')
    const open = 'Input.GetAxis("Hor'
    expect(unityStringSlotAtOffset(slotsOf(open), open.length)?.kind).toBe('input')
    const verbatim = 'SceneManager.LoadScene(@"Assets/Main")'
    const slot = unityStringSlotAtOffset(slotsOf(verbatim), verbatim.indexOf('Main'))
    expect(slot && verbatim.slice(slot.contentSpan.start, slot.contentSpan.end)).toBe('Assets/Main')
  })

  it('requires the documented receiver and a bare literal argument', () => {
    const source = [
      'transform.Find("Child");',
      'LayerMask.NameToLayer(prefix + "Water");',
      'GameObject.FindWithTag("Player");',
      'LayerMask.GetMask("UI", "Water");',
      'SceneManager.LoadScene(2);',
      'string tag = "local";',
      'if ("Enemy" == other.tag) {}',
      'renderer.sortingLayerName = "Front";'
    ].join('\n')
    expect(slotsOf(source).map((slot) => `${slot.kind}:${slot.value ?? slot.sceneIndex}`)).toEqual([
      'tag:Player',
      'layer:UI',
      'layer:Water',
      'scene:2',
      'tag:Enemy',
      'sortingLayer:Front'
    ])
  })
})
