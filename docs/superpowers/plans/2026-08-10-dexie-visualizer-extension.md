# Dexie Visualizer Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome MV3 extension whose side panel browses and live-edits the IndexedDB of whichever tab you clicked the extension icon on.

**Architecture:** Three entry points — a React side panel (UI), a background service worker (connection tracking + message relay), and an on-demand-injected content script (runs in the page's origin, owns all raw IndexedDB access). The panel never touches IndexedDB directly; it talks to a `DataSource` interface whose only v1 implementation, `RemoteBridgeSource`, marshals RPC calls through the background worker to the content script.

**Tech Stack:** Vite 6 + `@crxjs/vite-plugin` + React 19 + TypeScript (non-strict) + Zustand + TanStack Table/Virtual + Vitest + `fake-indexeddb`. Plain CSS (no Tailwind). **No Dexie** — the content script uses raw IndexedDB, and file import is out of v1 scope.

## Global Constraints

- **TypeScript non-strict.** `tsconfig` sets `"strict": false`, `"noImplicitAny": false`. Types are for editor support, not enforcement. Never add strict-mode-only ceremony (exhaustive null guards, `as const` gymnastics) to satisfy a checker that is off.
- **Chromium-only.** Relies on `indexedDB.databases()`; no Firefox/Safari shims.
- **Single connected tab.** Connecting to a tab replaces any previous connection. No multi-tab state anywhere.
- **`activeTab` permission only.** Never add `host_permissions` or `<all_urls>` content-script matches. The content script is injected programmatically via `chrome.scripting.executeScript` after an action click.
- **v1 write ops are update + delete only.** No create-row path in the RPC contract, the `DataSource` interface, or the UI.
- **Writes are immediate.** No staged/batched edit queue.
- **Never destroy untouched data.** `update` sends *field-level patches by path*, never a whole re-serialized record. See Task 2 for why this is non-negotiable.
- Extension surface is narrow (~400px default side panel). Layout must work at 360px and scale up; no fixed-width sidebar grid.

---

## File Structure

```
manifest.json              MV3 manifest (action, side_panel, background, scripting+sidePanel+activeTab perms)
vite.config.ts             CRXJS plugin + React, side panel + background + content inputs
tsconfig.json              non-strict
src/
  shared/
    rpc.ts                 message envelope + op-name constants (imported by all 3 contexts)
    codec.ts               encode/decode IndexedDB values across the JSON messaging boundary
    filters.ts             valueAt / matchesQuery / compareValues  (ported from parent query.ts)
    columns.ts             inferColumns                            (ported from parent columns.ts)
  content/
    idb.ts                 raw IndexedDB engine: list/introspect/sample/query/patch/delete
    content.ts             chrome.runtime.onMessage -> idb.ts, encoded responses
  background/
    background.ts          action click -> inject + mark connected; relay panel<->tab; staleness
  datasource/
    types.ts               DataSource interface + shared row/query types
    remoteBridge.ts        RemoteBridgeSource — DataSource over chrome.runtime messaging
  panel/
    index.html, main.tsx, App.tsx
    store.ts               zustand: connection status, active db/table
    components/            Button, Badge, Icons, JsonTree   (ported from parent)
    features/
      connect/ConnectScreen.tsx    disconnected / stale / injection-failed states
      overview/DbPicker.tsx        database + table selection
      table/TableBrowser.tsx       grid + search + sort + pagination
      table/FilterPanel.tsx        per-column filter widgets  (ported)
      detail/RowDrawer.tsx         JSON tree + inline edit + delete
    styles.css             ported + reflowed for a narrow panel
tests/                     vitest specs (codec, filters, columns, idb, remoteBridge)
```

---

### Task 1: Scaffold + tooling spike (highest-risk unknown first)

The one genuinely uncertain thing in this project is whether CRXJS emits the content script at a **stable, known path** we can hand to `chrome.scripting.executeScript({files:[...]})`. CRXJS is built around manifest-declared `content_scripts` (which auto-inject on `matches` and would force host permissions we refuse to ask for). Prove the programmatic-injection path works before building anything on top of it.

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `manifest.json`
- Create: `src/background/background.ts`, `src/content/content.ts`, `src/panel/index.html`, `src/panel/main.tsx`, `src/panel/App.tsx`

**Interfaces:**
- Produces: a loadable `dist/` extension; a known constant `CONTENT_SCRIPT_PATH` that `background.ts` injects.

- [ ] **Step 1: Init project and install dependencies**

```bash
npm init -y
npm i react react-dom zustand @tanstack/react-table @tanstack/react-virtual
npm i -D vite @vitejs/plugin-react @crxjs/vite-plugin typescript \
        @types/react @types/react-dom @types/chrome \
        vitest jsdom fake-indexeddb @testing-library/react @testing-library/jest-dom
```

Pin `vite@^6` and `@crxjs/vite-plugin@^2.7` (peer range covers Vite 6).

- [ ] **Step 2: Write `manifest.json`**

Note there is **no** `content_scripts` key and **no** `host_permissions` — that is the whole point.

```json
{
  "manifest_version": 3,
  "name": "Dexie Visualizer",
  "version": "0.1.0",
  "description": "Browse and edit a live page's IndexedDB from the side panel.",
  "permissions": ["activeTab", "scripting", "sidePanel"],
  "action": { "default_title": "Inspect this tab's IndexedDB" },
  "side_panel": { "default_path": "src/panel/index.html" },
  "background": { "service_worker": "src/background/background.ts", "type": "module" }
}
```

- [ ] **Step 3: Write `vite.config.ts` with an explicit fixed-name content script output**

The content script must be a self-contained IIFE at a predictable path. Give it its own rollup input and force its filename; CRXJS handles the manifest/panel/background side.

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    rollupOptions: {
      input: { content: 'src/content/content.ts' },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'content' ? 'content.js' : 'assets/[name]-[hash].js'),
        inlineDynamicImports: false,
      },
    },
  },
})
```

- [ ] **Step 4: Write the spike trio — ping round-trip**

`src/content/content.ts`:

```ts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PING') { sendResponse({ ok: true, origin: location.origin }); return true }
})
```

`src/background/background.ts`:

```ts
const CONTENT_SCRIPT_PATH = 'content.js'
let connectedTabId = null

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id })
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT_PATH] })
  connectedTabId = tab.id
  const pong = await chrome.tabs.sendMessage(tab.id, { type: 'PING' })
  console.log('[spike] pong from page:', pong)
})
```

`src/panel/App.tsx` renders a single `<h1>Dexie Visualizer</h1>` for now.

- [ ] **Step 5: Build and load the extension, and verify injection end-to-end**

Run: `npm run build`
Then: load `dist/` at `chrome://extensions` (Developer mode → Load unpacked), open any ordinary https page, click the extension icon.

