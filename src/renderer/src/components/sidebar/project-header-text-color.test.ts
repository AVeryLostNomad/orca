import { describe, expect, it } from 'vitest'
import { DEFAULT_REPO_BADGE_COLOR } from '../../../../shared/constants'
import { resolveProjectHeaderTextColor } from './project-header-color'

describe('resolveProjectHeaderTextColor', () => {
  it.each([undefined, null, '', 'blue', DEFAULT_REPO_BADGE_COLOR])(
    'leaves the default title color for %s',
    (color) => {
      expect(resolveProjectHeaderTextColor(color)).toBeUndefined()
    }
  )
})
