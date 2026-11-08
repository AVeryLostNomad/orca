// Readers for untyped Unity CLI / Pipeline JSON payloads, whose shapes vary across package versions.

export function payloadField(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? Reflect.get(value, key) : undefined
}

export function payloadString(value: unknown, key: string): string | undefined {
  const field = payloadField(value, key)
  return typeof field === 'string' ? field : undefined
}

export function payloadNumber(value: unknown, key: string): number | undefined {
  const field = payloadField(value, key)
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined
}