Expected: `dist/content.js` exists at exactly that path; the side panel opens; the service-worker console logs `[spike] pong from page: {ok: true, origin: "https://…"}`.

**If `executeScript` cannot find `content.js`,** the fallback is to drop CRXJS for the content script only: keep CRXJS for panel+background, and add a second Vite config (`vite.content.config.ts`, `build.lib` IIFE, `emptyOutDir: false`) emitting `dist/content.js`, chained as `vite build && vite build -c vite.content.config.ts`. Decide here, record the outcome, and do not revisit later.

- [ ] **Step 6: Commit**

```bash
git init && git add -A
git commit -m "feat: scaffold MV3 extension with verified activeTab content-script injection"
```

---

### Task 2: Transport codec

**Why this exists:** `chrome.runtime.sendMessage` serializes with JSON, not structured clone. IndexedDB records routinely hold `Date`, `undefined`, `ArrayBuffer`, `Blob`, `Map`, `Set` — all of which JSON silently mangles. A naive pass would show a user a `Date` as a string and then, on save, *write that string back into their live database*. This module plus the patch-based `update` (Task 3) is what prevents that.

**Files:**
- Create: `src/shared/codec.ts`
- Test: `tests/codec.test.ts`

**Interfaces:**
- Produces: `encode(value): unknown`, `decode(value): unknown`, `isOpaque(value): boolean`.
  Encoded tagged forms: `{__t:'date',v:iso}`, `{__t:'undef'}`, `{__t:'bigint',v:string}`, `{__t:'map',v:[[k,v],…]}`, `{__t:'set',v:[…]}`, `{__t:'opaque',kind:'Blob'|'File'|'ArrayBuffer'|'TypedArray',size:number,mime?:string}`.
  `opaque` values are display-only markers — they decode to a marker object, are rendered as a non-editable badge, and can never be sent back in a patch.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { decode, encode, isOpaque } from '../src/shared/codec'

const round = (v) => decode(JSON.parse(JSON.stringify(encode(v))))

