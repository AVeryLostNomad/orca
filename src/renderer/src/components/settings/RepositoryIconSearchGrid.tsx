import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import type { FontAwesomeIconStyle, RepoIcon } from '../../../../shared/repo-icon'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { getRepoLucideIconOptions } from '../repo/repo-icon'
import { FontAwesomeGlyph, FontAwesomeSvg } from '../repo/font-awesome-glyph'
import {
  loadFontAwesomeCatalog,
  searchFontAwesomeIcons,
  type FontAwesomeIconEntry
} from '../repo/font-awesome-icon-catalog'
import { translate } from '@/i18n/i18n'

const MAX_SEARCH_RESULTS = 120

type FontAwesomeSelection = { name: string; style: FontAwesomeIconStyle }

type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; entries: readonly FontAwesomeIconEntry[] }
  | { status: 'error' }

export function RepositoryIconSearchGrid({
  selectedLucideName,
  selectedFontAwesome,
  onSetIcon
}: {
  selectedLucideName: string | null
  selectedFontAwesome: FontAwesomeSelection | null
  onSetIcon: (repoIcon: RepoIcon | null) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' })
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setCatalog({ status: 'loading' })
    loadFontAwesomeCatalog()
      .then((entries) => {
        if (!cancelled) {
          setCatalog({ status: 'ready', entries })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCatalog({ status: 'error' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [loadAttempt])

  const trimmedQuery = query.trim()
  const results = useMemo(
    () =>
      catalog.status === 'ready' && trimmedQuery
        ? searchFontAwesomeIcons(catalog.entries, trimmedQuery, MAX_SEARCH_RESULTS)
        : [],
    [catalog, trimmedQuery]
  )
  const catalogSize = catalog.status === 'ready' ? catalog.entries.length : 0

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={translate(
            'auto.components.settings.RepositoryIconSearchGrid.searchPlaceholder',
            'Search Font Awesome icons…'
          )}
          aria-label={translate(
            'auto.components.settings.RepositoryIconSearchGrid.searchLabel',
            'Search icons'
          )}
          className="h-9 pl-8 text-sm"
        />
      </div>

      {trimmedQuery ? (
        <FontAwesomeSearchResults
          catalog={catalog}
          results={results}
          query={trimmedQuery}
          selectedFontAwesome={selectedFontAwesome}
          onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
          onSetIcon={onSetIcon}
        />
      ) : (
        <>
          <div className="grid grid-cols-10 gap-1.5">
            {selectedFontAwesome ? (
              <IconTile
                selected
                label={formatFontAwesomeLabel(selectedFontAwesome)}
                onClick={() => onSetIcon({ type: 'fontawesome', ...selectedFontAwesome })}
              >
                <FontAwesomeGlyph
                  name={selectedFontAwesome.name}
                  iconStyle={selectedFontAwesome.style}
                  className="size-4"
                />
              </IconTile>
            ) : null}
            {getRepoLucideIconOptions().map((option) => (
              <IconTile
                key={option.name}
                selected={selectedLucideName === option.name}
                label={option.label}
                onClick={() => onSetIcon({ type: 'lucide', name: option.name })}
              >
                <option.icon className="size-4" />
              </IconTile>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {catalog.status === 'ready'
              ? translate(
                  'auto.components.settings.RepositoryIconSearchGrid.searchHint',
                  'Search to browse {{value0}} Font Awesome Free icons.',
                  { value0: catalogSize.toLocaleString() }
                )
              : translate(
                  'auto.components.settings.RepositoryIconSearchGrid.searchHintLoading',
                  'Search to browse the full Font Awesome Free set.'
                )}
          </p>
        </>
      )}
    </div>
  )
}

function FontAwesomeSearchResults({
  catalog,
  results,
  query,
  selectedFontAwesome,
  onRetry,
  onSetIcon
}: {
  catalog: CatalogState
  results: readonly FontAwesomeIconEntry[]
  query: string
  selectedFontAwesome: FontAwesomeSelection | null
  onRetry: () => void
  onSetIcon: (repoIcon: RepoIcon | null) => void
}): React.JSX.Element {
  if (catalog.status === 'loading') {
    return (
      <div className="flex h-24 items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {translate(
          'auto.components.settings.RepositoryIconSearchGrid.loading',
          'Loading Font Awesome icons…'
        )}
      </div>
    )
  }
  if (catalog.status === 'error') {
    return (
      <div className="flex h-24 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.RepositoryIconSearchGrid.loadFailed',
          "Couldn't load Font Awesome icons."
        )}
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {translate('auto.components.settings.RepositoryIconSearchGrid.retry', 'Retry')}
        </Button>
      </div>
    )
  }
  if (results.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.RepositoryIconSearchGrid.noResults',
          'No icons match “{{value0}}”.',
          { value0: query }
        )}
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <div className="grid max-h-64 grid-cols-10 gap-1.5 overflow-y-auto pr-1 scrollbar-sleek">
        {results.map((entry) => (
          <IconTile
            key={`${entry.style}:${entry.name}`}
            selected={
              selectedFontAwesome?.name === entry.name && selectedFontAwesome.style === entry.style
            }
            label={formatFontAwesomeLabel(entry)}
            onClick={() => onSetIcon({ type: 'fontawesome', name: entry.name, style: entry.style })}
          >
            <FontAwesomeSvg definition={entry.definition} className="size-4" />
          </IconTile>
        ))}
      </div>
      {results.length >= MAX_SEARCH_RESULTS ? (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.settings.RepositoryIconSearchGrid.truncated',
            'Showing the first {{value0}} matches. Refine your search to see more.',
            { value0: MAX_SEARCH_RESULTS }
          )}
        </p>
      ) : null}
    </div>
  )
}

function IconTile({
  selected,
  label,
  onClick,
  children
}: {
  selected: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={selected ? 'secondary' : 'ghost'}
          size="icon-xs"
          className="size-8"
          onClick={onClick}
          aria-pressed={selected}
          aria-label={translate(
            'auto.components.settings.RepositoryIconSearchGrid.useIcon',
            'Use {{value0}} icon',
            { value0: label }
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function formatFontAwesomeLabel(selection: FontAwesomeSelection): string {
  const styleLabel = {
    solid: translate('auto.components.settings.RepositoryIconSearchGrid.styleSolid', 'solid'),
    regular: translate('auto.components.settings.RepositoryIconSearchGrid.styleRegular', 'regular'),
    brands: translate('auto.components.settings.RepositoryIconSearchGrid.styleBrands', 'brands')
  }[selection.style]
  return `${selection.name} · ${styleLabel}`
}
