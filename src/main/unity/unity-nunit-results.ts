// Targeted reader for the NUnit 3 XML report `unity test` writes; only <test-case> leaves matter.

export type NunitTestCase = {
  fullName: string
  name: string
  result: 'passed' | 'failed' | 'skipped' | 'inconclusive'
  durationSeconds: number
  message?: string
  stackTrace?: string
}

const RESULT_BY_ATTRIBUTE: Record<string, NunitTestCase['result']> = {
  Passed: 'passed',
  Failed: 'failed',
  Skipped: 'skipped',
  Ignored: 'skipped',
  Inconclusive: 'inconclusive'
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'"
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    }
    if (body.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    }
    return NAMED_ENTITIES[body] ?? entity
  })
}

/** Text content of a child element: CDATA sections verbatim, other text entity-decoded. */
function elementText(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)
  if (!match) {
    return undefined
  }
  const parts = match[1].split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
  const text = parts
    .map((part) =>
      part.startsWith('<![CDATA[')
        ? part.slice('<![CDATA['.length, -']]>'.length)
        : decodeEntities(part)
    )
    .join('')
    .trim()
  return text.length > 0 ? text : undefined
}

export function parseNunitTestCases(xml: string): NunitTestCase[] {
  const cases: NunitTestCase[] = []
  const testCase = /<test-case\b([^>]*?)(?:\/>|>([\s\S]*?)<\/test-case>)/g
  for (const match of xml.matchAll(testCase)) {
    const attributes: Record<string, string> = {}
    for (const attribute of match[1].matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attributes[attribute[1]] = decodeEntities(attribute[2])
    }
    const body = match[2] ?? ''
    // Failures carry their text under <failure>; skipped/ignored tests under <reason>.
    const detail =
      /<failure\b[\s\S]*?<\/failure>/.exec(body)?.[0] ??
      /<reason\b[\s\S]*?<\/reason>/.exec(body)?.[0] ??
      ''
    const message = elementText(detail, 'message')
    const stackTrace = elementText(detail, 'stack-trace')
    const duration = Number(attributes.duration)
    cases.push({
      fullName: attributes.fullname ?? attributes.name ?? '',
      name: attributes.name ?? attributes.fullname ?? '',
      result:
        RESULT_BY_ATTRIBUTE[attributes.label ?? ''] ??
        RESULT_BY_ATTRIBUTE[attributes.result ?? ''] ??
        'inconclusive',
      durationSeconds: Number.isFinite(duration) ? duration : 0,
      ...(message ? { message } : {}),
      ...(stackTrace ? { stackTrace } : {})
    })
  }
  return cases
}