describe('codec', () => {
  it('round-trips primitives unchanged', () => {
    expect(round({ a: 1, b: 'x', c: true, d: null })).toEqual({ a: 1, b: 'x', c: true, d: null })
  })

  it('preserves Date as a real Date, not a string', () => {
    const out = round({ at: new Date('2026-05-20T10:46:00.000Z') })
    expect(out.at).toBeInstanceOf(Date)
    expect(out.at.toISOString()).toBe('2026-05-20T10:46:00.000Z')
  })

  it('preserves undefined instead of dropping the key', () => {
    const out = round({ maybe: undefined })
    expect('maybe' in out).toBe(true)
    expect(out.maybe).toBeUndefined()
  })

  it('round-trips Map and Set', () => {
    const out = round({ m: new Map([['k', 1]]), s: new Set([1, 2]) })
    expect(out.m).toBeInstanceOf(Map)
    expect(out.m.get('k')).toBe(1)
    expect(out.s).toBeInstanceOf(Set)
    expect([...out.s]).toEqual([1, 2])
  })

  it('marks binary values opaque rather than corrupting them', () => {
    const out = round({ buf: new Uint8Array([1, 2, 3]).buffer })
    expect(isOpaque(out.buf)).toBe(true)
    expect(out.buf.size).toBe(3)
  })

  it('round-trips nested structures and arrays', () => {
    const out = round({ list: [{ at: new Date(0) }, [1, 2]] })
    expect(out.list[0].at).toBeInstanceOf(Date)
    expect(out.list[1]).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/codec.test.ts`
Expected: FAIL — cannot resolve `../src/shared/codec`.

- [ ] **Step 3: Implement `src/shared/codec.ts`**

```ts
const TAG = '__t'
const OPAQUE = Symbol.for('dvx.opaque')

export function encode(value) {
  if (value === undefined) return { [TAG]: 'undef' }
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? { [TAG]: 'bigint', v: value.toString() } : value
  }
  if (value instanceof Date) return { [TAG]: 'date', v: value.toISOString() }
  if (value instanceof Map) return { [TAG]: 'map', v: [...value].map(([k, v]) => [encode(k), encode(v)]) }
  if (value instanceof Set) return { [TAG]: 'set', v: [...value].map(encode) }
  if (value instanceof Blob) {
    return { [TAG]: 'opaque', kind: value instanceof File ? 'File' : 'Blob', size: value.size, mime: value.type }
  }
  if (value instanceof ArrayBuffer) return { [TAG]: 'opaque', kind: 'ArrayBuffer', size: value.byteLength }
  if (ArrayBuffer.isView(value)) return { [TAG]: 'opaque', kind: 'TypedArray', size: value.byteLength }
  if (Array.isArray(value)) return value.map(encode)
  const out = {}
  for (const key of Object.keys(value)) out[key] = encode(value[key])
  return out
}

export function decode(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(decode)
  switch (value[TAG]) {
    case 'undef': return undefined
    case 'date': return new Date(value.v)
    case 'bigint': return BigInt(value.v)
    case 'map': return new Map(value.v.map(([k, v]) => [decode(k), decode(v)]))
    case 'set': return new Set(value.v.map(decode))
    case 'opaque': return { [OPAQUE]: true, kind: value.kind, size: value.size, mime: value.mime }
  }
  const out = {}
  for (const key of Object.keys(value)) out[key] = decode(value[key])
  return out
}

export function isOpaque(value) {
  return Boolean(value && typeof value === 'object' && value[OPAQUE])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/codec.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/codec.ts tests/codec.test.ts
git commit -m "feat: add transport codec preserving Date/Map/Set and flagging binary as opaque"
```

---

### Task 3: Ported filter/sort/column logic

Straight ports from the parent project, with the Dexie coupling removed — these become pure functions over plain rows so both the content script (matching during a cursor scan) and tests can use them.

**Files:**
- Create: `src/shared/filters.ts` (port of `../Dexie-visualizer/src/db/query.ts` helpers)
- Create: `src/shared/columns.ts` (port of `../Dexie-visualizer/src/db/columns.ts`, minus `discoverColumns`)
- Create: `src/datasource/types.ts`
- Test: `tests/filters.test.ts`, `tests/columns.test.ts`

**Interfaces:**
- Produces: `valueAt(row, field)`, `matchesQuery(row, query)`, `compareValues(a, b)` from `filters.ts`; `inferColumns(rows): InferredColumn[]` from `columns.ts`.
- Produces (`datasource/types.ts`): `TableQuery { page, pageSize, search?, sort?: {field, direction}, filters?: FilterRule[] }`, `FilterRule` (text/number/boolean/date/enum — copy the parent's union verbatim), `KeyedRow { key, value }`, `QueryPage { rows: KeyedRow[], total, page, pageSize }`, `StoreMeta { name, keyPath, autoIncrement, indexes: [{name, keyPath, unique, multiEntry}], count }`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { compareValues, matchesQuery, valueAt } from '../src/shared/filters'

describe('valueAt', () => {
  it('reads nested paths', () => {
    expect(valueAt({ product: { category: { name: 'Drinks' } } }, 'product.category.name')).toBe('Drinks')
  })
  it('returns undefined for a missing path instead of throwing', () => {
    expect(valueAt({ a: 1 }, 'a.b.c')).toBeUndefined()
  })
})

describe('matchesQuery', () => {
  const row = { name: 'Latte', price: 4.5, active: true, createdAt: '2026-05-20T10:46:00.000Z' }
  const base = { page: 0, pageSize: 50 }

  it('matches a case-insensitive text filter', () => {
    expect(matchesQuery(row, { ...base, filters: [{ field: 'name', kind: 'text', value: 'lat' }] })).toBe(true)
  })
  it('rejects a number filter outside the range', () => {
    expect(matchesQuery(row, { ...base, filters: [{ field: 'price', kind: 'number', min: 5 }] })).toBe(false)
  })
  it('ANDs multiple filters', () => {
    const filters = [{ field: 'active', kind: 'boolean', value: true }, { field: 'price', kind: 'number', max: 5 }]
    expect(matchesQuery(row, { ...base, filters })).toBe(true)
  })
  it('searches nested values', () => {
    expect(matchesQuery({ a: { b: 'needle' } }, { ...base, search: 'needle' })).toBe(true)
  })
  it('matches a date range', () => {
    const filters = [{ field: 'createdAt', kind: 'date', from: '2026-05-01', to: '2026-06-01' }]
    expect(matchesQuery(row, { ...base, filters })).toBe(true)
  })
})

describe('compareValues', () => {
  it('sorts numbers numerically and nullish last', () => {
    expect(compareValues(2, 10)).toBeLessThan(0)
    expect(compareValues(null, 1)).toBeGreaterThan(0)
  })
})
```

```ts
import { describe, expect, it } from 'vitest'
import { inferColumns } from '../src/shared/columns'

describe('inferColumns', () => {
  it('unions keys across rows in first-seen order', () => {
    expect(inferColumns([{ a: 1 }, { b: 2 }]).map((c) => c.key)).toEqual(['a', 'b'])
  })
  it('infers ISO strings as date', () => {
    expect(inferColumns([{ at: '2026-05-20T10:46:00.000Z' }])[0].type).toBe('date')
  })
  it('flags nullable columns and collects low-cardinality enums', () => {
    const [col] = inferColumns([{ s: 'a' }, { s: null }, { s: 'b' }, { s: 'a' }])
    expect(col.nullable).toBe(true)
    expect(col.enumValues.sort()).toEqual(['a', 'b'])
  })
  it('infers arrays and objects', () => {
    const cols = inferColumns([{ list: [1], obj: { x: 1 } }])
    expect(cols.find((c) => c.key === 'list').type).toBe('array')
    expect(cols.find((c) => c.key === 'obj').type).toBe('object')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/filters.test.ts tests/columns.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Port the implementations**

Copy `valueAt`, `searchableText`, `matchesFilter`, `matchesQuery`, `compareValues` from `../Dexie-visualizer/src/db/query.ts` into `src/shared/filters.ts`, dropping every `dexie` import and the `Table`-bound functions (`isIndexed`, `fastPage`, `chooseIndexedCollection`, `executeTableQuery`). Copy `ISO_DATE`, `ENUM_LIMIT`, `valueType`, `chooseType`, `inferColumns` from `../Dexie-visualizer/src/db/columns.ts` into `src/shared/columns.ts`, dropping `discoverColumns` (it took a Dexie `Table`; sampling now happens in the content script). Write `src/datasource/types.ts` per the Interfaces block above, copying the `FilterRule` union verbatim from the parent's `db/types.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/filters.test.ts tests/columns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/filters.ts src/shared/columns.ts src/datasource/types.ts tests/
git commit -m "feat: port filter/sort/column-inference logic decoupled from Dexie"
```

---

### Task 4: Content-script IndexedDB engine

The heart of the project. Pure IndexedDB, no chrome APIs, no React — so it is fully testable under `fake-indexeddb` (verified to implement `databases()`).

**Files:**
- Create: `src/content/idb.ts`
- Test: `tests/idb.test.ts`

**Interfaces:**
- Consumes: `matchesQuery`, `compareValues`, `valueAt` (Task 3); `TableQuery`, `QueryPage`, `StoreMeta` (Task 3).
- Produces:
  - `listDatabases(): Promise<{name, version}[]>`
  - `listStores(dbName): Promise<StoreMeta[]>`
  - `sampleRows(dbName, storeName, limit=200): Promise<any[]>` — raw values for column inference
  - `queryStore(dbName, storeName, query): Promise<QueryPage>` — `rows` are `{key, value}`
  - `patchRecord(dbName, storeName, key, patches): Promise<any>` — `patches: Array<{path: string[], value: any}>`; returns the updated record
  - `deleteRecord(dbName, storeName, key): Promise<void>`

**Design notes an implementer must honor:**
- `queryStore` never materializes full rows for the whole store: the cursor pass keeps only `{key, sortValue}` tuples, sorts those, slices the page, then re-fetches just that page's records by key. (Filter/search matching does need each row transiently inside the cursor callback — that is fine, it is one row at a time and never retained.)
- Rows come back **keyed**, because out-of-line-key stores (`keyPath === null`) do not carry their key inside the record, and edit/delete need it.
- `patchRecord` re-reads the record inside the same transaction and mutates only the given paths. Untouched fields keep their real native types — this is what protects `Blob`s and `Date`s the panel never saw properly. Type coercion is deliberate and narrow: if the existing value at a path is a `Date` and the incoming value is a date-parseable string, store a `Date`; if the existing value is a `number` and the incoming is a numeric string, store a `number`; otherwise store as given.

- [ ] **Step 1: Write the failing test**

```ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteRecord, listDatabases, listStores, patchRecord, queryStore, sampleRows } from '../src/content/idb'

function seed() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('POSdb_test', 1)
    req.onupgradeneeded = () => {
      const products = req.result.createObjectStore('product', { keyPath: 'uuid' })
      products.createIndex('categoryId', 'categoryId', { unique: false })
      req.result.createObjectStore('logs', { autoIncrement: true })
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['product', 'logs'], 'readwrite')
      const products = tx.objectStore('product')
      for (let i = 0; i < 25; i += 1) {
        products.put({
          uuid: `u${String(i).padStart(2, '0')}`,
          name: i % 2 ? `Latte ${i}` : `Mocha ${i}`,
          price: i,
          categoryId: i % 3,
          createdAt: new Date(2026, 0, i + 1),
          meta: { tags: ['a', 'b'] },
        })
      }
      tx.objectStore('logs').put({ msg: 'first' })
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  })
}

