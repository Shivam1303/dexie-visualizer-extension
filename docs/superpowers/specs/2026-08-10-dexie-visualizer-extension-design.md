# Dexie Visualizer Extension — Design

Status: approved
Date: 2026-08-10
Related project: `../Dexie-visualizer` (the file-import Dexie export viewer this extension grows out of; see `../Dexie-visualizer/docs/superpowers/specs/2026-08-07-dexie-visualizer-design.md`)

## Purpose

A Chrome MV3 extension that opens a side panel to browse and edit a live web page's IndexedDB in place — no export/import step required. Grows out of `Dexie-visualizer`, which only works against a manually-exported file; this extension connects directly to a site that's actively using IndexedDB.

## Why an extension

A plain web page cannot read another origin's IndexedDB — same-origin policy blocks it regardless of what code runs in this repo. The only way to get same-origin access without modifying the target site's own code is a browser extension content script: it runs in an isolated JS world but shares the page's real origin, so `indexedDB.open(...)` inside it sees exactly what the page sees.

Two alternatives were considered and set aside: a DevTools Protocol/Puppeteer companion script (no install, but CLI-only, not an interactive UI) and a manual snapshot/bookmarklet (lowest effort, but view-only, not live).

## Scope (v1)

In:
- Connect to exactly one tab at a time, via clicking the extension icon on that tab (`activeTab` permission — no persistent host grants, no upfront permission prompt beyond the click itself).
- List databases/tables on the connected tab.
- Browse: virtualized grid, per-column type-aware filters, search, sort, row detail drawer with an expandable JSON tree — same UX as the parent app.
- **Live edit**: update and delete existing rows, written straight to the connected page's real IndexedDB.
- Live-tab data only.

Out (explicitly cut, revisit later if needed):
- Multiple simultaneous connected tabs — one at a time only.
- Persistent host permissions — always per-click `activeTab`.
- Row creation (`put` of a brand-new key) — v1 write ops are update + delete only.
- File import inside the extension itself — that stays the parent app's job; `LocalDexieSource` (see Architecture) is not built in this phase.
- Firefox/Safari support — `indexedDB.databases()` enumeration isn't supported the same way there; Chromium-only for now.
- Offline/staged edit queue — writes go through immediately, no batching.

## Architecture

Chrome MV3 extension built with `@crxjs/vite-plugin`, giving multi-entry Vite builds (side panel, background, content script) and HMR for the side panel UI during dev — lets the existing React/Vite patterns from `Dexie-visualizer` carry over largely as-is.

Three entry points:

- **Side panel** (`chrome.sidePanel`) — the visualizer UI, opened via the extension action on the tab you want to inspect.
- **Background service worker** (`background.js`) — tracks which tab the side panel is currently connected to, relays messages between panel and content script, and injects the content script on icon-click (`chrome.scripting.executeScript` under `activeTab`).
- **Content script** (`content.js`) — injected on demand into the connected tab. Runs in the page's real origin.

### RPC protocol (side panel ⇄ background ⇄ content script, via `chrome.runtime` messaging)

- `listDatabases()` → enumerate via `indexedDB.databases()`
- `listTables(dbName)` → object stores + `keyPath`/indexes for a db
- `query(dbName, store, { filters, sort, page })` → cursor-paged rows, mirroring the windowed-paging strategy in the parent's `query.ts` — never materialize a full store
- `update(dbName, store, key, changes)` → `put` the modified record
- `deleteRow(dbName, store, key)` → `delete` the record

### Connection lifecycle

Clicking the icon on a tab injects the content script into that tab and marks it "connected" in the background worker, replacing any prior connection. If the tab navigates or reloads, the connection is dropped (per-click `activeTab` access doesn't survive navigation) and the side panel shows a "reconnect" prompt rather than silently failing queries.

### DataSource interface

UI code depends on a `DataSource` interface (`listTables`, `query`, `update`, `deleteRow`), not on `chrome.runtime` messaging directly — this keeps the side-panel UI unit-testable against a mock/in-memory `DataSource` without a real browser tab, the same way the parent project tests `db/*` logic headlessly. `RemoteBridgeSource` (wrapping the RPC calls above) is the only implementation built in v1; `LocalDexieSource` (wrapping a real local Dexie handle, for a possible future file-import mode in the extension) is deferred until there's an actual second consumer.

## Live-edit safety UX

- A persistent, unmissable banner is shown whenever connected: "Live — editing `<site origin>`" — not a subtle icon, since every edit/delete here mutates a real running site's storage immediately, with no undo.
- Row edits happen inline in the detail drawer; on save, `update` is sent and the grid's row is refreshed from a re-query (not just patched locally), so the panel reflects the actual post-write state.
- Delete requires an inline confirm.

## Module layout

Ported/adapted from `Dexie-visualizer`. TypeScript, non-strict compiler settings.

```
src/
  datasource/
    types.ts          DataSource interface, Query/Row/Column types
    remoteBridge.ts    RemoteBridgeSource — wraps RPC calls to the content script
    rpc.ts             chrome.runtime message contract (shared by content/background/panel)
  content/
    content.ts         indexedDB introspection + query/update/delete handlers
  background/
    background.ts       connection tracking, message relay, script injection
  panel/                 side panel React app (entry point)
    features/           overview/, table/, detail/ — ported from parent, adapted to DataSource
    components/         ported primitives (Button, Select, Badge, JsonTree, ...)
    store/               zustand app state (active db/table, connection status)
  columns.ts             ported column-inference logic (unchanged, works over any Row[])
  query.ts               windowed-paging query builder, adapted to call DataSource instead of a raw Dexie Table
```

## Error handling

- Content-script injection fails (e.g. a restricted page like `chrome://...`) → side panel shows "can't connect to this page" instead of a blank/broken UI.
- Tab navigates away/reloads mid-session → connection marked stale, side panel prompts to reconnect.
- `update`/`deleteRow` throws (e.g. a constraint error from the page's own IndexedDB) → inline error surfaced at the row; the live-edit banner stays up and the rest of the panel keeps working.
- Query/render errors on a single table → caught per-table, shown as an inline banner, not a full-panel crash.

## Testing

- `columns.ts`, `query.ts`, and the `DataSource` interface: unit-testable headlessly against an in-memory mock `DataSource` — no real chrome APIs or live tab needed.
- `content.ts`'s IndexedDB introspection logic: testable with `fake-indexeddb` in isolation, since it's plain IndexedDB code independent of the messaging layer.
- Background worker relay and side-panel UI components: manual verification against a real loaded extension + a test page with IndexedDB data — no automated e2e in v1, consistent with the parent project's decision, given single-user local-tool scope.
