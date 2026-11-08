import { describe, expect, it } from 'vitest'
import { countMethodBindings } from './unity-asset-usages'

const GUID = 'f0ad40c52eda9904f9c9582ef4322d2c'
const OTHER_GUID = '0123456789abcdef0123456789abcdef'

const SCENE = `%YAML 1.1
--- !u!1 &100
GameObject:
  m_Component:
  - component: {fileID: 200}
--- !u!114 &200
MonoBehaviour:
  m_GameObject: {fileID: 100}
  m_Script: {fileID: 11500000, guid: ${GUID}, type: 3}
--- !u!114 &300
MonoBehaviour:
  m_GameObject: {fileID: 400}
  m_Script: {fileID: 11500000, guid: ${OTHER_GUID}, type: 3}
  m_OnClick:
    m_PersistentCalls:
      m_Calls:
      - m_Target: {fileID: 200}
        m_TargetAssemblyTypeName: Game.Piece, Assembly-CSharp
        m_MethodName: Select
        m_Mode: 1
      - m_Target: {fileID: 100}
        m_TargetAssemblyTypeName: UnityEngine.GameObject, UnityEngine
        m_MethodName: Select
      - m_Target: {fileID: 9999}
        m_TargetAssemblyTypeName: Game.Piece, Assembly-CSharp
        m_MethodName: Select
      - m_Target: {fileID: 300}
        m_TargetAssemblyTypeName: Game.Other, Assembly-CSharp
        m_MethodName: Select
      - m_Target: {fileID: 200}
        m_MethodName: SelectAll
`

describe('countMethodBindings', () => {
  it('counts calls on the script component or its type, not other targets with the same method', () => {
    // Matches: component 200, and the nested-prefab target 9999 named by type. The GameObject
    // target names GameObject's type and the 300 target is another script.
    expect(countMethodBindings(SCENE, { guid: GUID, className: 'Piece' }, 'Select')).toEqual({
      count: 2,
      line: 19
    })
  })

  it('requires the exact method name', () => {
    expect(countMethodBindings(SCENE, { guid: GUID, className: 'Piece' }, 'SelectAll')).toEqual({
      count: 1,
      line: 31
    })
    expect(countMethodBindings(SCENE, { guid: GUID, className: 'Piece' }, 'Sel')).toBeNull()
  })
})