beforeEach(async () => {
  await new Promise((r) => { const d = indexedDB.deleteDatabase('POSdb_test'); d.onsuccess = r; d.onerror = r; d.onblocked = r })
  await seed()
})

describe('listDatabases / listStores', () => {
  it('enumerates databases', async () => {
    expect(await listDatabases()).toEqual(expect.arrayContaining([{ name: 'POSdb_test', version: 1 }]))
  })

  it('reports keyPath, indexes and counts per store', async () => {
    const stores = await listStores('POSdb_test')
    const product = stores.find((s) => s.name === 'product')
    expect(product.keyPath).toBe('uuid')
    expect(product.count).toBe(25)
    expect(product.indexes).toEqual([{ name: 'categoryId', keyPath: 'categoryId', unique: false, multiEntry: false }])
    const logs = stores.find((s) => s.name === 'logs')
    expect(logs.keyPath).toBeNull()
    expect(logs.autoIncrement).toBe(true)
  })
})

describe('sampleRows', () => {
  it('caps the sample at the requested limit', async () => {
    expect(await sampleRows('POSdb_test', 'product', 10)).toHaveLength(10)
  })
})

describe('queryStore', () => {
  it('pages unfiltered rows and reports the true total', async () => {
    const page = await queryStore('POSdb_test', 'product', { page: 0, pageSize: 10 })
    expect(page.rows).toHaveLength(10)
    expect(page.total).toBe(25)
    expect(page.rows[0].key).toBe('u00')
    expect(page.rows[0].value.name).toBe('Mocha 0')
  })

  it('returns keys for out-of-line-key stores', async () => {
    const page = await queryStore('POSdb_test', 'logs', { page: 0, pageSize: 10 })
    expect(page.rows[0].key).toBe(1)
    expect(page.rows[0].value).toEqual({ msg: 'first' })
  })

  it('filters, and totals only matching rows', async () => {
    const page = await queryStore('POSdb_test', 'product', {
      page: 0, pageSize: 50, filters: [{ field: 'name', kind: 'text', value: 'latte' }],
    })
    expect(page.total).toBe(12)
    expect(page.rows.every((r) => r.value.name.startsWith('Latte'))).toBe(true)
  })

  it('sorts descending across the whole match set, not just the page', async () => {
    const page = await queryStore('POSdb_test', 'product', {
      page: 0, pageSize: 5, sort: { field: 'price', direction: 'desc' },
    })
    expect(page.rows.map((r) => r.value.price)).toEqual([24, 23, 22, 21, 20])
  })

  it('searches nested values', async () => {
    const page = await queryStore('POSdb_test', 'product', { page: 0, pageSize: 50, search: 'tags' })
    expect(page.total).toBe(0)
    const hit = await queryStore('POSdb_test', 'product', { page: 0, pageSize: 50, search: 'Mocha 4' })
    expect(hit.total).toBe(1)
  })
})

describe('patchRecord', () => {
  it('updates only the patched path and leaves siblings byte-identical', async () => {
    const updated = await patchRecord('POSdb_test', 'product', 'u01', [{ path: ['name'], value: 'Renamed' }])
    expect(updated.name).toBe('Renamed')
    expect(updated.price).toBe(1)
    expect(updated.createdAt).toBeInstanceOf(Date)
    expect(updated.meta.tags).toEqual(['a', 'b'])
  })

  it('patches a nested path', async () => {
    const updated = await patchRecord('POSdb_test', 'product', 'u02', [{ path: ['meta', 'tags', '0'], value: 'z' }])
    expect(updated.meta.tags).toEqual(['z', 'b'])
  })

  it('keeps a Date a Date when given a date string', async () => {
    const updated = await patchRecord('POSdb_test', 'product', 'u03', [
      { path: ['createdAt'], value: '2027-03-01T00:00:00.000Z' },
    ])
    expect(updated.createdAt).toBeInstanceOf(Date)
    expect(updated.createdAt.toISOString()).toBe('2027-03-01T00:00:00.000Z')
  })

  it('coerces a numeric string back to a number', async () => {
    const updated = await patchRecord('POSdb_test', 'product', 'u04', [{ path: ['price'], value: '99' }])
    expect(updated.price).toBe(99)
  })

  it('works on out-of-line-key stores', async () => {
    const updated = await patchRecord('POSdb_test', 'logs', 1, [{ path: ['msg'], value: 'edited' }])
    expect(updated.msg).toBe('edited')
  })

  it('rejects a patch against a missing key', async () => {
    await expect(patchRecord('POSdb_test', 'product', 'nope', [{ path: ['name'], value: 'x' }])).rejects.toThrow(/not found/i)
  })
})

