import { describe, expect, it } from 'vitest'
import { parseCSharpOutline } from './csharp-syntax-outline'
import { checkUnityEventSignatures } from './unity-event-signature-check'
import type { UnityBaseKind } from './unity-event-function-types'

function findings(
  body: string,
  kind: UnityBaseKind = 'MonoBehaviour'
): { kind: string; fix: string }[] {
  const outline = parseCSharpOutline(`class A : B {\n${body}\n}`)
  return checkUnityEventSignatures(outline.types[0], kind).map((finding) => ({
    kind: finding.kind,
    fix: finding.fix.text
  }))
}

describe('checkUnityEventSignatures', () => {
  it('accepts qualified, aliased, optional-parameter and coroutine forms Unity invokes', () => {
    expect(
      findings(
        [
          'void OnTriggerEnter(UnityEngine.Collider c) {}',
          'void OnCollisionEnter() {}',
          'IEnumerator Start() { yield break; }',
          'void OnApplicationPause(System.Boolean paused) {}',
          'void OnAudioFilterRead(float[] data, int channels) {}'
        ].join('\n')
      )
    ).toEqual([])
  })

  it('rewrites wrong parameter types while keeping the user parameter name and modifiers', () => {
    expect(findings('protected void OnTriggerEnter(Collision hit) {}')).toEqual([
      { kind: 'signature', fix: 'protected void OnTriggerEnter(Collider hit)' }
    ])
  })

  it('removes static where Unity requires an instance method and adds it where required', () => {
    expect(findings('private static void Update() {}')).toEqual([
      { kind: 'signature', fix: 'private void Update()' }
    ])
    expect(
      findings(
        'void OnPostprocessAllAssets(string[] a, string[] b, string[] c, string[] d) {}',
        'AssetPostprocessor'
      )
    ).toEqual([
      {
        kind: 'signature',
        fix: 'static void OnPostprocessAllAssets(string[] a, string[] b, string[] c, string[] d)'
      }
    ])
  })

  it('rejects coroutines for messages that cannot be coroutines and ref parameters', () => {
    expect(findings('IEnumerator Update() { yield break; }')).toEqual([
      { kind: 'signature', fix: 'void Update()' }
    ])
    expect(findings('void OnAnimatorIK(ref int layer) {}')).toEqual([
      { kind: 'signature', fix: 'void OnAnimatorIK(int layer)' }
    ])
  })

  it('ignores mismatched overloads once one declaration matches, and flags case-only near misses', () => {
    expect(findings('void Update() {}\nvoid Update(float dt) {}')).toEqual([])
    expect(findings('void update() {}')).toEqual([{ kind: 'name', fix: 'Update' }])
  })

  it('accepts the newer OnPostprocessAllAssets overload with didDomainReload', () => {
    expect(
      findings(
        'static void OnPostprocessAllAssets(string[] a, string[] b, string[] c, string[] d, bool reload) {}',
        'AssetPostprocessor'
      )
    ).toEqual([])
  })
})
