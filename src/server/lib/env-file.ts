import { chmod, readFile, rename, writeFile } from 'node:fs/promises'

// Sets (or removes, with value null) one KEY=value line in a .env file, keeping every other
// line as is. Duplicate lines for the key are collapsed. Written atomically, readable by the
// owner only — the file holds secrets.
export async function setEnvValue(file: string, key: string, value: string | null) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error(`Invalid env key: ${key}`)
  if (value !== null && /[\r\n]/.test(value)) throw new Error('Env values cannot contain newlines')

  const current = await readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return ''
    throw err
  })

  const matcher = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`)
  const lines = current.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()

  const index = lines.findIndex((line) => matcher.test(line))
  const kept = lines.filter((line) => !matcher.test(line))
  if (value !== null) {
    // Keep the key where it was (after its comment), or append it.
    kept.splice(index === -1 ? kept.length : index, 0, `${key}=${value}`)
  }

  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, `${kept.join('\n')}\n`, { mode: 0o600 })
  await rename(tmp, file)
  await chmod(file, 0o600)
}
