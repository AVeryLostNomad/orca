import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { Folder } from 'lucide-react'
import type { FontAwesomeIconStyle } from '../../../../shared/repo-icon'
import { cn } from '@/lib/utils'
import { useFontAwesomeIcon } from './font-awesome-icon-catalog'

/** Renders a Font Awesome definition as an inline SVG that inherits `currentColor`. */
export function FontAwesomeSvg({
  definition,
  className,
  style
}: {
  definition: IconDefinition
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  const [width, height, , , pathData] = definition.icon
  const paths = Array.isArray(pathData) ? pathData : [pathData]
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('shrink-0 fill-current', className)}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d, index) => (
        // Why: FA duotone-style glyphs ship a faded secondary layer first.
        <path key={index} d={d} opacity={paths.length > 1 && index === 0 ? 0.4 : undefined} />
      ))}
    </svg>
  )
}

/** Lazily resolves a persisted Font Awesome icon; shows the default folder until the pack loads. */
export function FontAwesomeGlyph({
  name,
  iconStyle,
  className,
  style
}: {
  name: string
  iconStyle: FontAwesomeIconStyle
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  const definition = useFontAwesomeIcon(iconStyle, name)
  if (!definition) {
    return <Folder className={className} style={style} />
  }
  return <FontAwesomeSvg definition={definition} className={className} style={style} />
}
