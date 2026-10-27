// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { getProjectGroupDropTargetId } from './project-header-drag'

describe('project group drop targets', () => {
  it('accepts a different group header and ignores the source group', () => {
    const target = document.createElement('div')
    target.setAttribute('data-project-group-header-id', 'group-target')
    const label = document.createElement('span')
    target.appendChild(label)

    expect(getProjectGroupDropTargetId(label, 'group-source')).toBe('group-target')
    expect(getProjectGroupDropTargetId(label, 'group-target')).toBeNull()
    expect(getProjectGroupDropTargetId(document.createElement('div'), 'group-source')).toBeNull()
  })
})
