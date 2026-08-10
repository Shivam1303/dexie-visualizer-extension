# Dexie Visualizer Extension

A Chrome MV3 extension with one full-page workspace for two workflows:

- connect to a site tab and browse or **live-edit** its IndexedDB;
- import a Dexie export and work safely on an extension-owned local copy.

A plain web page cannot read another origin's IndexedDB, so live access uses a
content script in the connected page. Imports use `dexie-export-import` directly
inside the extension workspace.

> **Edits are immediate and cannot be undone.** Saving a change writes straight into
> a real running site's storage. The workspace shows a permanent "Live — editing
> `<origin>`" banner whenever it is connected.

Imported edits are also immediate, but affect only the local imported copy—not the
original file and not any website.

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

To inspect an export instead, choose **Import Dexie export**, select or drop a Dexie
`.json`/`.txt` export, review its metadata, and confirm. The source switcher lets
you move between a connected live site and the imported copy.

**Reconnecting is expected.** Access is granted per click via the `activeTab`
permission and covers only that tab, and it does not survive a reload or a
navigation. When the page navigates, the workspace asks you to click the icon again.
That's the permission model working, not a bug — it's why the extension needs no
standing access to any site.

Only one tab is connected at a time; clicking the icon elsewhere moves the
connection.

### Where imported data is stored

The raw selected file is not retained. Its contents are copied into IndexedDB under
the extension origin (`chrome-extension://<extension-id>`) using an internal name
such as `dvx-import-<uuid>`; small session metadata lives in
`chrome.storage.local`. It is not associated with a website URL. One imported copy
is kept at a time and persists until you replace it, remove it, or clear the
extension's data.

## Testing

```bash
npm test        # vitest
npm run typecheck
```

Automated tests cover the transport codec, filtering and sorting, column inference,
the live IndexedDB engine, the imported Dexie source, atomic replacement, shared
record patches, the messaging bridge, and key workspace components.

The background relay, the content-script injection, and the React workspace are verified
by hand — open `test-page/index.html` (via any local static server, or straight from
`file://`) and connect to it. It seeds `DvxTestDB` with the awkward cases on purpose:
real `Date` objects, a `Blob`, nested objects and arrays, an out-of-line
auto-increment store, and a compound-key store.

## How it fits together

```
                               ┌─ background/content ─ site IndexedDB
workspace tab ─ DataSource ────┤
                               └─ Dexie ─ extension-owned IndexedDB
```

The workspace depends on the `DataSource` interface
(`src/datasource/types.ts`). `RemoteBridgeSource` reaches a connected tab through
Chrome messaging; `ImportedDexieSource` works directly against extension storage.
The same browser, filter, editor, and delete UI is shared by both.

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

v1 does: connect to one tab or keep one imported snapshot, list databases and
stores, browse with search / filters / sort / paging, update and delete rows.

v1 does not: create rows, export a modified snapshot, merge an import into a live
site, keep multiple imports, connect to several tabs, or request standing host
permissions.