describe('deleteRecord', () => {
  it('removes the row', async () => {
    await deleteRecord('POSdb_test', 'product', 'u05')
    const page = await queryStore('POSdb_test', 'product', { page: 0, pageSize: 50 })
    expect(page.total).toBe(24)
    expect(page.rows.some((r) => r.key === 'u05')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/idb.test.ts`
Expected: FAIL — cannot resolve `../src/content/idb`.

- [ ] **Step 3: Implement `src/content/idb.ts`**

```ts
import { compareValues, matchesQuery, valueAt } from '../shared/filters'

function open(dbName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error(`Opening "${dbName}" is blocked by another connection.`))
  })
}

async function withStore(dbName, storeName, mode, run) {
  const db = await open(dbName)
  try {
    if (!db.objectStoreNames.contains(storeName)) {
      throw new Error(`Object store "${storeName}" does not exist in "${dbName}".`)
    }
    const tx = db.transaction(storeName, mode)
    const result = await run(tx.objectStore(storeName))
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted.'))
    })
    return result
  } finally {
    db.close()
  }
}

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

export async function listDatabases() {
  const dbs = await indexedDB.databases()
  return dbs.filter((db) => db.name).map((db) => ({ name: db.name, version: db.version }))
}

export async function listStores(dbName) {
  const db = await open(dbName)
  try {
    const names = [...db.objectStoreNames]
    if (names.length === 0) return []
    const tx = db.transaction(names, 'readonly')
    return await Promise.all(names.map(async (name) => {
      const store = tx.objectStore(name)
      return {
        name,
        keyPath: store.keyPath ?? null,
        autoIncrement: store.autoIncrement,
        indexes: [...store.indexNames].map((indexName) => {
          const index = store.index(indexName)
          return { name: indexName, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }
        }),
        count: await request(store.count()),
      }
    }))
  } finally {
    db.close()
  }
}

export function sampleRows(dbName, storeName, limit = 200) {
  return withStore(dbName, storeName, 'readonly', (store) => new Promise((resolve, reject) => {
    const rows = []
    const cursorReq = store.openCursor()
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result
      if (!cursor || rows.length >= limit) { resolve(rows); return }
      rows.push(cursor.value)
      cursor.continue()
    }
    cursorReq.onerror = () => reject(cursorReq.error)
  }))
}

export function queryStore(dbName, storeName, query) {
  const page = Math.max(0, query.page ?? 0)
  const pageSize = Math.max(1, query.pageSize ?? 50)
  const normalized = { ...query, page, pageSize }

  return withStore(dbName, storeName, 'readonly', async (store) => {
    const tuples = await new Promise((resolve, reject) => {
      const collected = []
      const cursorReq = store.openCursor()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor) { resolve(collected); return }
        if (matchesQuery(cursor.value, normalized)) {
          collected.push({
            key: cursor.primaryKey,
            sortValue: normalized.sort ? valueAt(cursor.value, normalized.sort.field) : cursor.primaryKey,
          })
        }
        cursor.continue()
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })

    const direction = normalized.sort?.direction === 'desc' ? -1 : 1
    tuples.sort((left, right) => compareValues(left.sortValue, right.sortValue) * direction)

    const start = page * pageSize
    const keys = tuples.slice(start, start + pageSize).map((tuple) => tuple.key)
    const rows = await Promise.all(keys.map(async (key) => ({ key, value: await request(store.get(key)) })))

    return { rows: rows.filter((row) => row.value !== undefined), total: tuples.length, page, pageSize }
  })
}

function coerce(existing, next) {
  if (existing instanceof Date && typeof next === 'string') {
    const time = Date.parse(next)
    if (!Number.isNaN(time)) return new Date(time)
  }
  if (typeof existing === 'number' && typeof next === 'string' && next.trim() !== '' && !Number.isNaN(Number(next))) {
    return Number(next)
  }
  return next
}

function applyPatch(record, path, value) {
  let target = record
  for (const segment of path.slice(0, -1)) {
    if (target === null || typeof target !== 'object') throw new Error(`Cannot patch path ${path.join('.')}.`)
    target = target[segment]
  }
  const leaf = path[path.length - 1]
  if (target === null || typeof target !== 'object') throw new Error(`Cannot patch path ${path.join('.')}.`)
  target[leaf] = coerce(target[leaf], value)
}

export function patchRecord(dbName, storeName, key, patches) {
  return withStore(dbName, storeName, 'readwrite', async (store) => {
    const record = await request(store.get(key))
    if (record === undefined) throw new Error(`Record "${String(key)}" not found in "${storeName}".`)
    for (const patch of patches) applyPatch(record, patch.path, patch.value)
    await request(store.keyPath === null ? store.put(record, key) : store.put(record))
    return record
  })
}

