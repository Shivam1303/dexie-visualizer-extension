# Dexie Visualizer Extension — Project Brief

> **Renamed since this was written.** The extension ships as **IndexedDB Workbench**
> (see `docs/PUBLISHING.md` for why). This doc keeps its original wording as a record
> of the project's starting context; `../Dexie-visualizer` below still refers to the
> real sibling directory.

Status: **draft — pre-brainstorming context transfer, not an approved spec**
Date: 2026-08-10
Related project: `../Dexie-visualizer` (the file-import Dexie export viewer this extension grows out of)

This doc exists so a fresh Claude Code session started in this directory has full
context on why this project exists and what's already been decided vs. still open.
Read this first, then invoke the `superpowers:brainstorming` skill to continue —
the clarifying-question pass got interrupted before completion (see "Open
questions" below), so don't skip straight to a design doc.

## Where this came from

The parent project, `Dexie-visualizer`, is a local, client-side tool that imports a
Dexie `dexie-export-import` JSON export file and lets you browse it: table list,
virtualized grid, per-column filters, search, sort, row detail drawer with a JSON
tree. It's read-only and file-based — you export a `.json`/`.txt` snapshot from a
site, then upload it. See `../Dexie-visualizer/docs/superpowers/specs/2026-08-07-dexie-visualizer-design.md`
for the full design of that tool; the query/pagination/column-inference patterns
there (`src/db/query.ts`, `src/db/columns.ts`) are worth reusing or porting rather
than reinventing.

While using it, the idea came up: instead of manually exporting a file each time,
**connect the visualizer directly to a live site that's using IndexedDB** (a
project the user is actively developing) and view/play with its data in place.

## Why this needs to be a separate project (and an extension)

A plain web page (e.g. the existing Vite app) cannot read another origin's
IndexedDB — browser same-origin policy blocks it outright, no matter what code
runs in this repo. The only way to get same-origin access to a site's IndexedDB
without modifying that site's own code is to run code *inside* that page's
context, which in a browser means a **browser extension content script**.
Content scripts run in an isolated JS *world* but share the page's real origin,
so `indexedDB.open(...)` inside one sees the exact same databases the page sees.

Two other approaches were considered and set aside for now:

- **DevTools Protocol / Puppeteer companion** — attach to the dev site via
  `--remote-debugging-port` and evaluate JS in-page to dump/patch IndexedDB. No
  extension install, but it's a CLI/automation script, not an interactive UI.
- **Manual snapshot (bookmarklet + existing import flow)** — lowest effort, but
  view-only and not live — doesn't satisfy "play around with" the data.

Decision: build a browser extension. This is a genuinely different runtime
(extension manifest, background service worker, content scripts, messaging,
permissions) from the existing plain web app, which is why it's its own project
rather than a feature branch of `Dexie-visualizer`.

## Proposed architecture (discussed, not yet locked in)

- **Shape**: Chrome MV3 extension. The visualizer UI lives in a
  `chrome.sidePanel`, opened via the extension action on whichever tab you want
  to inspect. Likely built with `@crxjs/vite-plugin` or
  `vite-plugin-web-extension` so the existing React/Vite UI patterns can carry
  over instead of hand-rolling extension bundling.
- **Content script** (`content.js`), injected on demand into the target tab
  (favor `activeTab` permission + "click the extension icon on the tab you want"
  over broad `<all_urls>` host permissions, to keep the permission prompt
  minimal). It:
  - Enumerates databases via `indexedDB.databases()`.
  - Introspects each object store's `keyPath`/indexes.
  - Answers an RPC-style message protocol from the side panel: `listTables`,
    `query(store, filters/sort/page)`, and — if edit is in scope — `put`/`delete`.
- **Background service worker** (`background.js`) relays messages between the
  side panel and whichever tab is currently "connected."
- **Core refactor this forces**: today `src/db/query.ts` and `src/db/columns.ts`
  in the parent project take a raw Dexie `Table` handle directly. To support a
  remote live tab as a data source, introduce a `DataSource` interface
  (`listTables`, `query`, later `put`/`delete`) with two implementations:
  - `LocalDexieSource` — wraps a real local Dexie handle (today's file-import
    behavior, if/when this extension also supports importing a file directly).
  - `RemoteBridgeSource` — talks to the content script over `chrome.runtime`
    messaging, using the same windowed-paging strategy `query.ts` already uses
    (never materialize a whole table — page through cursors).
  Everything UI-level should depend on the interface, not on Dexie directly.

## Known constraints / caveats

- Realistically Chromium-only at first — `indexedDB.databases()` enumeration
  isn't supported the same way in Firefox/Safari.
- Large object stores need cursor-based paging inside the content script;
  extension messaging can't carry a whole table through in one shot.
- Editing live data means mutating a real running site's storage — the UI needs
  to make it unmistakable when you're in "live edit" mode vs. read-only browsing.
- If the target site happens to use Dexie itself, the content script could reuse
  `dexie-export-import`'s `exportDB` against `new Dexie(dbName)` for a
  snapshot/export path; sites using raw IndexedDB need the hand-rolled
  cursor-based introspection regardless.

## Open questions (resolve these first in the new session)

The brainstorming clarifying-question pass was interrupted right after scoping
started, so none of these are decided yet:

1. **View-only vs. live edit ("play around")** — the original ask was "view and
   play around," implying edit/write-back, but this was never confirmed
   explicitly. Note: the parent project has a *separate*, already-deferred
   edit/delete feature for the file-import viewer — decide whether this
   extension's live-edit scope is related to or independent of that.
2. **Code sharing with `Dexie-visualizer`** — copy/port reusable pieces
   (components, column inference, query/pagination logic) vs. share via a
   monorepo/package vs. build fresh. Affects repo setup before any code is
   written.
3. **v1 operation set** — is v1 view/query only (list tables, browse, filter,
   search — mirroring the parent app's existing scope), with edit/delete/create
   explicitly out, or in from the start?
4. **Single connected tab vs. multiple** — can the side panel be connected to
   more than one tab/site at once, or one at a time?
5. **Permission model specifics** — `activeTab`-per-click vs. persistent host
   permissions per site the user has already approved.
6. **Build tooling choice** — `@crxjs/vite-plugin` vs. `vite-plugin-web-extension`
   vs. something else; whether to keep this as a plain npm project or add a
   manifest-driven multi-entry Vite config from the start.

## Next step

Invoke `superpowers:brainstorming` in this directory, starting from the open
questions above (they're the "ask clarifying questions" step), through proposing
2-3 approaches for the code-sharing question, to a design doc under
`docs/superpowers/specs/`, then `superpowers:writing-plans`. Nothing here is
final — treat it as a running start, not a spec to implement against.
