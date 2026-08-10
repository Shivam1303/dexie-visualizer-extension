# Dexie Visualizer Extension

A Chrome MV3 extension that opens a full-page workspace to browse and **live-edit**
the IndexedDB of whichever site tab you clicked it on. No export file, no import step.

Grows out of [`Dexie-visualizer`](../Dexie-visualizer), which reads a
`dexie-export-import` JSON snapshot. A plain web page can't read another origin's
IndexedDB, so reaching a live site needs a content script running in that page's
own origin — hence an extension.

> **Edits are immediate and cannot be undone.** Saving a change writes straight into
> a real running site's storage. The workspace shows a permanent "Live — editing
> `<origin>`" banner whenever it is connected.

## Requirements

- Node **v24.11.1** (see `.nvmrc`; `nvm use` picks it up)
- A Chromium browser. Firefox and Safari aren't supported — the extension relies on
  `indexedDB.databases()` enumeration.

## Build and install

```bash
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked**
→ select the `dist/` folder.

Rebuild and hit the reload icon on the extension card to pick up changes.

## Using it

1. Open the tab you want to inspect.
2. Click the extension icon **on that tab**. A visualizer tab opens and connects.
3. Pick a database, then an object store, then browse.
4. Click a row to open it; edit leaf values inline and press **Save**, or delete it.

**Reconnecting is expected.** Access is granted per click via the `activeTab`
permission and covers only that tab, and it does not survive a reload or a
navigation. When the page navigates, the workspace asks you to click the icon again.
That's the permission model working, not a bug — it's why the extension needs no
standing access to any site.

Only one tab is connected at a time; clicking the icon elsewhere moves the
connection.

## Testing

```bash
npm test        # vitest
npm run typecheck
```

Automated tests cover the pure logic: the transport codec, filter/search/sort
predicates, column inference, the IndexedDB engine (under `fake-indexeddb`), and the
messaging bridge.

The background relay, the content-script injection, and the React workspace are verified
by hand — open `test-page/index.html` (via any local static server, or straight from
`file://`) and connect to it. It seeds `DvxTestDB` with the awkward cases on purpose:
real `Date` objects, a `Blob`, nested objects and arrays, an out-of-line
auto-increment store, and a compound-key store.

## How it fits together

```
workspace tab (React)       background service worker         content script
  DataSource  ──RPC──▶  tracks the one connected site ──▶  raw IndexedDB
                        + relays messages                   (site's own origin)
```

The workspace never touches IndexedDB. It depends on the `DataSource` interface
(`src/datasource/types.ts`), whose only implementation today is `RemoteBridgeSource`
— which means the UI can be driven by any mock with those six methods.

### Two details worth knowing

**Writes are patches, not whole records.** `chrome.runtime` messaging serializes with
JSON, not structured clone, so `Blob`s and `ArrayBuffer`s can't survive a round trip.
Rewriting a whole record would silently destroy them. Instead the panel sends only
the paths you actually edited, and the content script applies them to a freshly-read
record inside one transaction. Everything you didn't touch keeps its real native
type. Binary fields render as read-only badges and can never be edited.

**The content script is built separately.** `chrome.scripting.executeScript({files})`
injects a *classic* script, so `dist/content.js` must contain zero `import`
statements. In a single build Rollup hoists anything shared with the panel into a
common chunk and leaves an import behind, so `vite.content.config.ts` builds it as a
standalone IIFE (`npm run build` runs both, in order).

## Scope

v1 does: connect to one tab, list databases and stores, browse with search / filters
/ sort / paging, update and delete rows.

v1 does not: create rows, import files, connect to several tabs, or request standing
host permissions.