export function deleteRecord(dbName, storeName, key) {
  return withStore(dbName, storeName, 'readwrite', (store) => request(store.delete(key)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/idb.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/content/idb.ts tests/idb.test.ts
git commit -m "feat: add IndexedDB engine with keyed paging and patch-based writes"
```

---

### Task 5: RPC contract, content-script handler, background relay

**Files:**
- Create: `src/shared/rpc.ts`
- Modify: `src/content/content.ts` (replace the Task 1 ping spike)
- Modify: `src/background/background.ts` (replace the Task 1 spike)

**Interfaces:**
- Consumes: all of `src/content/idb.ts` (Task 4); `encode` (Task 2).
- Produces (`rpc.ts`): `OPS = { LIST_DATABASES, LIST_STORES, SAMPLE_ROWS, QUERY, PATCH, DELETE, HELLO }`; request `{ op, args }`; response `{ ok: true, data }` or `{ ok: false, error: string }`; panel→background control messages `{ type: 'GET_CONNECTION' }` and `{ type: 'RPC', payload }`; background→panel broadcast `{ type: 'CONNECTION_CHANGED', connection }`, where `connection` is `{ tabId, origin, title, status: 'connected' | 'stale' | 'none', error? }`.

- [ ] **Step 1: Write `src/shared/rpc.ts`** — the op constants and envelope shapes above, plus `const RPC_ERROR_NO_TAB = 'No tab is connected. Click the extension icon on the tab you want to inspect.'`.

- [ ] **Step 2: Implement the content-script handler**

Every response body passes through `encode` exactly once, at this boundary. Errors become `{ ok: false, error: message }` — never let a rejection escape into the messaging layer, where it would surface as an opaque "message port closed".

```ts
import { OPS } from '../shared/rpc'
import { encode } from '../shared/codec'
import { deleteRecord, listDatabases, listStores, patchRecord, queryStore, sampleRows } from './idb'

const handlers = {
  [OPS.HELLO]: async () => ({ origin: location.origin, title: document.title }),
  [OPS.LIST_DATABASES]: () => listDatabases(),
  [OPS.LIST_STORES]: ({ dbName }) => listStores(dbName),
  [OPS.SAMPLE_ROWS]: ({ dbName, storeName, limit }) => sampleRows(dbName, storeName, limit),
  [OPS.QUERY]: ({ dbName, storeName, query }) => queryStore(dbName, storeName, query),
  [OPS.PATCH]: ({ dbName, storeName, key, patches }) => patchRecord(dbName, storeName, key, patches),
  [OPS.DELETE]: ({ dbName, storeName, key }) => deleteRecord(dbName, storeName, key),
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.op]
  if (!handler) return undefined
  Promise.resolve()
    .then(() => handler(message.args ?? {}))
    .then((data) => sendResponse({ ok: true, data: encode(data) }))
    .catch((error) => sendResponse({ ok: false, error: error?.message ?? String(error) }))
  return true
})
```

Guard against double injection (clicking the icon twice on one tab would register two listeners): wrap the file in an `if (!window.__dvxInstalled) { window.__dvxInstalled = true; … }` sentinel.

- [ ] **Step 3: Implement the background relay**

Responsibilities, in order: on action click — open the side panel, inject, `HELLO` to learn the origin, mark connected, broadcast. On `chrome.tabs.onUpdated` (loading) / `onRemoved` for the connected tab — mark `stale` and broadcast, because `activeTab` access does not survive navigation. On `{type:'RPC'}` from the panel — forward to the connected tab, and translate a missing/dead content script into `{ok:false, error}` rather than an unhandled rejection.

```ts
import { OPS, RPC_ERROR_NO_TAB } from '../shared/rpc'

const CONTENT_SCRIPT_PATH = 'content.js'
let connection = { tabId: null, origin: null, title: null, status: 'none' }

function broadcast() {
  chrome.runtime.sendMessage({ type: 'CONNECTION_CHANGED', connection }).catch(() => {})
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return
  await chrome.sidePanel.open({ tabId: tab.id })
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT_PATH] })
    const hello = await chrome.tabs.sendMessage(tab.id, { op: OPS.HELLO, args: {} })
    if (!hello?.ok) throw new Error(hello?.error ?? 'The content script did not respond.')
    connection = { tabId: tab.id, origin: hello.data.origin, title: hello.data.title, status: 'connected' }
  } catch (error) {
    connection = { tabId: null, origin: null, title: null, status: 'none', error: `Can't connect to this page. ${error?.message ?? ''}`.trim() }
  }
  broadcast()
})

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === connection.tabId && info.status === 'loading') {
    connection = { ...connection, status: 'stale' }
    broadcast()
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === connection.tabId) {
    connection = { tabId: null, origin: null, title: null, status: 'none' }
    broadcast()
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_CONNECTION') { sendResponse(connection); return undefined }
  if (message?.type !== 'RPC') return undefined
  if (connection.status !== 'connected') { sendResponse({ ok: false, error: RPC_ERROR_NO_TAB }); return undefined }
  chrome.tabs.sendMessage(connection.tabId, message.payload)
    .then((response) => sendResponse(response ?? { ok: false, error: 'No response from the page.' }))
    .catch((error) => {
      connection = { ...connection, status: 'stale' }
      broadcast()
      sendResponse({ ok: false, error: error?.message ?? 'Lost contact with the page.' })
    })
  return true
})
```

- [ ] **Step 4: Rebuild and verify the real round-trip manually**

Run: `npm run build`, reload the unpacked extension, open a site that uses IndexedDB, click the icon.
Expected: in the side-panel devtools console, `chrome.runtime.sendMessage({type:'RPC', payload:{op:'LIST_DATABASES', args:{}}})` resolves to `{ok:true, data:[…]}` naming that site's real databases. Then navigate the tab and confirm a `CONNECTION_CHANGED` with `status:'stale'` arrives.

- [ ] **Step 5: Commit**

```bash
git add src/shared/rpc.ts src/content/content.ts src/background/background.ts
git commit -m "feat: add RPC contract, content-script dispatcher and background relay"
```

---

### Task 6: DataSource + RemoteBridgeSource

**Files:**
- Create: `src/datasource/remoteBridge.ts`
- Test: `tests/remoteBridge.test.ts`

**Interfaces:**
- Consumes: `OPS` (Task 5), `decode` (Task 2), types (Task 3).
- Produces: `createRemoteBridgeSource(): DataSource` with `listDatabases()`, `listStores(dbName)`, `sampleRows(dbName, storeName, limit)`, `query(dbName, storeName, query)`, `update(dbName, storeName, key, patches)`, `deleteRow(dbName, storeName, key)`. Every method resolves to decoded data or rejects with an `Error` carrying the relay's message.

This is the seam that makes the panel testable without a browser tab: swap in any object with these six methods.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRemoteBridgeSource } from '../src/datasource/remoteBridge'
import { encode } from '../src/shared/codec'

let sendMessage

beforeEach(() => {
  sendMessage = vi.fn()
  globalThis.chrome = { runtime: { sendMessage } }
})

describe('RemoteBridgeSource', () => {
  it('wraps calls in an RPC envelope and decodes the reply', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: encode([{ key: 'u1', value: { at: new Date(0) } }]) })
    const source = createRemoteBridgeSource()
    const result = await source.listDatabases()
    expect(sendMessage).toHaveBeenCalledWith({ type: 'RPC', payload: { op: 'LIST_DATABASES', args: {} } })
    expect(result[0].value.at).toBeInstanceOf(Date)
  })

  it('rejects with the relay error message', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'No tab is connected.' })
    await expect(createRemoteBridgeSource().listDatabases()).rejects.toThrow('No tab is connected.')
  })

  it('passes patches through on update', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: encode({ name: 'x' }) })
    await createRemoteBridgeSource().update('db', 'store', 'k', [{ path: ['name'], value: 'x' }])
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'RPC',
      payload: { op: 'PATCH', args: { dbName: 'db', storeName: 'store', key: 'k', patches: [{ path: ['name'], value: 'x' }] } },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/remoteBridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/datasource/remoteBridge.ts`**

