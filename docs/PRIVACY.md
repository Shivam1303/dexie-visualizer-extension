# Privacy Policy — IndexedDB Workbench

_Last updated: 11 August 2026_

## Summary

This extension makes no network requests. It has no server, no analytics, and no
telemetry. Nothing it reads ever leaves your device.

## What it accesses

**A tab's IndexedDB data, only when you ask.** Clicking the extension's toolbar icon
on a tab grants access to that one tab, using Chrome's `activeTab` permission. The
extension requests no host permissions, so it has no standing access to any website
and cannot read a site you have not explicitly activated it on. Navigating to a
different origin requires clicking the icon again.

**A Dexie export file, only when you choose one.** The selected file's contents are
copied into IndexedDB under the extension's own origin
(`chrome-extension://<extension-id>`). The original file is not retained or modified.

## What it stores, and where

| Data | Location | Lifetime |
|---|---|---|
| An imported snapshot's contents | The extension's own IndexedDB, under an internal name such as `dvx-import-<uuid>` | Until you replace it, remove it, or clear the extension's data. One import is kept at a time. |
| Session metadata — selected database and store, current import identifier | `chrome.storage.local` | Until replaced or cleared |

Imported data is not associated with any website URL.

Data read from a connected tab is not persisted by the extension at all. It is held in
memory to render the grid and discarded when the workspace tab closes.

## What it does not do

- No data is transmitted anywhere. The extension contains no code that makes network
  requests.
- No data is sold or transferred to third parties.
- No data is used for advertising, profiling, creditworthiness, or lending.
- No analytics, tracking, crash reporting, or remote configuration.
- No remote code is loaded. All code ships inside the extension package.

## Writes to website data

Editing a row writes directly into the connected site's IndexedDB. **These writes are
immediate and cannot be undone.** The extension shows the origin being edited in a
permanent banner while a live tab is connected. You are responsible for the changes
you make to a site's data.

## Removing your data

Uninstalling the extension, or clearing its data from `chrome://extensions`, removes
any imported snapshot and all stored session metadata. Data the extension wrote into a
website's own IndexedDB belongs to that site and must be managed there.

## Contact

Questions about this policy: <!-- add a contact email or issue-tracker URL before publishing -->
