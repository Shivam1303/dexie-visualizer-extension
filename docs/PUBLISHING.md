# Publishing IndexedDB Workbench to the Chrome Web Store

A sequential walkthrough, from creating the developer account to a live listing.
Everything in code blocks is copy-paste ready.

Claims about data handling in this doc were verified against the source: there are no
`fetch`, `XMLHttpRequest`, or external URL references anywhere in `src/`.

---

## What you need to supply

The repo is submission-ready except for four things only you can provide:

| Item | Where | Notes |
|---|---|---|
| Contact email | `docs/PRIVACY.md`, last line | Currently an empty HTML comment |
| Privacy policy URL | Step 4 | Host `docs/PRIVACY.md` somewhere public |
| Screenshots | Step 5 | 1–5 images at 1280×800 |
| Small promo tile | Step 5 | 440×280 |

The icons in `icons/` are functional placeholders generated from the app palette.
Replace them when you want a designed identity — no build changes needed.

---

## Step 1 — Prepare the Google account

1. Use (or create) the Google account that will own the listing. It is hard to
   transfer later, so prefer one you'll keep — not a throwaway.
2. **Enable 2-Step Verification** on it. Google requires this for Web Store
   developers; you cannot publish without it.

## Step 2 — Register as a developer

1. Go to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Accept the developer agreement.
3. Pay the **one-time $5 registration fee** (non-refundable, card required). This
   unlocks publishing and covers up to 20 items on the account.
4. Open account settings and set:
   - **Publisher display name** — shown on the listing as the author. Use your real
     name or a company name; it is public.
   - **Contact email** — then **verify it**. Unverified email blocks publishing.

## Step 3 — Complete the trader declaration

Required under the EU Digital Services Act; the dashboard will not let you publish
publicly without it.

- Declaring **trader** (publishing commercially / as a business) requires a physical
  address and phone number, which are **displayed publicly on the listing**.
- Declaring **non-trader** (personal, non-commercial) avoids publishing an address.

Pick the one that is actually true for you. A free personal dev tool is normally
non-trader, but this is your call and it is a legal declaration, not a preference.

## Step 4 — Host the privacy policy

1. Fill in the contact line at the bottom of `docs/PRIVACY.md`.
2. Publish it at a stable public URL — GitHub Pages, a public gist, or any static
   host. It must be reachable without a login.
3. Keep the URL; you'll paste it in Step 9.

Strictly speaking a policy is not required when you declare no data collection, but
this extension reads website content and reviewers sometimes ask. Having one costs
nothing and avoids a rejection round-trip.

## Step 5 — Produce the store assets

**Screenshots** — 1 to 5 images, **1280×800** (or 640×400). Shot list:

1. The grid connected to a live tab, with the live-editing banner visible.
2. A row open in the editor showing a staged change (`was → now`).
3. The filter panel with a couple of type-aware filters applied.
4. The import screen with an export's metadata under review.

Use `test-page/index.html` as the subject — it seeds awkward data (real `Date`s, a
`Blob`, nested structures, compound keys) that makes the tool look like it earns its
place. Don't screenshot real user data.

**Small promo tile** — **440×280**, required. The 1400×560 marquee is optional.

## Step 6 — Verify the build, then package it

Load the current build unpacked and confirm the rename and new icons took effect —
this is the one thing the automated checks can't verify:

```bash
npm run build
```

`chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`. Confirm:

- the toolbar shows the mint icon, not a puzzle piece;
- the card reads **IndexedDB Workbench**;
- clicking the icon on a tab opens the workspace and connects.

Then build the upload:

```bash
npm run package
```

Produces `release/indexeddb-workbench-<version>.zip`, rooted so `manifest.json` is at
the archive top level — the store rejects a zip that nests the extension inside a
folder. The script hard-fails on a missing 128px icon, a manifest referencing an icon
absent from `dist/`, or a failed root check, and warns about leftover source maps.

## Step 7 — Create the item and upload

1. Dashboard → **Items** → **Add new item**.
2. Upload `release/indexeddb-workbench-1.0.0.zip`.
3. If the upload is rejected, it is almost always the archive root or a manifest
   error — the message names the field.

## Step 8 — Fill the Store listing tab

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

Then: **Category** = Developer Tools · **Language** = English · upload the
screenshots, promo tile, and the 128px icon from Step 5.

Keep the irreversible-writes warning in the description. It is honest, it pre-empts
one-star surprises, and it protects you from a complaint about undisclosed
destructive behavior.

## Step 9 — Fill the Privacy practices tab

**Single purpose:**

```
Inspect and edit the IndexedDB databases of a tab the user explicitly activates,
or of a Dexie export the user imports.
```

**Permission justifications** — one field per permission:

| Permission | Justification |
|---|---|
| `activeTab` | Granted only when the user clicks the extension's toolbar icon on a tab. It is the mechanism by which the extension reads and writes that one tab's IndexedDB. The extension deliberately requests no host permissions, so it has no standing access to any site. |
| `scripting` | Used to inject the IndexedDB reader/writer into the tab the user explicitly activated. A page cannot read another origin's IndexedDB, so the code must run in the page. It is injected programmatically rather than declared as a content script, so nothing is injected anywhere until the user clicks. |
| `storage` | Stores small local session metadata (the selected database/store and the identifier of the current imported snapshot) via `chrome.storage.local`. No browsing history or site content is written here, and nothing is transmitted. |

**Data usage.** The extension makes no network requests of any kind, so leave the
data-collection declarations unchecked. All three required certifications are
truthfully yes:

- Not sold or transferred to third parties beyond approved use cases — **yes**
- Not used or transferred for purposes unrelated to the single purpose — **yes**
- Not used or transferred to determine creditworthiness or for lending — **yes**

Paste the privacy policy URL from Step 4.

> If you ever add analytics, crash reporting, or any remote call, this entire tab
> becomes false and must be revised before the next upload.

## Step 10 — Choose visibility

| Option | Who can install |
|---|---|
| **Public** | Anyone; appears in search and browsing |
| **Unlisted** | Anyone with the direct link; not in search |
| **Private** | Named testers or your Google Workspace domain only |

**Recommended: publish Unlisted first.** This tool writes irreversibly to live
databases. Unlisted gives you a genuine store install and update flow without a
public audience for the first bug. Flip to Public after a week of real use.

Also set the distribution regions.

## Step 11 — Submit for review

Hit **Submit for review**. You can optionally defer publishing so an approved item
waits until you press publish.

Expect under 24 hours in the common case. `scripting` plus first-time-developer
status can stretch it to several days. You'll get an email either way.

## Step 12 — If it gets rejected

Rejections name a policy section. The likely ones here, and the fix:

| Reason | Fix |
|---|---|
| Permission not justified | Expand the Step 9 text for the named permission; be concrete about the user action that triggers it |
| Single purpose unclear | Tighten the single-purpose sentence; don't describe two products |
| Missing/insufficient privacy disclosure | Confirm the policy URL loads publicly and matches what the listing declares |
| Metadata / keyword spam | Remove repeated keywords from the description |
| Affiliation or trademark concern | The rename in Step 8 already addresses the original risk here |

Fix, then resubmit the same version — a rejected item does not need a version bump.
A *published* item does.

## Updating later

1. Bump `version` in `manifest.json` (the store rejects a re-upload of an existing
   version number).
2. `npm run package`
3. Upload the new zip to the same item, resubmit.

Updates support **partial rollout** by percentage, and a published version can be
reverted if something breaks.

---

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
