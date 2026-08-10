import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

// The content script is NOT declared in the manifest on purpose: declaring it
// would auto-inject it everywhere and force host permissions. It is injected
// programmatically under `activeTab` instead.
//
// It is also not built here — see vite.content.config.ts, which emits a
// self-contained dist/content.js that this build must not be able to code-split.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    // The workspace is opened with chrome.tabs.create(), so it is not discoverable
    // from manifest.json and must be kept as an explicit HTML entry.
    rollupOptions: {
      input: {
        workspace: 'src/panel/index.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
