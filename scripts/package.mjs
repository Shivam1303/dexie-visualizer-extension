#!/usr/bin/env node
/**
 * Packages dist/ into a Chrome Web Store upload zip.
 *
 * The store requires manifest.json at the ARCHIVE ROOT, so this zips the
 * *contents* of dist/ rather than the directory itself. It also runs the
 * pre-upload checks that are easy to forget and cost a whole review cycle:
 * missing icon files, leftover source maps, and a version that was not bumped.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const outDir = join(root, 'release')

function fail(message) {
  console.error(`\n  ✖ ${message}\n`)
  process.exit(1)
}

if (!existsSync(dist)) fail('dist/ does not exist — run `npm run build` first.')

const manifestPath = join(dist, 'manifest.json')
if (!existsSync(manifestPath)) fail('dist/manifest.json is missing; the build did not emit a manifest.')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

// The store rejects an upload whose version already exists, and a 128px icon is mandatory.
if (!manifest.version) fail('manifest has no "version".')
if (!manifest.icons?.['128']) fail('manifest is missing the required 128x128 icon.')

const iconPaths = new Set([
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
])
for (const rel of iconPaths) {
  if (!existsSync(join(dist, rel))) fail(`manifest references "${rel}" but it is not in dist/.`)
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const files = walk(dist)

const maps = files.filter((f) => f.endsWith('.map'))
if (maps.length > 0) {
  console.warn(`  ! ${maps.length} source map(s) in dist/ will be shipped. Remove them to keep the upload lean.`)
}

mkdirSync(outDir, { recursive: true })
const zipName = `indexeddb-workbench-${manifest.version}.zip`
const zipPath = join(outDir, zipName)
rmSync(zipPath, { force: true })

// -r recurse, -q quiet, -X strip platform extras. "." = contents of cwd, so the
// archive is rooted at dist/ and manifest.json lands at the top level.
execFileSync('zip', ['-r', '-q', '-X', zipPath, '.', '-x', '.*', '-x', '*/.*'], { cwd: dist })

const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' })
if (!/\smanifest\.json\s*$/m.test(listing)) {
  fail('manifest.json is not at the archive root — the store will reject this zip.')
}

const kb = (statSync(zipPath).size / 1024).toFixed(1)
console.log(`\n  ✔ ${zipName}  (${kb} kB, ${files.length} files)`)
console.log(`    ${zipPath}`)
console.log(`    version ${manifest.version} — bump manifest.json before the next upload.\n`)
