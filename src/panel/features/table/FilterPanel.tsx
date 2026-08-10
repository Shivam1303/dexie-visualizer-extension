import { useState } from 'react'
import { Button } from '../../components/Button'
import type { InferredColumn } from '../../../shared/columns'
import type { FilterRule } from '../../../datasource/types'

interface FilterPanelProps {
  columns: InferredColumn[]
  filters: FilterRule[]
  onChange: (filters: FilterRule[]) => void
}

/** Ported from Dexie-visualizer; one type-aware widget per column, AND-combined. */
export function FilterPanel({ columns, filters, onChange }: FilterPanelProps) {
  const [selected, setSelected] = useState(columns[0]?.key ?? '')
  const column = columns.find(({ key }) => key === selected)
  const filter = filters.find(({ field }) => field === selected)

  function replace(next?: FilterRule) {
    const remaining = filters.filter(({ field }) => field !== selected)
    onChange(next ? [...remaining, next] : remaining)
  }

  return (
    <div className="filter-panel">
      <div className="filter-panel-head">
        <div>
          <strong>Filter records</strong>
          <span>Multiple filters combine with AND.</span>
        </div>
        {filters.length > 0 && (
          <Button compact onClick={() => onChange([])} variant="ghost">
            Clear all
          </Button>
        )}
      </div>

      <div className="filter-controls">
        <label className="field">
        <span>Column</span>
        <select onChange={(event) => setSelected(event.target.value)} value={selected}>
          {columns.map((item) => (
            <option key={item.key} value={item.key}>
              {item.key} · {item.type}
            </option>
          ))}
        </select>
        </label>

      {column?.type === 'number' && (
        <div className="field-row">
          <label className="field">
            <span>Min</span>
            <input
              onChange={(event) => {
                const min = event.target.value === '' ? undefined : Number(event.target.value)
                const max = filter?.kind === 'number' ? filter.max : undefined
                if (min === undefined && max === undefined) return replace()
                replace({ field: selected, kind: 'number', ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) })
              }}
              type="number"
              value={filter?.kind === 'number' ? filter.min ?? '' : ''}
            />
          </label>
          <label className="field">
            <span>Max</span>
            <input
              onChange={(event) => {
                const max = event.target.value === '' ? undefined : Number(event.target.value)
                const min = filter?.kind === 'number' ? filter.min : undefined
                if (min === undefined && max === undefined) return replace()
                replace({ field: selected, kind: 'number', ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) })
              }}
              type="number"
              value={filter?.kind === 'number' ? filter.max ?? '' : ''}
            />
          </label>
        </div>
      )}

      {column?.type === 'boolean' && (
        <label className="field">
          <span>Value</span>
          <select
            onChange={(event) => {
              if (!event.target.value) return replace()
              replace({ field: selected, kind: 'boolean', value: event.target.value === 'true' })
            }}
            value={filter?.kind === 'boolean' ? String(filter.value) : ''}
          >
            <option value="">Any</option>
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </label>
      )}

      {column?.type === 'date' && (
        <div className="field-row">
          <label className="field">
            <span>From</span>
            <input
              onChange={(event) => {
                const from = event.target.value || undefined
                const to = filter?.kind === 'date' ? filter.to : undefined
                if (!from && !to) return replace()
                replace({ field: selected, kind: 'date', ...(from ? { from } : {}), ...(to ? { to } : {}) })
              }}
              type="date"
              value={filter?.kind === 'date' ? filter.from?.slice(0, 10) ?? '' : ''}
            />
          </label>
          <label className="field">
            <span>To</span>
            <input
              onChange={(event) => {
                const to = event.target.value ? `${event.target.value}T23:59:59.999Z` : undefined
                const from = filter?.kind === 'date' ? filter.from : undefined
                if (!from && !to) return replace()
                replace({ field: selected, kind: 'date', ...(from ? { from } : {}), ...(to ? { to } : {}) })
              }}
              type="date"
              value={filter?.kind === 'date' ? filter.to?.slice(0, 10) ?? '' : ''}
            />
          </label>
        </div>
      )}

      {column && !['number', 'boolean', 'date', 'object', 'array', 'binary'].includes(column.type) && (
        <label className="field">
          <span>Contains</span>
          <input
            onChange={(event) => {
              if (!event.target.value) return replace()
              replace({ field: selected, kind: 'text', value: event.target.value })
            }}
            placeholder="Filter values…"
            value={filter?.kind === 'text' ? filter.value : ''}
          />
        </label>
      )}

      {column && ['object', 'array', 'binary'].includes(column.type) && (
        <p className="empty-note">This column type can't be filtered. Use search instead.</p>
      )}

      {filter && (
        <Button compact onClick={() => replace()} variant="ghost">
          Remove this filter
        </Button>
      )}
      </div>
    </div>
  )
}
