import type { RowRecord } from '../datasource/types'

const PREVIEW = Symbol.for('dvx.preview')

export type PreviewKind =
  | 'array'
  | 'object'
  | 'Map'
  | 'Set'
  | 'Blob'
  | 'File'
  | 'ArrayBuffer'
  | 'TypedArray'

export interface PreviewValue {
  kind: PreviewKind
  size: number
}

export function makePreviewValue(kind: PreviewKind, size: number): PreviewValue {
  return { [PREVIEW]: true, kind, size } as PreviewValue
}

export function isPreviewValue(value: unknown): value is PreviewValue {
  return Boolean(
    value && typeof value === 'object' && (value as Record<PropertyKey, unknown>)[PREVIEW],
  )
}

function previewValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  if (Array.isArray(value)) return makePreviewValue('array', value.length)
  if (value instanceof Map) return makePreviewValue('Map', value.size)
  if (value instanceof Set) return makePreviewValue('Set', value.size)
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    const kind = typeof File !== 'undefined' && value instanceof File ? 'File' : 'Blob'
    return makePreviewValue(kind, value.size)
  }
  if (value instanceof ArrayBuffer) return makePreviewValue('ArrayBuffer', value.byteLength)
  if (ArrayBuffer.isView(value)) return makePreviewValue('TypedArray', value.byteLength)
  return makePreviewValue('object', Object.keys(value).length)
}

export function previewRecord(record: RowRecord): RowRecord {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, previewValue(value)]))
}
