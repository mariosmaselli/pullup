// Is dist/ — the built app `pnpm start` serves — up to date with the code it's built from?
//
//   node scripts/dist-stamp.mjs write   (end of `pnpm build`) records what dist/ was built from
//   node scripts/dist-stamp.mjs check   exit 0 if dist/ matches the code now, 1 if missing/stale
//
// Content hashes, not mtimes: a checkout or a touch that changes nothing doesn't force a rebuild,
// and an edit always does. Only what goes into the SPA counts — the server runs from source.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const stampFile = join(dist, '.build-stamp.json')
const INPUTS = [
  'src/client',
  'src/shared',
  'templates',
  'public',
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'package.json',
  'pnpm-lock.yaml',
]
const SKIP = /(^|\/)(\.DS_Store|node_modules)$|\.test\.ts$/

function list(path, out = []) {
  if (!existsSync(path) || SKIP.test(path)) return out
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path).sort()) list(join(path, name), out)
  } else out.push(path)
  return out
}

function fingerprint() {
  const files = {}
  for (const input of INPUTS) {
    for (const path of list(join(root, input))) {
      const key = relative(root, path).split(sep).join('/')
      files[key] = createHash('sha256').update(readFileSync(path)).digest('hex')
    }
  }
  const all = createHash('sha256')
  for (const [key, hash] of Object.entries(files).sort()) all.update(`${key}\0${hash}\n`)
  return { hash: all.digest('hex'), files }
}

const [command, flag] = process.argv.slice(2)
const quiet = flag === '--quiet'

if (command === 'write') {
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('dist/index.html is missing — run vite build first')
    process.exit(1)
  }
  const { hash, files } = fingerprint()
  const stamp = { builtAt: new Date().toISOString(), node: process.version, hash, files }
  writeFileSync(stampFile, `${JSON.stringify(stamp, null, 2)}\n`)
  if (!quiet) console.log(`dist/ stamped (${Object.keys(files).length} source files)`)
} else if (command === 'check') {
  const fail = (why) => {
    if (!quiet) {
      console.error(`dist/ ${why}.`)
      console.error(
        'Run `pnpm build` first — or `pnpm start:fresh` to build (if needed) and start.'
      )
    }
    process.exit(1)
  }
  if (!existsSync(join(dist, 'index.html'))) fail('is missing')
  if (!existsSync(stampFile)) fail('has no build stamp (built before stamps, or by vite directly)')
  let stamp
  try {
    stamp = JSON.parse(readFileSync(stampFile, 'utf8'))
  } catch {
    fail('has an unreadable build stamp')
  }
  const now = fingerprint()
  if (now.hash !== stamp.hash) {
    const keys = new Set([...Object.keys(now.files), ...Object.keys(stamp.files ?? {})])
    const changed = [...keys].filter((k) => now.files[k] !== stamp.files?.[k]).sort()
    const shown = changed.slice(0, 5).join(', ')
    const more = changed.length > 5 ? ` and ${changed.length - 5} more` : ''
    fail(`is out of date — changed since the build on ${stamp.builtAt}: ${shown}${more}`)
  }
  if (!quiet) console.log(`dist/ is up to date (built ${stamp.builtAt})`)
} else {
  console.error('Usage: node scripts/dist-stamp.mjs write|check [--quiet]')
  process.exit(2)
}