```ts
import { decode, encode } from '../shared/codec'
import { OPS } from '../shared/rpc'

async function call(op, args = {}) {
  const response = await chrome.runtime.sendMessage({ type: 'RPC', payload: { op, args } })
  if (!response?.ok) throw new Error(response?.error ?? 'The page did not respond.')
  return decode(response.data)
}

export function createRemoteBridgeSource() {
  return {
    listDatabases: () => call(OPS.LIST_DATABASES),
    listStores: (dbName) => call(OPS.LIST_STORES, { dbName }),
    sampleRows: (dbName, storeName, limit) => call(OPS.SAMPLE_ROWS, { dbName, storeName, limit }),
    query: (dbName, storeName, query) => call(OPS.QUERY, { dbName, storeName, query }),
    update: (dbName, storeName, key, patches) =>
      call(OPS.PATCH, { dbName, storeName, key: encode(key), patches: encode(patches) }),
    deleteRow: (dbName, storeName, key) => call(OPS.DELETE, { dbName, storeName, key: encode(key) }),
  }
}
```

Note the content script must `decode` incoming `key`/`patches` args symmetrically — add that to its dispatcher (`handler(decode(message.args ?? {}))`) so a `Date` primary key survives the trip out and back.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/remoteBridge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/datasource/remoteBridge.ts tests/remoteBridge.test.ts
git commit -m "feat: add DataSource bridge over extension messaging"
```

---

### Task 7: Panel shell, connection UX and live-edit banner

**Files:**
- Create: `src/panel/store.ts`, `src/panel/App.tsx`, `src/panel/features/connect/ConnectScreen.tsx`, `src/panel/styles.css`
- Create: `src/panel/components/Button.tsx`, `Badge.tsx`, `Icons.tsx`, `JsonTree.tsx` (ported from parent)

**Interfaces:**
- Consumes: `createRemoteBridgeSource` (Task 6).
- Produces: `useAppStore` with `{ connection, dbName, storeName, setConnection, setDbName, setStoreName, reset }`; `App` renders `ConnectScreen` unless `connection.status === 'connected'`.

- [ ] **Step 1: Port the presentational components**

Copy `Button.tsx`, `Badge.tsx`, `Icons.tsx`, `JsonTree.tsx` verbatim from `../Dexie-visualizer/src/components/`. Copy `styles.css`, then delete the `@import "tailwindcss"` line (no Tailwind here) and the upload/dropzone/boot-screen rules (no upload flow), and replace `.app-shell`'s `grid-template-columns: 250px minmax(0,1fr)` with a single-column flex layout — the side panel is ~400px wide and cannot afford a persistent sidebar.

- [ ] **Step 2: Implement the store and connection wiring**

`App` asks the background for the current connection on mount (`{type:'GET_CONNECTION'}`) and subscribes to `CONNECTION_CHANGED`:

```tsx
useEffect(() => {
  chrome.runtime.sendMessage({ type: 'GET_CONNECTION' }).then(setConnection).catch(() => {})
  const onMessage = (message) => {
    if (message?.type === 'CONNECTION_CHANGED') setConnection(message.connection)
  }
  chrome.runtime.onMessage.addListener(onMessage)
  return () => chrome.runtime.onMessage.removeListener(onMessage)
}, [])
```

Changing tabs must reset the browsing position — `setConnection` clears `dbName`/`storeName` whenever `tabId` changes.

- [ ] **Step 3: Implement `ConnectScreen` for all three non-connected states**

- `status: 'none'` with no error → "Click the extension icon on the tab you want to inspect."
- `status: 'none'` with an error → show `connection.error` verbatim (this is the restricted-page case, e.g. `chrome://` URLs, where injection throws).
- `status: 'stale'` → "That page reloaded or navigated. Click the extension icon again to reconnect." Explain plainly that per-click access does not survive navigation, so this is expected rather than a bug.

- [ ] **Step 4: Implement the persistent live-edit banner**

Rendered above everything whenever connected, never collapsible, showing the real origin:

```tsx
<div className="live-banner" role="status">
  <span className="live-dot" />
  <div><strong>Live</strong><span>Editing {connection.origin}</span></div>
</div>
```

