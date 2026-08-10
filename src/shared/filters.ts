/**
 * Filter / search / sort predicates, ported from Dexie-visualizer's src/db/query.ts
 * with all Dexie coupling removed so they are pure functions over plain rows.
 *
 * Adapted for live data: the parent tool read a JSON export where every date was
 * an ISO string, but a live IndexedDB store holds real Date objects. Date handling
 * below therefore accepts both.
 */
import type { FilterRule, RowRecord, TableQuery } from '../datasource/types'

export function valueAt(row: RowRecord, field: string): unknown {
  return field.split('.').reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object') return undefined
    return (value as RowRecord)[part]
  }, row)
}

function searchableText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.map(searchableText).join(' ')
    return Object.values(value as RowRecord).map(searchableText).join(' ')
  }
  return String(value)
}

/** Accepts a real Date or an ISO string; NaN signals "not a date". */
function timeOf(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value)
  return Number.NaN
}

function matchesFilter(row: RowRecord, filter: FilterRule): boolean {
  const value = valueAt(row, filter.field)
  switch (filter.kind) {
    case 'text':
      return searchableText(value).toLocaleLowerCase().includes(filter.value.toLocaleLowerCase())
    case 'number':
      return (
        typeof value === 'number' &&
        (filter.min === undefined || value >= filter.min) &&
        (filter.max === undefined || value <= filter.max)
      )
    case 'boolean':
      return value === filter.value
    case 'date': {
      const time = timeOf(value)
      return (
        !Number.isNaN(time) &&
        (filter.from === undefined || time >= Date.parse(filter.from)) &&
        (filter.to === undefined || time <= Date.parse(filter.to))
      )
    }
    case 'enum':
      return filter.values.some((candidate) => candidate === value)
    default:
      return true
  }
}

export function matchesQuery(row: RowRecord, query: TableQuery): boolean {
  if (query.filters?.some((filter) => !matchesFilter(row, filter))) return false
  const search = query.search?.trim().toLocaleLowerCase()
  return !search || searchableText(row).toLocaleLowerCase().includes(search)
}

export function compareValues(left: unknown, right: unknown): number {
  if (left === right) return 0
  if (left === null || left === undefined) return 1
  if (right === null || right === undefined) return -1
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime()
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}
