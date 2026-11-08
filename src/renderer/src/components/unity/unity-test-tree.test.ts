import { describe, expect, it } from 'vitest'
import { buildUnityTestTree, splitUnityTestFullName } from './unity-test-tree'

describe('splitUnityTestFullName', () => {
  it('keeps dots inside parameter lists and string arguments in the test segment', () => {
    expect(splitUnityTestFullName('Game.Tests.Parser.Parses(1,"a.b")')).toEqual([
      'Game',
      'Tests',
      'Parser',
      'Parses(1,"a.b")'
    ])
    expect(splitUnityTestFullName("Ns.Fixture<System.Int32>.Run('x).y', 2.5)")).toEqual([
      'Ns',
      'Fixture<System.Int32>',
      "Run('x).y', 2.5)"
    ])
  })
})

describe('buildUnityTestTree', () => {
  it('groups parameterized cases under one class and joins the namespace', () => {
    const tree = buildUnityTestTree([
      'Game.Tests.Parser.Parses(1,"a.b")',
      'Game.Tests.Parser.Parses(2,"c")',
      'Game.Tests.Lexer.Lexes',
      'Global.Standalone'
    ])
    expect(
      tree.map((node) => ({
        label: node.label,
        kind: node.kind,
        children: node.children.map((child) => [child.label, child.testNames.length])
      }))
    ).toEqual([
      {
        label: 'Game.Tests',
        kind: 'namespace',
        children: [
          ['Parser', 2],
          ['Lexer', 1]
        ]
      },
      { label: 'Global', kind: 'class', children: [['Standalone', 1]] }
    ])
    expect(tree[0].children[0].children.map((leaf) => leaf.label)).toEqual([
      'Parses(1,"a.b")',
      'Parses(2,"c")'
    ])
  })
})