Style it as a warning surface (not the calm accent green used for the parent app's read-only "Connected" badge) — every write from this panel hits a real running site immediately and cannot be undone.

- [ ] **Step 5: Build, reload, and verify each state manually**

Run: `npm run build` and reload the extension.
Expected: before any click, the panel shows the "click the icon" prompt; after clicking on a normal page, the live banner shows that page's origin; reloading that tab flips it to the reconnect prompt; clicking the icon on a `chrome://extensions` tab shows the "can't connect to this page" error.

- [ ] **Step 6: Commit**

```bash
git add src/panel package.json
git commit -m "feat: add panel shell with connection lifecycle and live-edit banner"
```

---

### Task 8: Database/store selection and the table browser

**Files:**
- Create: `src/panel/features/overview/DbPicker.tsx`, `src/panel/features/table/TableBrowser.tsx`, `src/panel/features/table/FilterPanel.tsx`
- Modify: `src/panel/App.tsx`

**Interfaces:**
- Consumes: `DataSource` (Task 6), `inferColumns` (Task 3), `JsonTree`/`Button`/`Badge` (Task 7).
- Produces: `TableBrowser` calling `onSelectRow(keyedRow)` for Task 9.

- [ ] **Step 1: Implement `DbPicker`**

On connect, `listDatabases()`; on database choice, `listStores(dbName)`. Render databases as a `<select>` and stores as a scrollable list showing name, row count, and `PK <keyPath>` (or `auto-increment key` when `keyPath` is null). Empty stores render dimmed but selectable. A site with zero databases gets an explicit "This page has no IndexedDB databases" message rather than an empty list.

- [ ] **Step 2: Port `FilterPanel`**

Copy `../Dexie-visualizer/src/features/table/FilterPanel.tsx` verbatim; the only change is the import path for `InferredColumn` (`../../../shared/columns`) and `FilterRule` (`../../../datasource/types`). Its widget-per-type logic is unchanged.

- [ ] **Step 3: Implement `TableBrowser`**

Port the structure of `../Dexie-visualizer/src/features/table/TableBrowser.tsx` with four deliberate changes:
1. `useLiveQuery` is gone — there is no local Dexie to observe. Use `useEffect` + a `reload` counter, and keep the parent's 250 ms debounce on search input.
2. Columns come from `inferColumns(await source.sampleRows(dbName, storeName, 200))`, not `discoverColumns(table)`.
3. Rows are `{key, value}` — feed `rows.map(r => r.value)` to TanStack Table, and keep the `key` alongside for the drawer.
4. Render an `isOpaque(value)` cell as a `<Badge tone="neutral">{kind} · {size}B</Badge>`, so binary fields are visibly present but obviously not text.

Keep the parent's virtualized grid, header-scroll sync, sort cycling (asc → desc → none), page-size select, and pagination footer as-is.

- [ ] **Step 4: Verify against a real site**

Run: `npm run build`, reload, click the icon on a site with a populated IndexedDB.
Expected: databases list; picking a store lists real rows; typing in search narrows the total; clicking a header cycles sort and the order actually changes across pages; a filter on a numeric column narrows results.

- [ ] **Step 5: Commit**

```bash
git add src/panel/features
git commit -m "feat: add database picker and live table browser"
```

---

### Task 9: Row drawer with live edit and delete

**Files:**
- Create: `src/panel/features/detail/RowDrawer.tsx`
- Modify: `src/panel/components/JsonTree.tsx` (add optional editing)
- Modify: `src/panel/features/table/TableBrowser.tsx` (wire drawer + reload after write)

**Interfaces:**
- Consumes: `DataSource.update` / `DataSource.deleteRow` (Task 6), `isOpaque` (Task 2).
- Produces: `RowDrawer({ source, dbName, storeName, row, onClose, onChanged })`, where `row` is `{key, value}` and `onChanged()` triggers a re-query in the browser.

- [ ] **Step 1: Extend `JsonTree` with opt-in leaf editing**

Add props `editable` and `onEdit(path, value)`. When `editable`, a primitive leaf renders as an `<input>` seeded with its current value; on blur or Enter it calls `onEdit(path, value)`. Leaves where `isOpaque(value)` render as a read-only badge and are never editable — the codec cannot round-trip binary, so offering to edit it would be offering to destroy it. `Date` leaves edit as their ISO string; the content script's `coerce` turns a valid one back into a real `Date`.

- [ ] **Step 2: Implement `RowDrawer`**

Hold `pendingPatches` as a `Map` keyed by `path.join('.')` so re-editing one field replaces rather than stacks. Header shows the record's key. Footer has Cancel, Save (disabled when there are no pending patches), and Delete.

- [ ] **Step 3: Implement save and delete**

Save calls `source.update(dbName, storeName, row.key, [...pendingPatches.values()])`, then `onChanged()`. The spec requires the grid to reflect the *actual* post-write state, so `onChanged` re-runs the query rather than patching local state — if the site's own code or an IndexedDB constraint altered the outcome, the user sees the truth.

Delete requires an inline two-step confirm inside the drawer (the Delete button becomes "Confirm delete" / "Cancel"), never a bare `window.confirm`, and never a single click — there is no undo.

Both paths catch and render the error inline in the drawer (`.inline-error`) while leaving the drawer open and the panel usable, per the spec's error-handling rules.

- [ ] **Step 4: Verify the round-trip on a real site**

Run: `npm run build`, reload, open a row on a live site.
Expected: edit a string field → Save → the grid cell shows the new value, and the site's own devtools (Application → IndexedDB) shows it changed. Edit a `Date` field to a new ISO string → Save → re-open the row and confirm it is still rendered as a date, not a string. Delete a row → confirm → total drops by one. Attempt to edit a row containing a Blob → that field is a read-only badge while its siblings remain editable, and saving a sibling leaves the Blob intact.

- [ ] **Step 5: Commit**

```bash
git add src/panel
git commit -m "feat: add row drawer with patch-based live edit and guarded delete"
```

---

### Task 10: Final verification pass

- [ ] **Step 1: Run the whole automated suite**

Run: `npx vitest run && npx tsc -b --pretty false`
Expected: all specs pass; no type errors (non-strict, so this is a sanity check, not a gate).

- [ ] **Step 2: Walk the manual checklist**

Automated tests cover the codec, filters, columns, the IndexedDB engine and the bridge. They cannot cover the background relay, injection, or the React panel — per the spec that is deliberate, so this checklist is the real gate. On a live site: connect · list dbs · pick a store · page · sort · filter · search · open a row · edit · save · verify in the site's own devtools · delete · confirm · reload the tab · see the stale prompt · reconnect · click the icon on a `chrome://` page · see the friendly error.

- [ ] **Step 3: Write `README.md`**

Cover: what it does, `npm run build`, load-unpacked instructions, the click-the-icon connection model and why reconnecting after navigation is expected, the Chromium-only constraint, and an explicit warning that edits write immediately to real site data with no undo.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: add README and complete v1 verification pass"
```

---

## Self-Review

**Spec coverage:** connection model → Tasks 5, 7; `activeTab`-only → Tasks 1, 5 (+ Global Constraints); single tab → Task 5; list dbs/tables → Tasks 4, 8; browse/filter/search/sort → Tasks 3, 4, 8; live edit (update + delete) → Tasks 4, 9; live-edit banner → Task 7; re-query after write → Task 9; delete confirm → Task 9; `DataSource` interface + `RemoteBridgeSource` only → Task 6; ported code → Tasks 3, 7, 8; error handling (injection failure, staleness, write errors, per-table errors) → Tasks 5, 7, 8, 9; testing strategy → Tasks 2, 3, 4, 6, 10.

**Out-of-scope guard:** no task creates rows, imports files, adds host permissions, builds `LocalDexieSource`, or tracks a second tab.

**Deviation from spec worth noting:** the spec's module layout put `columns.ts`/`query.ts` at `src/` root and named the write op `update(…, changes)`. This plan puts shared pure logic under `src/shared/` (it is imported by all three runtime contexts, so a neutral home is clearer) and makes `changes` an explicit list of `{path, value}` patches. The patch shape is a hard requirement rather than a preference: JSON messaging cannot round-trip `Blob`/`ArrayBuffer`, so writing back a whole re-serialized record would silently destroy binary fields in a live database. Patching by path touches only what the user actually edited.
