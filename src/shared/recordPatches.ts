import type { RecordPatch } from '../datasource/types'

function coerce(existing: unknown, next: unknown): unknown {
  if (existing instanceof Date && typeof next === 'string') {
    const time = Date.parse(next)
    if (!Number.isNaN(time)) return new Date(time)
  }
  if (
    typeof existing === 'number' &&
    typeof next === 'string' &&
    next.trim() !== '' &&
    !Number.isNaN(Number(next))
  ) {
    return Number(next)
  }
  if (typeof existing === 'boolean' && typeof next === 'string') {
    if (next === 'true') return true
    if (next === 'false') return false
  }
  return next
}

export function applyRecordPatches(record: any, patches: RecordPatch[]): void {
  for (const { path, value } of patches) {
    if (path.length === 0) throw new Error('A patch needs a field path.')
    let target = record
    for (const segment of path.slice(0, -1)) {
      if (target === null || typeof target !== 'object') {
        throw new Error(`Cannot patch path ${path.join('.')} — ${segment} is not an object.`)
      }
      target = target[segment]
    }
    if (target === null || typeof target !== 'object') {
      throw new Error(`Cannot patch path ${path.join('.')} — the parent is not an object.`)
    }
    const leaf = path[path.length - 1]
    target[leaf] = coerce(target[leaf], value)
  }
}
