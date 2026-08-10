# Imported Snapshot Integration — Design Proposal

Status: **approved and implemented**  
Date: 2026-08-10  
Supersedes: the earlier decision to keep file import outside this extension

## Outcome

Make this repository the single Dexie visualizer product. The same full-page workspace will support two clearly separated data sources:

1. **Live site** — the current extension bridge reads and mutates the connected tab's real IndexedDB.
2. **Imported snapshot** — a Dexie `.json` or `.txt` export is imported into IndexedDB owned by the extension. Browse, edit, and delete operate only on that local copy.

The sibling `Dexie-visualizer` repository will no longer be required for normal use. This phase copies/adapts its proven import logic; it does not modify or delete the sibling repository.

## Why This Fits the Current Architecture

The React workspace already depends on a six-method `DataSource` contract rather than Chrome messaging directly. `RemoteBridgeSource` remains the live implementation. A new `ImportedDexieSource` will implement the same methods against a Dexie database in the extension origin:

```text
                         ┌─ RemoteBridgeSource ─ background/content ─ site IndexedDB
React workspace ─ DataSource
                         └─ ImportedDexieSource ─ extension-owned IndexedDB
```

Search, filters, sorting, paging, column inference, row editing, and deletion remain shared UI. Source-specific behavior stays below the `DataSource` boundary.

## User Experience

### Source selection

Add a prominent source switcher above the sidebar navigation:

- **Live site** shows the connected origin and retains the amber “Live editing” treatment.
- **Imported copy** shows the source filename and a blue/green “Local copy” treatment.
- **Import export** opens the import flow from either mode.

If the extension action successfully connects a site, a newly opened workspace starts in Live mode. If there is no live connection but a saved import exists, it starts in Imported mode. A failed connection must still leave the import option usable.

Database and store selections reset when switching source so names from one source cannot leak into the other.

### Import flow

The existing full-page styling will be reused for a three-step flow:

1. Choose or drag a `.json`/`.txt` Dexie export.
2. Inspect metadata and show database name, version, stores, populated stores, total rows, and file size.
3. Confirm import and show row-level progress.

Cancel returns to the current source without changing it. Replacing an imported snapshot keeps the previous snapshot available until the replacement completes successfully.

### Imported-copy operations

Imported rows remain editable and deletable through the existing drawer. Copy changes make the boundary explicit:

- “Local copy — changes do not affect the source site or original export file.”
- Save confirmation: “Saved to imported copy.”
- Delete confirmation remains required.
- A “Remove imported copy” action deletes only extension-owned storage after confirmation.

No operation writes back into the selected export file.

## Import Storage and Failure Safety

Use `dexie` and `dexie-export-import`; `dexie-react-hooks` is not needed because the current workspace refreshes through `DataSource` calls.

Only one imported snapshot is active in v1. Session metadata is stored in `chrome.storage.local` and contains:

```ts
interface ImportedSession {
  version: 1
  storageName: string       // generated internal IndexedDB name
  databaseName: string      // original display name
  databaseVersion: number
  fileName: string
  importedAt: string
  tables: ExportTableMeta[]
}
```

The export library supports a destination `name`. Each import therefore targets a generated name such as `dvx-import-<uuid>`, never the original database name. This prevents collisions and enables safe replacement:

1. Validate extension and non-empty file.
2. Read metadata with `peakImportFile()` without modifying storage.
3. Import into a new generated database using the library's default transaction and progress callback.
4. Open it and verify expected stores are present.
5. Save the new session metadata.
6. Close and delete the previous imported database.

If steps 3–4 fail, delete only the partial new database and retain the prior session. If metadata persistence fails, retain the prior session and clean up the new database. Startup discards corrupt metadata and reports a missing backing database instead of creating an empty one.

The raw file is not retained after import. The imported database persists across browser restarts until replaced or removed.

## ImportedDexieSource Behavior

- `listDatabases()` returns the original display name/version from the active session.
- `listStores()` maps Dexie primary-key and index schema plus live counts to `StoreMeta`.
- `sampleRows()` reads a bounded sample for shared column inference.
- `query()` returns `{ key, value }` rows and reuses shared `matchesQuery`, `valueAt`, and `compareValues` semantics so Live and Imported modes behave identically.
- `update()` performs read/patch/write in one Dexie transaction and supports inbound, outbound, compound, and `Date` keys.
- `deleteRow()` deletes by primary key in one transaction.

The record patch/coercion helper was moved from `content/idb.ts` to a Chrome-independent shared module. Both sources now apply identical Date/number/boolean edit coercion.

## State and Component Changes

```text
src/
  datasource/
    importedDexie.ts          new local DataSource
  import/
    database.ts               open/close/delete extension-owned DBs
    importFile.ts             inspect + atomic import/swap
    session.ts                chrome.storage.local metadata
    types.ts                  preview/session/progress types
  panel/features/import/
    ImportScreen.tsx          drop, preview, progress, confirm
  shared/
    recordPatches.ts          shared patch/coercion logic
```

`App.tsx` becomes a source coordinator rather than assuming every workspace requires `connection.status === 'connected'`. Zustand gains `sourceMode`; database/store selection resets on mode changes. Existing background/content RPC code remains unchanged.

## Security and Privacy

- Imported data stays inside the extension origin and is inaccessible to target sites.
- No host permissions are added; live access remains per-click `activeTab`.
- No network upload or telemetry is introduced.
- File contents and row values must never be logged.
- UI color and wording always distinguish live-site writes from local-copy writes.
- Import libraries run in the workspace page, not the content script or background worker.

## Testing Strategy

Automated coverage includes:

- file type, empty file, invalid JSON, and invalid session rejection;
- import preview and successful import of a generated fixture;
- failed replacement preserving the previous session/database;
- `ImportedDexieSource` store metadata, paging, search, sort, update, and delete;
- shared patch behavior for number, boolean, Date, and nested fields;
- source switching resets database and store selections;
- all existing remote bridge/content engine tests remain green.

Manual verification will cover a large real export without committing that private fixture, browser restart persistence, replacing/removing an import, and switching repeatedly between Live and Imported modes.

## Delivery Sequence

1. Add dependencies and import/session primitives with tests.
2. Extract shared patch logic and implement `ImportedDexieSource` with tests.
3. Add source coordination, switcher, and import screen.
4. Adapt safety wording and imported-copy removal.
5. Run typecheck, full tests, production extension build, and manual Chrome flow.
6. Update README and the original architecture document to describe the unified product.

## Non-Goals for This Phase

- Creating new rows.
- Writing changes back into the export file.
- Exporting the modified local copy.
- Keeping multiple imported snapshots simultaneously.
- Merging imported data into a live site.
- Changing the existing live-tab permission model.

## Approval Decisions

Approval of this proposal confirms these recommended choices:

1. **One imported snapshot at a time**, replaceable atomically.
2. **Edit and delete enabled** for the imported local copy.
3. **Imported data persists across browser restarts** until explicitly removed.
4. **No create-row or re-export feature** in this phase.
5. **One shared workspace UI** with strongly differentiated Live and Imported modes.

These decisions were approved and implemented on 2026-08-10.
