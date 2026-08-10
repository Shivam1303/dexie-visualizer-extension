import { useEffect, useRef, useState } from 'react'
import { isOpaque } from '../../shared/codec'
import { ChevronIcon } from './Icons'
import type { RecordPatch } from '../../datasource/types'

function isBranch(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object' && !(value instanceof Date) && !isOpaque(value)
}

/** The type the write will coerce back to — worth showing while editing. */
function typeName(value: unknown): string {
  if (value === null || value === undefined) return 'empty'
  if (value instanceof Date) return 'date'
  if (isOpaque(value)) return value.kind.toLowerCase()
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="json-null">null</span>
  if (value === undefined) return <span className="json-null">undefined</span>
  if (value instanceof Date) return <span className="json-date">{value.toISOString()}</span>
  if (typeof value === 'string') return <span className="json-string">“{value}”</span>
  if (typeof value === 'boolean') return <span className="json-boolean">{String(value)}</span>
  return <span className="json-number">{String(value)}</span>
}

function toInputValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

interface LeafProps {
  value: unknown
  path: string[]
  patch?: RecordPatch
  editable?: boolean
  onEdit?: (path: string[], value: unknown) => void
  onRevert?: (path: string[]) => void
}

/**
 * Read-first: a value looks like a value until you click it. Reading a record is
 * the common task; editing one is deliberate, and making every leaf a permanent
 * input turned the record into a wall of boxes.
 */
function Leaf({ value, path, patch, editable, onEdit, onRevert }: LeafProps) {
  const staged = patch !== undefined
  const current = staged ? patch.value : value
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => toInputValue(current))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(toInputValue(current))
  }, [current, editing])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  // Binary can't survive the JSON transport, so it is never offered for editing —
  // showing an input here would be offering to destroy it.
  if (isOpaque(value)) {
    return (
      <span className="json-binary" title="Binary data can't be edited here">
        {value.kind} · {value.size} B
      </span>
    )
  }

  if (!editable || !onEdit || path.length === 0) return <Primitive value={value} />

  function commit(next: string) {
    setEditing(false)
    if (next !== toInputValue(value)) onEdit!(path, next)
    else onRevert?.(path)
  }

  if (editing) {
    if (typeof value === 'boolean') {
      return (
        <span className="leaf-editor">
          <select
            autoFocus
            className="json-input"
            onBlur={() => setEditing(false)}
            onChange={(event) => {
              setEditing(false)
              const next = event.target.value === 'true'
              if (next !== value) onEdit!(path, next)
              else onRevert?.(path)
            }}
            value={String(current)}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
          <span className="type-hint">boolean</span>
        </span>
      )
    }

    return (
      <span className="leaf-editor">
        <input
          className="json-input"
          onBlur={() => commit(draft)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(draft)
            if (event.key === 'Escape') {
              setDraft(toInputValue(current))
              setEditing(false)
            }
          }}
          ref={inputRef}
          type={typeof value === 'number' ? 'number' : 'text'}
          value={draft}
        />
        <span className="type-hint">{typeName(value)}</span>
      </span>
    )
  }

  return (
    <span className="leaf-view">
      <button
        aria-label={`Edit ${path.join('.')}`}
        className="value-button"
        onClick={() => setEditing(true)}
        type="button"
      >
        {staged ? (
          <>
            <span className="was">
              <Primitive value={value} />
            </span>
            <span className="arrow" aria-hidden="true">
              →
            </span>
            <span className="now">{toInputValue(patch.value) || '(empty)'}</span>
          </>
        ) : (
          <Primitive value={value} />
        )}
      </button>
      {staged && (
        <>
          <span className="type-hint">{typeName(value)}</span>
          <button
            aria-label={`Undo change to ${path.join('.')}`}
            className="revert-button"
            onClick={() => onRevert?.(path)}
            title="Undo this change"
            type="button"
          >
            ⨯
          </button>
        </>
      )}
    </span>
  )
}

interface NodeProps extends Omit<LeafProps, 'patch'> {
  name?: string
  depth: number
  staged?: Map<string, RecordPatch>
}

function JsonNode({ name, value, depth, path, editable, staged, onEdit, onRevert }: NodeProps) {
  const [expanded, setExpanded] = useState(depth < 2)

  if (!isBranch(value)) {
    const patch = staged?.get(path.join('.'))
    return (
      <div className={`json-line ${patch ? 'is-staged' : ''}`}>
        {name !== undefined && <span className="json-key">{name}</span>}
        <Leaf
          editable={editable}
          onEdit={onEdit}
          onRevert={onRevert}
          patch={patch}
          path={path}
          value={value}
        />
      </div>
    )
  }

  const entries = Object.entries(value)
  const opening = Array.isArray(value) ? '[' : '{'
  const closing = Array.isArray(value) ? ']' : '}'
  // Without this, a staged change inside a collapsed branch is invisible.
  const prefix = `${path.join('.')}.`
  const hasStagedChild =
    path.length > 0 && staged !== undefined && [...staged.keys()].some((key) => key.startsWith(prefix))

  return (
    <div className="json-node">
      <button className="json-toggle" onClick={() => setExpanded((open) => !open)} type="button">
        <ChevronIcon direction={expanded ? 'down' : 'right'} />
        {name !== undefined && <span className="json-key">{name}</span>}
        <span className="json-punct">{opening}</span>
        {!expanded && (
          <span className="json-summary">
            {entries.length} {entries.length === 1 ? 'field' : 'fields'}
            <span className="json-punct"> {closing}</span>
          </span>
        )}
        {!expanded && hasStagedChild && <span className="staged-pip" title="Contains staged changes" />}
      </button>
      {expanded && (
        <div className="json-children">
          {entries.map(([key, child]) => (
            <JsonNode
              depth={depth + 1}
              editable={editable}
              key={key}
              name={key}
              onEdit={onEdit}
              onRevert={onRevert}
              path={[...path, key]}
              staged={staged}
              value={child}
            />
          ))}
          <div className="json-closing">{closing}</div>
        </div>
      )}
    </div>
  )
}

export function JsonTree({
  value,
  editable = false,
  staged,
  onEdit,
  onRevert,
}: {
  value: unknown
  editable?: boolean
  staged?: Map<string, RecordPatch>
  onEdit?: (path: string[], value: unknown) => void
  onRevert?: (path: string[]) => void
}) {
  return (
    <div className="json-tree">
      <JsonNode
        depth={0}
        editable={editable}
        onEdit={onEdit}
        onRevert={onRevert}
        path={[]}
        staged={staged}
        value={value}
      />
    </div>
  )
}
