import { defineConfig } from 'vite'

/**
 * The content script gets its own build on purpose.
 *
 * chrome.scripting.executeScript({ files }) injects a *classic* script, so
 * content.js must have zero import statements. In the main build Rollup hoists
 * anything shared with the panel/background (shared/rpc.ts, shared/codec.ts) into a
 * common chunk and leaves an `import` behind, which would throw at injection time.
 * A separate IIFE lib build cannot share chunks, so everything is inlined.
 *
 * Runs after the main build with emptyOutDir disabled, so it drops content.js into
 * the dist/ that the main build just produced.
 */
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/content/content.ts',
      formats: ['iife'],
      name: 'DexieVisualizerContent',
      fileName: () => 'content.js',
    },
  },
})
