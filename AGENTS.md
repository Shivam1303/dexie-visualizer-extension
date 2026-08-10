# Repository Guidelines

## Project Structure & Module Organization

This is a Chrome Manifest V3 extension built with TypeScript, React, Vite, CRXJS, and Dexie. Runtime code lives under `src/`: `background/` tracks the active tab, `content/` accesses its IndexedDB, `datasource/` implements live and imported sources, `import/` owns file/session lifecycle, `panel/` contains React UI and Zustand state, and `shared/` holds cross-source utilities. Tests are in `tests/*.test.ts{,x}`; `test-page/` provides a manual live fixture. Treat `dist/` and `tsconfig.tsbuildinfo` as generated output.

## Build, Test, and Development Commands

- `npm ci` installs the locked dependency set. Use Node 24.11.1 (`nvm use`).
- `npm run build` builds the MV3 extension and then emits the separately bundled, import-free `dist/content.js`.
- `npm test` runs the Vitest suite once.
- `npm run test:watch` reruns affected tests while developing.
- `npm run typecheck` checks the TypeScript project without emitting files.

For manual testing, build, load `dist/` through `chrome://extensions`, open `test-page/index.html`, and click the extension icon. Also import a small Dexie export, switch sources, edit/delete a row, replace the import, and remove the local copy. Reload the extension after each rebuild.

## Coding Style & Naming Conventions

Follow the existing style: two-space indentation, single quotes, no semicolons, trailing commas in multiline structures, and ES modules. Use `PascalCase` for React components and exported types, `camelCase` for functions and variables, and uppercase `MSG_*` names for protocol constants. Keep feature UI under `src/panel/features/<feature>/`; reusable controls belong in `components/`. No formatter or linter is configured, so match neighboring code and run `npm run typecheck` before submitting.

## Testing Guidelines

Vitest discovers `tests/**/*.test.{ts,tsx}`. Name files after the unit under test, such as `codec.test.ts`, and group behavior with `describe`/`it`. Prefer deterministic unit tests; use `fake-indexeddb` for IndexedDB behavior and `jsdom` only when DOM APIs are required. Cover serialization, atomic import replacement, key variants, and write paths carefully. Perform the manual extension flow for background, injection, import, or panel changes.

## Commit & Pull Request Guidelines

The repository has too little history to infer a project-specific convention. Use concise, imperative subjects (for example, `Handle compound IndexedDB keys`) and keep commits focused. Pull requests should explain user-visible behavior, list automated and manual checks, link relevant issues, and include screenshots or a short recording for panel UI changes. Call out permission, manifest, messaging, import-storage, or destructive-write changes explicitly.
