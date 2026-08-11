# Publishing to the Chrome Web Store

Everything here is copy-paste ready for the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
Claims about data handling were checked against the source: there are no `fetch`,
`XMLHttpRequest`, or external URL references anywhere in `src/`.

## Build the upload

```bash
npm run package
```

Produces `release/indexeddb-workbench-<version>.zip`, rooted so `manifest.json` sits at
the archive top level (the store rejects a zip that nests the extension in a folder).
The script fails the build if the 128px icon is missing, if the manifest references an
icon that is not in `dist/`, or if the root check fails, and warns about source maps.

**Bump `version` in `manifest.json` before every upload** — the store rejects a
re-upload of an existing version number.

## One-time account setup

1. Google account with **2-step verification enabled** (required for developers).
2. Register at the dashboard — **$5 one-time fee**, non-refundable.
3. Verify the contact email.
4. Complete the **trader / non-trader declaration** (EU Digital Services Act).
   Declaring "trader" publishes a real address and phone number on the listing.

## Listing copy

**Name:** `IndexedDB Workbench` — see [why](#why-the-name-is-indexeddb-workbench).

**Short description** (limit 132 chars; this is 64):

```
Browse and edit a live page's IndexedDB in a full-page workspace.
```

**Detailed description:**

```
A developer tool for inspecting and editing IndexedDB, in a full browser tab
instead of a cramped devtools pane.

Connect to a tab
• Click the extension icon on any tab to open a workspace connected to it.
• List its databases and object stores, then browse rows in a virtualized grid
  that stays responsive on large stores.
• Search across nested values, build type-aware column filters, sort, and page.
• Open any row to edit leaf values inline, or delete it.

Work on an import instead
• Load a Dexie export (.json / .txt) and browse or edit an extension-owned local
  copy, leaving the original file and every website untouched.
• Switch between a connected live tab and the imported copy at any time.

Types survive editing
Edits are sent as path patches, not whole-record rewrites, and are applied to a
freshly-read record inside a single transaction. Dates, Blobs, ArrayBuffers, and
nested structures you did not touch keep their real native types. Binary fields
are shown as read-only and can never be edited.

Access is per-click, never standing
There are no host permissions. Clicking the icon grants access to that one tab
via activeTab, and only for that origin. Navigating to a different origin
requires clicking again. The extension has no ability to read any site you have
not explicitly handed it.

IMPORTANT — edits are immediate and cannot be undone. Saving a change writes
straight into a real running site's storage. There is no undo and no
confirmation dialog beyond the save itself. A permanent banner shows the origin
you are editing whenever a live tab is connected.

Chromium only. Firefox and Safari are unsupported because the extension relies
on indexedDB.databases() enumeration.

Current scope: one connected tab or one imported snapshot at a time; browse,
update, and delete rows. It does not create rows, export a modified snapshot, or
merge an import into a live site.
```

**Category:** Developer Tools · **Language:** English

## Permission justifications

Paste each into the matching field on the **Privacy practices** tab.

| Permission | Justification |
|---|---|
| `activeTab` | Granted only when the user clicks the extension's toolbar icon on a tab. It is the mechanism by which the extension reads and writes that one tab's IndexedDB. The extension deliberately requests no host permissions, so it has no standing access to any site. |
| `scripting` | Used to inject the IndexedDB reader/writer into the tab the user explicitly activated. A page cannot read another origin's IndexedDB, so the code must run in the page. It is injected programmatically rather than declared as a content script, so nothing is injected anywhere until the user clicks. |
| `storage` | Stores small local session metadata (the selected database/store and the identifier of the current imported snapshot) via `chrome.storage.local`. No browsing history or site content is written here, and nothing is transmitted. |

**Single purpose:**

```
Inspect and edit the IndexedDB databases of a tab the user explicitly activates,
or of a Dexie export the user imports.
```

## Privacy practices answers

The extension makes no network requests of any kind. Everything stays on the
device, so the "data collection" declarations stay unchecked, and all three required
certifications are truthfully yes:

- Not sold or transferred to third parties beyond approved use cases — **yes**
- Not used or transferred for purposes unrelated to the single purpose — **yes**
- Not used or transferred to determine creditworthiness or for lending — **yes**

**Privacy policy URL.** Not strictly required when you declare no collection, but the
extension does read website content, and reviewers sometimes ask. `docs/PRIVACY.md`
is a ready-to-publish policy — host it (GitHub Pages, a gist, any static URL) and
paste the link. Cheap insurance against a round-trip rejection.

## Screenshots

1–5 images at **1280×800** (or 640×400). A useful shot list:

1. The grid connected to a live tab, with the live-editing banner visible.
2. A row open in the editor with a staged change showing `was → now`.
3. The filter panel with a couple of type-aware filters applied.
4. The import screen with an export's metadata under review.

Also required: a **440×280** small promo tile. The 1400×560 marquee is optional.

## Submitting

Upload the zip → fill the listing → set visibility → submit. Most reviews clear
inside 24 hours; `scripting` plus first-time developer status can stretch it to
several days.

**Recommendation:** publish **unlisted** first and use it yourself for a week. This
tool writes irreversibly to live databases, and an unlisted listing is a real install
from the store without a public audience for the first bug.

## Updating

Bump `manifest.json`, `npm run package`, upload, resubmit. Updates support
**partial rollout** by percentage, and a published version can be reverted.

## Why the name is "IndexedDB Workbench"

Renamed from "Dexie Visualizer" before first submission. That name borrowed a
third-party open-source library's name without affiliation — store policy prohibits
listings implying endorsement, and it was inaccurate besides, since the extension
reads *any* IndexedDB and Dexie only matters for the import path.

"Workbench" was chosen over the obvious alternatives because the existing extensions
in this category — IndexedDB Browser, IndexedDBEdit, IndexedDB Explorer, IndexedDB
Exporter — are all DevTools panels, and all of them already own the words `Browser`,
`Explorer`, `Viewer`, and `Edit`. This extension's differentiator is that it is a
full browser tab you work in, so the name keeps the searchable term `IndexedDB`
(nearly all discovery for a dev tool is search) while `Workbench` carries the
differentiator and implies editing rather than read-only inspection.

Renaming again after publishing costs the listing URL and its accumulated reviews, so
it is worth settling now rather than later.
