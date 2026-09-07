import { describe, expect, it } from 'vitest'
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { buildFontAwesomeCatalog, searchFontAwesomeIcons } from './font-awesome-icon-catalog'

function definition(name: string, aliases: (string | number)[] = []): IconDefinition {
  return {
    prefix: 'fas',
    iconName: name as IconDefinition['iconName'],
    // Why: the typings say string[], but shipped packs also list numeric unicode aliases.
    icon: [512, 512, aliases as string[], 'f000', 'M0 0h1v1z']
  }
}

const catalog = buildFontAwesomeCatalog([
  new Map([
    ['code', definition('code')],
    ['barcode', definition('barcode')],
    ['code-branch', definition('code-branch')],
    ['house', definition('house', [127968, 'home'])]
  ]),
  new Map([['code', definition('code')]]),
  new Map([['github', definition('github')]])
])

describe('buildFontAwesomeCatalog', () => {
  it('tags entries by style and lowercases string aliases only', () => {
    const house = catalog.find((entry) => entry.name === 'house')
    expect(house?.style).toBe('solid')
    expect(house?.aliases).toEqual(['home'])
    expect(catalog.filter((entry) => entry.name === 'code').map((entry) => entry.style)).toEqual([
      'solid',
      'regular'
    ])
  })
})

describe('searchFontAwesomeIcons', () => {
  it('ranks exact and prefix name matches ahead of substring matches', () => {
    expect(searchFontAwesomeIcons(catalog, 'code', 10).map((entry) => entry.name)).toEqual([
      'code',
      'code',
      'code-branch',
      'barcode'
    ])
  })

  it('matches aliases and requires every token', () => {
    expect(searchFontAwesomeIcons(catalog, 'home', 10).map((entry) => entry.name)).toEqual([
      'house'
    ])
    expect(searchFontAwesomeIcons(catalog, 'code branch', 10).map((entry) => entry.name)).toEqual([
      'code-branch'
    ])
    expect(searchFontAwesomeIcons(catalog, 'nothing', 10)).toEqual([])
  })

  it('caps results at the limit', () => {
    expect(searchFontAwesomeIcons(catalog, '', 2)).toHaveLength(2)
    expect(searchFontAwesomeIcons(catalog, 'code', 1)).toHaveLength(1)
  })
})
