/**
 * chrome.runtime messaging serializes with JSON, not structured clone. IndexedDB
 * records routinely hold Date / undefined / Map / Set / Blob / ArrayBuffer, all of
 * which JSON silently mangles.
 *
 * That matters far more on the way back than on the way out: showing a Date as a
 * string is cosmetic, but writing that string back into a live database is data
 * loss. This codec keeps everything JSON *can* represent faithfully, and marks
 * what it cannot as `opaque` so the UI can refuse to edit it. Together with the
 * patch-based writes in content/idb.ts, nothing the panel never understood is
 * ever written back.
 */

// Distinctive enough that a real record key is very unlikely to collide with it.
const TAG = '__dvxT'
const OPAQUE = Symbol.for('dvx.opaque')

export interface OpaqueValue {
  kind: 'Blob' | 'File' | 'ArrayBuffer' | 'TypedArray'
  size: number
  mime?: string
}

export function encode(value: any): any {
  if (value === undefined) return { [TAG]: 'undef' }
  if (value === null) return null
  if (typeof value === 'bigint') return { [TAG]: 'bigint', v: value.toString() }
  if (typeof value !== 'object') return value

  if (value instanceof Date) return { [TAG]: 'date', v: value.toISOString() }
  if (value instanceof Map) {
    return { [TAG]: 'map', v: [...value].map(([key, val]) => [encode(key), encode(val)]) }
  }
  if (value instanceof Set) return { [TAG]: 'set', v: [...value].map(encode) }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    const kind = typeof File !== 'undefined' && value instanceof File ? 'File' : 'Blob'
    return { [TAG]: 'opaque', kind, size: value.size, mime: value.type }
  }
  if (value instanceof ArrayBuffer) return { [TAG]: 'opaque', kind: 'ArrayBuffer', size: value.byteLength }
  if (ArrayBuffer.isView(value)) return { [TAG]: 'opaque', kind: 'TypedArray', size: value.byteLength }
  if (Array.isArray(value)) return value.map(encode)

  const out: Record<string, any> = {}
  for (const key of Object.keys(value)) out[key] = encode(value[key])
  return out
}

export function decode(value: any): any {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(decode)

  switch (value[TAG]) {
    case 'undef':
      return undefined
    case 'date':
      return new Date(value.v)
    case 'bigint':
      return BigInt(value.v)
    case 'map':
      return new Map(value.v.map(([key, val]: [any, any]) => [decode(key), decode(val)]))
    case 'set':
      return new Set(value.v.map(decode))
    case 'opaque':
      return { [OPAQUE]: true, kind: value.kind, size: value.size, mime: value.mime }
  }

  const out: Record<string, any> = {}
  for (const key of Object.keys(value)) out[key] = decode(value[key])
  return out
}

/** Opaque values are display-only: renderable as a badge, never editable, never written back. */
export function isOpaque(value: any): value is OpaqueValue {
  return Boolean(value && typeof value === 'object' && value[OPAQUE])
}
